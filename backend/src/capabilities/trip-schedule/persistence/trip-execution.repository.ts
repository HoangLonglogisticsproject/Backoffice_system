import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  CompletionRequest,
  DriverAssignment,
  ExecutionEvent,
  ExecutionEventType,
  ExpenseDeclaration,
  VehicleOwnership,
} from '../domain/trip-execution';

/**
 * SQL for the operational half of a trip. Opens no transaction; decides nothing.
 *
 * Three classes rather than one generic one, the same choice
 * `trip-cost.repository.ts` and `trip-catalogue.repository.ts` both make: a
 * repository that interpolates a table name into its SQL is one whose safety
 * depends on every future caller passing a constant, and the row mappers differ
 * anyway.
 *
 * ⚠ NO METHOD HERE DELETES ANYTHING, and 0017 puts a trigger behind that. An
 * assignment is ENDED, an event is VOIDED, a request is DECIDED — every one of
 * them leaves the row where it was.
 */

interface AssignmentRow {
  id: string;
  trip_id: string;
  driver_user_id: string;
  driver_display_name: string;
  state: 'active' | 'ended';
  assigned_by: string;
  assigned_at: Date;
  ended_by: string | null;
  ended_at: Date | null;
  end_reason: string | null;
}

const toAssignment = (row: AssignmentRow): DriverAssignment => ({
  id: row.id,
  tripId: row.trip_id,
  driverUserId: row.driver_user_id,
  driverUser: { id: row.driver_user_id, displayName: row.driver_display_name },
  state: row.state,
  assignedBy: row.assigned_by,
  assignedAt: row.assigned_at,
  endedBy: row.ended_by,
  endedAt: row.ended_at,
  endReason: row.end_reason,
});

/**
 * ★ THE JOIN IS ON THE DRIVER, NOT ON WHOEVER ASSIGNED THEM. The question every
 * screen asks of this row is "who is driving", and a UUID is not an answer.
 */
const ASSIGNMENT_SELECT = `
  SELECT a.id, a.trip_id, a.driver_user_id, a.state, a.assigned_by, a.assigned_at,
         a.ended_by, a.ended_at, a.end_reason,
         u.display_name AS driver_display_name
    FROM trip_driver_assignments a
    JOIN users u ON u.id = a.driver_user_id`;

@Injectable()
export class DriverAssignmentRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Puts a driver on a trip.
   *
   * ★ NOTHING HERE CHECKS WHETHER THE TRIP ALREADY HAS ONE, on purpose. The
   * partial unique index `uq_trip_active_driver_assignment` decides that, and it
   * is the only thing that can: two operators assigning different drivers at the
   * same instant both read the same empty state, and one of them has to lose at
   * COMMIT rather than at a SELECT neither of them can trust.
   */
  async assign(
    input: { tripId: string; driverUserId: string; assignedBy: string },
    executor: DatabaseQuery = this.db,
  ): Promise<DriverAssignment> {
    const rows = await executor.query<AssignmentRow>(
      `WITH written AS (
         INSERT INTO trip_driver_assignments (trip_id, driver_user_id, assigned_by)
         VALUES ($1, $2, $3)
         RETURNING id, trip_id, driver_user_id, state, assigned_by, assigned_at,
                   ended_by, ended_at, end_reason
       )
       SELECT written.*, u.display_name AS driver_display_name
         FROM written JOIN users u ON u.id = written.driver_user_id`,
      [input.tripId, input.driverUserId, input.assignedBy],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_driver_assignments returned no row');

    return toAssignment(row);
  }

  /**
   * Ends the trip's current assignment, if it has one.
   *
   * `WHERE state = 'active'` is what makes a second call a no-op the service
   * turns into a refusal, rather than a silent rewrite of who ended it and why.
   * Returns `null` when there was nothing active to end.
   */
  async end(
    input: { tripId: string; endedBy: string; reason: string; now: Date },
    executor: DatabaseQuery,
  ): Promise<DriverAssignment | null> {
    const rows = await executor.query<AssignmentRow>(
      `WITH written AS (
         UPDATE trip_driver_assignments
            SET state = 'ended', ended_by = $2, ended_at = $4, end_reason = $3
          WHERE trip_id = $1 AND state = 'active'
         RETURNING id, trip_id, driver_user_id, state, assigned_by, assigned_at,
                   ended_by, ended_at, end_reason
       )
       SELECT written.*, u.display_name AS driver_display_name
         FROM written JOIN users u ON u.id = written.driver_user_id`,
      [input.tripId, input.endedBy, input.reason, input.now],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  /**
   * The trip's current driver, locked for the rest of the transaction.
   *
   * ★ `FOR UPDATE` ON THE ASSIGNMENT ROW, NOT ON THE TRIP. Recording an event
   * and replacing a driver race over THIS row: without the lock, an event can be
   * written against an assignment that ended a millisecond earlier, and its
   * provenance then names somebody who was no longer driving.
   */
  async lockActive(tripId: string, executor: DatabaseQuery): Promise<DriverAssignment | null> {
    const rows = await executor.query<AssignmentRow>(
      `${ASSIGNMENT_SELECT} WHERE a.trip_id = $1 AND a.state = 'active' FOR UPDATE OF a`,
      [tripId],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async findActive(
    tripId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DriverAssignment | null> {
    const rows = await executor.query<AssignmentRow>(
      `${ASSIGNMENT_SELECT} WHERE a.trip_id = $1 AND a.state = 'active'`,
      [tripId],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  /**
   * Every driver this trip has had, newest first.
   *
   * Not paginated, for the reason ADR-0002 §4 gives: one trip's assignments are
   * bounded small.
   */
  async listByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<DriverAssignment[]> {
    const rows = await executor.query<AssignmentRow>(
      `${ASSIGNMENT_SELECT} WHERE a.trip_id = $1 ORDER BY a.assigned_at DESC, a.id DESC`,
      [tripId],
    );
    return rows.map(toAssignment);
  }

  /** The trips a driver is currently on. Served by `idx_trip_driver_assignment_driver`. */
  async listActiveForDriver(
    driverUserId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DriverAssignment[]> {
    const rows = await executor.query<AssignmentRow>(
      `${ASSIGNMENT_SELECT}
        WHERE a.driver_user_id = $1 AND a.state = 'active'
        ORDER BY a.assigned_at DESC, a.id DESC`,
      [driverUserId],
    );
    return rows.map(toAssignment);
  }
}

// ----------------------------------------------------------------- events ----

interface EventRow {
  id: string;
  trip_id: string;
  driver_assignment_id: string;
  event_type: ExecutionEventType;
  vehicle_id: string | null;
  vehicle_ownership: VehicleOwnership | null;
  scheduled_at: Date | null;
  actual_at: Date;
  recorded_at: Date;
  device_reported_at: Date | null;
  recorded_by: string;
  recorded_by_display_name: string;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
}

const toEvent = (row: EventRow): ExecutionEvent => ({
  id: row.id,
  tripId: row.trip_id,
  driverAssignmentId: row.driver_assignment_id,
  type: row.event_type,
  vehicleId: row.vehicle_id,
  vehicleOwnership: row.vehicle_ownership,
  scheduledAt: row.scheduled_at,
  actualAt: row.actual_at,
  recordedAt: row.recorded_at,
  deviceReportedAt: row.device_reported_at,
  recordedBy: row.recorded_by,
  recordedByUser: { id: row.recorded_by, displayName: row.recorded_by_display_name },
  voidedAt: row.voided_at,
  voidedBy: row.voided_by,
  voidReason: row.void_reason,
});

/**
 * The event's own columns, optionally prefixed.
 *
 * `SELECT *` is impossible across the author join: `users.id` would clobber the
 * event's own `id` and every row would come back identified as its author. The
 * prefix is `'e.'` inside a joined read and `''` in a RETURNING clause — the
 * same shape `trip-cost.repository.ts` uses for the same reason.
 */
const eventColumns = (alias = ''): string =>
  [
    'id',
    'trip_id',
    'driver_assignment_id',
    'event_type',
    'vehicle_id',
    'vehicle_ownership',
    'scheduled_at',
    'actual_at',
    'recorded_at',
    'device_reported_at',
    'recorded_by',
    'voided_at',
    'voided_by',
    'void_reason',
  ]
    .map((column) => `${alias}${column}`)
    .join(', ');

const EVENTS_WITH_AUTHOR = `
  SELECT ${eventColumns('e.')}, u.display_name AS recorded_by_display_name
    FROM trip_execution_events e
    JOIN users u ON u.id = e.recorded_by`;

@Injectable()
export class ExecutionEventRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Records something that happened.
   *
   * ★ EVERY SNAPSHOT IS A PARAMETER, NOT A SUB-SELECT. Reading the trip's
   * vehicle inside this INSERT would tie the recorded value to whatever the trip
   * says at the instant of the write, which is a different value from the one
   * the service validated a moment earlier. The service captures them under a
   * lock and passes them in, so what is stored is what was checked.
   *
   * `recorded_at` is left to the column default — the SERVER's clock, never a
   * value a caller could supply.
   */
  async record(
    input: {
      tripId: string;
      driverAssignmentId: string;
      type: ExecutionEventType;
      vehicleId: string | null;
      vehicleOwnership: VehicleOwnership | null;
      scheduledAt: Date | null;
      actualAt: Date;
      deviceReportedAt: Date | null;
      clientEventId: string;
      recordedBy: string;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<ExecutionEvent> {
    const rows = await executor.query<EventRow>(
      `WITH written AS (
         INSERT INTO trip_execution_events
           (trip_id, driver_assignment_id, event_type, vehicle_id, vehicle_ownership,
            scheduled_at, actual_at, device_reported_at, client_event_id, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${eventColumns()}
       )
       SELECT written.*, u.display_name AS recorded_by_display_name
         FROM written JOIN users u ON u.id = written.recorded_by`,
      [
        input.tripId,
        input.driverAssignmentId,
        input.type,
        input.vehicleId,
        input.vehicleOwnership,
        input.scheduledAt,
        input.actualAt,
        input.deviceReportedAt,
        input.clientEventId,
        input.recordedBy,
      ],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_execution_events returned no row');

    return toEvent(row);
  }

  /**
   * The event a retried request already wrote, if there is one.
   *
   * Lets the service answer a duplicate with the ORIGINAL record rather than a
   * conflict: a driver on a bad connection did nothing wrong, and the honest
   * answer to "record this arrival" that is already recorded is the arrival.
   */
  async findByClientEventId(
    tripId: string,
    clientEventId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<ExecutionEvent | null> {
    const rows = await executor.query<EventRow>(
      `${EVENTS_WITH_AUTHOR} WHERE e.trip_id = $1 AND e.client_event_id = $2`,
      [tripId, clientEventId],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }

  /** A trip's timeline, in the order things happened. */
  async listByTrip(
    tripId: string,
    includeVoided = false,
    executor: DatabaseQuery = this.db,
  ): Promise<ExecutionEvent[]> {
    const rows = await executor.query<EventRow>(
      `${EVENTS_WITH_AUTHOR}
        WHERE e.trip_id = $1 ${includeVoided ? '' : 'AND e.voided_at IS NULL'}
        ORDER BY e.actual_at ASC, e.id ASC`,
      [tripId],
    );
    return rows.map(toEvent);
  }

  /** Withdraws an event without destroying it. */
  async void(
    id: string,
    by: string,
    reason: string,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<ExecutionEvent | null> {
    const rows = await executor.query<EventRow>(
      `WITH written AS (
         UPDATE trip_execution_events
            SET voided_at = $4, voided_by = $2, void_reason = $3
          WHERE id = $1 AND voided_at IS NULL
         RETURNING ${eventColumns()}
       )
       SELECT written.*, u.display_name AS recorded_by_display_name
         FROM written JOIN users u ON u.id = written.recorded_by`,
      [id, by, reason, now],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }
}

// ------------------------------------------------------------- completion ----

interface RequestRow {
  id: string;
  trip_id: string;
  driver_assignment_id: string;
  attempt_no: number;
  expense_declaration: ExpenseDeclaration;
  state: 'pending' | 'approved' | 'rejected';
  submitted_by: string;
  submitted_by_display_name: string;
  submitted_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
}

const toRequest = (row: RequestRow): CompletionRequest => ({
  id: row.id,
  tripId: row.trip_id,
  driverAssignmentId: row.driver_assignment_id,
  // `attempt_no` is INTEGER, which `pg` hands back as a number — unlike the
  // bigint counts in `offset-page`, which arrive as strings.
  attemptNo: row.attempt_no,
  expenseDeclaration: row.expense_declaration,
  state: row.state,
  submittedBy: row.submitted_by,
  submittedByUser: { id: row.submitted_by, displayName: row.submitted_by_display_name },
  submittedAt: row.submitted_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  decisionReason: row.decision_reason,
});

const REQUEST_SELECT = `
  SELECT r.id, r.trip_id, r.driver_assignment_id, r.attempt_no, r.expense_declaration,
         r.state, r.submitted_by, r.submitted_at, r.decided_by, r.decided_at,
         r.decision_reason,
         u.display_name AS submitted_by_display_name
    FROM trip_completion_requests r
    JOIN users u ON u.id = r.submitted_by`;

@Injectable()
export class CompletionRequestRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Asks for the trip to be closed.
   *
   * ★ `attempt_no` IS COMPUTED IN SQL, NOT IN JAVASCRIPT. Reading the highest
   * attempt and adding one in the service is a read-modify-write two callers can
   * interleave, and both would compute the same number. Here the sub-select runs
   * inside the same statement, and if two still collide,
   * `uq_trip_completion_attempt` refuses the loser.
   *
   * ★ AND `uq_trip_completion_pending` IS WHAT STOPS A DOUBLE SUBMIT. A driver
   * tapping twice produces two requests that both pass every application check;
   * only the index can reject the second.
   */
  async submit(
    input: {
      tripId: string;
      driverAssignmentId: string;
      submittedBy: string;
      expenseDeclaration: ExpenseDeclaration;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<CompletionRequest> {
    const rows = await executor.query<RequestRow>(
      `WITH written AS (
         INSERT INTO trip_completion_requests
           (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
         SELECT $1, $2,
                COALESCE(MAX(attempt_no), 0) + 1,
                $3, $4
           FROM trip_completion_requests WHERE trip_id = $1
         RETURNING id, trip_id, driver_assignment_id, attempt_no, expense_declaration,
                   state, submitted_by, submitted_at, decided_by, decided_at, decision_reason
       )
       SELECT written.*, u.display_name AS submitted_by_display_name
         FROM written JOIN users u ON u.id = written.submitted_by`,
      [input.tripId, input.driverAssignmentId, input.submittedBy, input.expenseDeclaration],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_completion_requests returned no row');

    return toRequest(row);
  }

  /**
   * Decides a pending request.
   *
   * `WHERE state = 'pending'` is the whole concurrency answer for two approvers
   * clicking at once: the second gets no row back, and the service turns that
   * into a conflict rather than overwriting the first decision.
   */
  async decide(
    input: {
      id: string;
      state: 'approved' | 'rejected';
      decidedBy: string;
      reason: string | null;
      now: Date;
    },
    executor: DatabaseQuery,
  ): Promise<CompletionRequest | null> {
    const rows = await executor.query<RequestRow>(
      `WITH written AS (
         UPDATE trip_completion_requests
            SET state = $2, decided_by = $3, decided_at = $5, decision_reason = $4
          WHERE id = $1 AND state = 'pending'
         RETURNING id, trip_id, driver_assignment_id, attempt_no, expense_declaration,
                   state, submitted_by, submitted_at, decided_by, decided_at, decision_reason
       )
       SELECT written.*, u.display_name AS submitted_by_display_name
         FROM written JOIN users u ON u.id = written.submitted_by`,
      [input.id, input.state, input.decidedBy, input.reason, input.now],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /**
   * The trip's outstanding request, locked for the rest of the transaction.
   *
   * The lock is what serialises two approvers: the second waits here rather than
   * racing the UPDATE, so it sees the decision the first made.
   */
  async lockPending(tripId: string, executor: DatabaseQuery): Promise<CompletionRequest | null> {
    const rows = await executor.query<RequestRow>(
      `${REQUEST_SELECT} WHERE r.trip_id = $1 AND r.state = 'pending' FOR UPDATE OF r`,
      [tripId],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /** Every attempt on this trip, newest first. */
  async listByTrip(
    tripId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<CompletionRequest[]> {
    const rows = await executor.query<RequestRow>(
      `${REQUEST_SELECT} WHERE r.trip_id = $1 ORDER BY r.attempt_no DESC`,
      [tripId],
    );
    return rows.map(toRequest);
  }
}
