import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  AssignmentRequestState,
  DispatchAssignmentRequest,
  SupersedeReason,
  TripAssignmentRequest,
} from '../domain/trip-assignment-request';

/**
 * Drivers' asks for open bookings, as SQL (0035).
 *
 * ★ NO DELETE AND NO REWRITE. A request is resolved once, from `pending`, and
 * every write below says `WHERE state = 'pending'`; 0035's trigger refuses
 * anything else. History is the point: who asked, who decided, what won.
 */

interface RequestRow {
  id: string;
  trip_id: string;
  driver_user_id: string;
  state: AssignmentRequestState;
  requested_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  approved_assignment_id: string | null;
  resolution_reason: string | null;
}

const COLUMNS = `id, trip_id, driver_user_id, state, requested_at, resolved_at, resolved_by,
                 approved_assignment_id, resolution_reason`;

const toRequest = (row: RequestRow): TripAssignmentRequest => ({
  id: row.id,
  tripId: row.trip_id,
  driverUserId: row.driver_user_id,
  state: row.state,
  requestedAt: row.requested_at,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by,
  approvedAssignmentId: row.approved_assignment_id,
  resolutionReason: row.resolution_reason,
});

type ReviewRow = RequestRow & { driver_display_name: string; resolved_by_display_name: string | null };

const toReview = (row: ReviewRow): DispatchAssignmentRequest => ({
  id: row.id,
  tripId: row.trip_id,
  driver: { id: row.driver_user_id, displayName: row.driver_display_name },
  state: row.state,
  requestedAt: row.requested_at,
  resolvedAt: row.resolved_at,
  resolvedBy:
    row.resolved_by && row.resolved_by_display_name
      ? { id: row.resolved_by, displayName: row.resolved_by_display_name }
      : null,
  approvedAssignmentId: row.approved_assignment_id,
  resolutionReason: row.resolution_reason,
});

const REVIEW_SELECT = `
  SELECT r.id, r.trip_id, r.driver_user_id, r.state, r.requested_at, r.resolved_at, r.resolved_by,
         r.approved_assignment_id, r.resolution_reason,
         d.display_name AS driver_display_name, b.display_name AS resolved_by_display_name
    FROM trip_assignment_requests r
    JOIN users d ON d.id = r.driver_user_id
    LEFT JOIN users b ON b.id = r.resolved_by`;

/** One resolution, from `pending` only. */
export interface Resolution {
  id: string;
  state: Exclude<AssignmentRequestState, 'pending'>;
  by: string;
  now: Date;
  reason?: string | null;
  assignmentId?: string | null;
}

@Injectable()
export class TripAssignmentRequestRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Asks, once. ★ A SECOND ASK IS THE FIRST ONE: the partial unique index
   * makes a double tap — or two tabs racing — one pending row, and the loser
   * reads the winner back instead of erroring.
   */
  async create(tripId: string, driverUserId: string, tx: DatabaseQuery): Promise<TripAssignmentRequest> {
    const inserted = await tx.query<RequestRow>(
      `INSERT INTO trip_assignment_requests (trip_id, driver_user_id) VALUES ($1, $2)
       ON CONFLICT (trip_id, driver_user_id) WHERE state = 'pending' DO NOTHING
       RETURNING ${COLUMNS}`,
      [tripId, driverUserId],
    );
    const rows = inserted.length > 0
      ? inserted
      : await tx.query<RequestRow>(
          `SELECT ${COLUMNS} FROM trip_assignment_requests
            WHERE trip_id = $1 AND driver_user_id = $2 AND state = 'pending'`,
          [tripId, driverUserId],
        );
    const row = rows[0];
    if (!row) throw new Error('trip_assignment_requests: no pending row after an upsert');
    return toRequest(row);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<TripAssignmentRequest | null> {
    const rows = await executor.query<RequestRow>(`SELECT ${COLUMNS} FROM trip_assignment_requests WHERE id = $1`, [id]);
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async lockById(id: string, tx: DatabaseQuery): Promise<TripAssignmentRequest | null> {
    const rows = await tx.query<RequestRow>(
      `SELECT ${COLUMNS} FROM trip_assignment_requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /** Resolves one pending request. `null` when it was no longer pending. */
  async resolve(input: Resolution, tx: DatabaseQuery): Promise<TripAssignmentRequest | null> {
    const rows = await tx.query<RequestRow>(
      `UPDATE trip_assignment_requests
          SET state = $2, resolved_by = $3, resolved_at = $4,
              resolution_reason = $5, approved_assignment_id = $6
        WHERE id = $1 AND state = 'pending'
        RETURNING ${COLUMNS}`,
      [input.id, input.state, input.by, input.now, input.reason ?? null, input.assignmentId ?? null],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /**
   * Every pending ask on a trip that stopped being open — except the one
   * being approved, which its caller resolves itself. Returns what changed,
   * so each driver can be told.
   */
  async supersedePending(
    input: { tripId: string; by: string; reason: SupersedeReason; now: Date; except?: string | null },
    tx: DatabaseQuery,
  ): Promise<TripAssignmentRequest[]> {
    const rows = await tx.query<RequestRow>(
      `UPDATE trip_assignment_requests
          SET state = 'superseded', resolved_by = $2, resolved_at = $4, resolution_reason = $3
        WHERE trip_id = $1 AND state = 'pending' AND id IS DISTINCT FROM $5::uuid
        RETURNING ${COLUMNS}`,
      [input.tripId, input.by, input.reason, input.now, input.except ?? null],
    );
    return rows.map(toRequest);
  }

  /** Every ask on one trip, oldest first, with who asked and who decided. */
  async listByTrip(tripId: string): Promise<DispatchAssignmentRequest[]> {
    const rows = await this.db.query<ReviewRow>(
      `${REVIEW_SELECT} WHERE r.trip_id = $1 ORDER BY r.requested_at, r.id`,
      [tripId],
    );
    return rows.map(toReview);
  }

  /**
   * ★ EVERY PENDING ASK, AND IT IS BOUNDED WITHOUT A RANGE. A request stays
   * pending only while its booking is open — assigning, closing or archiving
   * the trip supersedes it — so this is "drivers waiting on Dispatch today".
   */
  async listPending(): Promise<DispatchAssignmentRequest[]> {
    const rows = await this.db.query<ReviewRow>(
      `${REVIEW_SELECT} WHERE r.state = 'pending' ORDER BY r.requested_at, r.id`,
      [],
    );
    return rows.map(toReview);
  }
}
