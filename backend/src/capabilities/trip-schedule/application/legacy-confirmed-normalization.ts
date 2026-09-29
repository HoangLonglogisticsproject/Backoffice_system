import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  classify,
  closedMetadataOf,
  type ClosedMetadata,
  type LegacyClassification,
  type LegacyOutcome,
} from '../domain/legacy-confirmed';
import { LEGACY_NORMALIZATION_REASON } from '../domain/trip-status-history';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../persistence/trip-status-history.repository';
import { closeTrip } from './trip-closure';

export interface LegacyConfirmedTrip {
  id: string;
  scheduledOn: string;
  archived: boolean;
  closedAt: Date | null;
  closedBy: string | null;
  activeTurns: number;
  endedTurns: number;
  pendingRequests: number;
  editableDriverLines: number;
  closedMetadata: ClosedMetadata;
  classification: LegacyClassification;
}

/**
 * ★ LEGACY `confirmed` → `finished`, THROUGH THE CANONICAL CLOSURE, ONE APPROVED
 * ID AT A TIME.
 *
 * The business owner has said every trip marked "Đã xác nhận" was DONE. So the
 * SAME rows — id, customer, places, crew, prices, costs, times — are closed by
 * `closeTrip` with the truthful reason `legacy_status_normalization`. Nothing
 * is invented: no execution event, completion request, approval or
 * notification, and no turn is ended (a finished trip is nobody's work: the
 * live list and every driver write already ask the trip's state).
 *
 * The closing stamp is kept where a row has one; where it has none it records
 * THIS act — the authorized person running it, at the moment it runs.
 *
 * `plan` is read-only: every stored `confirmed` trip, classified. `apply`
 * touches only the ids a person approved from that plan, each in its own
 * transaction, re-read under its row lock first: an id that is no longer
 * ELIGIBLE is reported and left exactly as it is — one conflict never stops
 * the rest. Archived rows are skipped, never unarchived; a waiting driver
 * request is never decided, cancelled or bypassed here; a half closing stamp
 * is never completed with a new actor or time.
 */
@Injectable()
export class LegacyConfirmedNormalization {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly history: TripStatusHistoryRepository,
  ) {}

  async plan(executor: DatabaseQuery = this.db) {
    const rows = await executor.query<Omit<LegacyConfirmedTrip, 'classification' | 'closedMetadata'>>(
      `SELECT t.id,
              t.scheduled_on::text     AS "scheduledOn",
              t.archived_at IS NOT NULL AS archived,
              t.closed_at              AS "closedAt",
              t.closed_by              AS "closedBy",
              (SELECT count(*) FROM trip_driver_assignments a WHERE a.trip_id = t.id AND a.state = 'active')::int AS "activeTurns",
              (SELECT count(*) FROM trip_driver_assignments a WHERE a.trip_id = t.id AND a.state = 'ended')::int  AS "endedTurns",
              (SELECT count(*) FROM trip_completion_requests r WHERE r.trip_id = t.id AND r.state = 'pending')::int AS "pendingRequests",
              (SELECT count(*) FROM trip_costs c
                WHERE c.trip_id = t.id AND c.source = 'driver_portal'
                  AND c.state = 'editable' AND c.voided_at IS NULL)::int AS "editableDriverLines"
         FROM trip_schedules t
        WHERE t.status = 'confirmed'
        ORDER BY t.scheduled_on, t.id`,
    );
    const trips: LegacyConfirmedTrip[] = rows.map((row) => {
      const closedMetadata = closedMetadataOf(row.closedAt, row.closedBy);
      return { ...row, closedMetadata, classification: classify({ ...row, closedMetadata }) };
    });
    const idsOf = (classification: LegacyClassification) =>
      trips.filter((trip) => trip.classification === classification).map((trip) => trip.id);
    return {
      transition: 'confirmed → finished',
      reason: LEGACY_NORMALIZATION_REASON,
      trips,
      eligible: idsOf('ELIGIBLE'),
      conflictPendingCompletion: idsOf('CONFLICT_PENDING_COMPLETION'),
      conflictClosedPartial: idsOf('CONFLICT_CLOSED_PARTIAL'),
      skippedArchived: idsOf('SKIPPED_ARCHIVED'),
    };
  }

  /** Closes each approved id that is STILL eligible. `by` is the authorized person running it. */
  async apply(ids: readonly string[], by: string, now = new Date()): Promise<{ id: string; outcome: LegacyOutcome }[]> {
    // Independent rows — one transaction and one row lock each, no lock shared
    // between two ids — so they run together; the report keeps the order given.
    return Promise.all(
      [...new Set(ids)].map(async (id) => ({
        id,
        outcome: await this.db.transaction((tx) => this.normalizeOne(id, by, now, tx)),
      })),
    );
  }

  private async normalizeOne(id: string, by: string, now: Date, tx: DatabaseQuery): Promise<LegacyOutcome> {
    const [row] = await tx.query<{
      status: string;
      archived: boolean;
      pending: number;
      closed_at: Date | null;
      closed_by: string | null;
    }>(
      `SELECT t.status, t.archived_at IS NOT NULL AS archived, t.closed_at, t.closed_by,
              (SELECT count(*) FROM trip_completion_requests r WHERE r.trip_id = t.id AND r.state = 'pending')::int AS pending
         FROM trip_schedules t WHERE t.id = $1 FOR UPDATE`,
      [id],
    );
    if (!row) return 'SKIPPED_MISSING';
    if (row.archived) return 'SKIPPED_ARCHIVED';
    if (row.status === 'finished') return 'SKIPPED_ALREADY_FINISHED';
    if (row.status !== 'confirmed') return 'SKIPPED_STATE_CHANGED';
    if (row.pending > 0) return 'CONFLICT_PENDING_COMPLETION';
    if (closedMetadataOf(row.closed_at, row.closed_by) === 'CLOSED_PARTIAL') return 'CONFLICT_CLOSED_PARTIAL';

    const trip = await this.trips.lockActive(id, tx);
    if (!trip) return 'SKIPPED_STATE_CHANGED';
    const repositories = { trips: this.trips, history: this.history };
    await closeTrip(repositories, trip, { by, reason: LEGACY_NORMALIZATION_REASON, at: now }, tx);
    return 'NORMALIZED';
  }
}
