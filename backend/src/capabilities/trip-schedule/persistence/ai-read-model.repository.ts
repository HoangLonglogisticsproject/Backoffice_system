import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { decodeCursor, toPage, type CursorAnchored, type Page } from '../../../common/pagination/cursor';
import type {
  AssignmentFacts,
  CompletionRequestFacts,
  CompletionState,
  SubjectLookupResult,
  TripFacts,
} from '../domain/ai-read-model';
import type { TripStatus } from '../domain/trip-schedule';

/**
 * The read models the AI Platform's detectors are fed from.
 *
 * ★ COARSE, FACTUAL NARROWING ONLY. Each list applies the predicates the
 * backend already treats as facts — archived, finished, `state = 'active'`,
 * "has a live event" (the SAME predicate as `hasLiveEvents()`), a technical
 * time window the caller supplies — and returns the facts themselves so the
 * AI evaluates its rule on them. No threshold, no severity, no "should this
 * alert" is decided in SQL here. `pickupBefore` / `submittedBefore` are
 * WINDOWS, not policies: the AI computes them from its own configuration.
 *
 * ★ BOUNDED, ALWAYS. Every list is keyset-paginated on `(anchor, id)` with
 * the anchor carried as text (see `cursor.ts` for why never a `Date`), and
 * the lookup takes at most `LOOKUP_LIMIT` ids. There is no way to ask this
 * repository for "all trips".
 *
 * ★ ONE STATEMENT PER PAGE. Assignment counts, live-event existence and the
 * latest completion state are correlated sub-selects, not follow-up queries.
 */

/** The most ids one lookup may resolve — the same ceiling as a page. */
export const LOOKUP_LIMIT = 200;

interface TripRow {
  trip_id: string;
  scheduled_on: string;
  pickup_at: Date | null;
  delivery_at: Date | null;
  status: TripStatus;
  archived: boolean;
  active_assignment_count: number;
  customer_id: string | null;
  customer_name: string | null;
}

interface AssignmentRow extends TripRow {
  assignment_id: string;
  driver_user_id: string;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  state: 'active' | 'ended';
  assigned_at: Date;
  ended_at: Date | null;
  has_live_events: boolean;
  latest_completion_state: CompletionState | null;
}

interface CompletionRow extends TripRow {
  request_id: string;
  assignment_id: string;
  attempt_no: number;
  request_state: 'pending' | 'approved' | 'rejected';
  submitted_at: Date;
  decided_at: Date | null;
}

/** Trip facts, aliased `t`, with the customer joined as `c`. */
const TRIP_FACTS = `
  t.id                  AS trip_id,
  t.scheduled_on::text  AS scheduled_on,
  t.pickup_at,
  t.delivery_at,
  t.status,
  (t.archived_at IS NOT NULL) AS archived,
  (SELECT count(*)::int FROM trip_driver_assignments da
    WHERE da.trip_id = t.id AND da.state = 'active') AS active_assignment_count,
  c.id                  AS customer_id,
  c.name                AS customer_name`;

const TRIP_FROM = `
  FROM trip_schedules t
  LEFT JOIN trip_customers c ON c.id = t.customer_id`;

/** Assignment facts, aliased `a`, over its trip. */
const ASSIGNMENT_FACTS = `
  a.id                  AS assignment_id,
  a.driver_user_id,
  a.vehicle_id,
  v.plate               AS vehicle_plate,
  a.state,
  a.assigned_at,
  a.ended_at,
  EXISTS (SELECT 1 FROM trip_execution_events e
           WHERE e.driver_assignment_id = a.id AND e.voided_at IS NULL) AS has_live_events,
  (SELECT r.state FROM trip_completion_requests r
    WHERE r.driver_assignment_id = a.id
    ORDER BY r.attempt_no DESC LIMIT 1) AS latest_completion_state,
  ${TRIP_FACTS}`;

const ASSIGNMENT_FROM = `
  FROM trip_driver_assignments a
  JOIN trip_schedules t ON t.id = a.trip_id
  LEFT JOIN trip_vehicles v ON v.id = a.vehicle_id
  LEFT JOIN trip_customers c ON c.id = t.customer_id`;

const COMPLETION_FACTS = `
  r.id                  AS request_id,
  r.driver_assignment_id AS assignment_id,
  r.attempt_no,
  r.state               AS request_state,
  r.submitted_at,
  r.decided_at,
  ${TRIP_FACTS}`;

const COMPLETION_FROM = `
  FROM trip_completion_requests r
  JOIN trip_schedules t ON t.id = r.trip_id
  LEFT JOIN trip_customers c ON c.id = t.customer_id`;

const toTrip = (row: TripRow): TripFacts => ({
  tripId: row.trip_id,
  scheduledOn: row.scheduled_on,
  pickupAt: row.pickup_at,
  deliveryAt: row.delivery_at,
  status: row.status,
  archived: row.archived,
  activeAssignmentCount: row.active_assignment_count,
  customer: row.customer_id && row.customer_name ? { id: row.customer_id, name: row.customer_name } : null,
});

const toAssignment = (row: AssignmentRow): AssignmentFacts => ({
  assignmentId: row.assignment_id,
  tripId: row.trip_id,
  driverUserId: row.driver_user_id,
  vehicleId: row.vehicle_id,
  vehiclePlate: row.vehicle_plate,
  state: row.state,
  assignedAt: row.assigned_at,
  endedAt: row.ended_at,
  hasLiveEvents: row.has_live_events,
  latestCompletionState: row.latest_completion_state ?? 'none',
  trip: toTrip(row),
});

const toCompletion = (row: CompletionRow): CompletionRequestFacts => ({
  requestId: row.request_id,
  assignmentId: row.assignment_id,
  tripId: row.trip_id,
  attemptNo: row.attempt_no,
  state: row.request_state,
  submittedAt: row.submitted_at,
  decidedAt: row.decided_at,
  trip: toTrip(row),
});

export interface WindowQuery {
  /**
   * The anchor range, as the half-open interval `(after, before]`.
   *
   * ★ HALF-OPEN SO RANGES CHAIN WITHOUT A GAP OR AN OVERLAP. A caller that
   * wants to walk one band before another asks for `(-inf, t]` and then
   * `(t, t + something]`: a row whose anchor is exactly `t` belongs to the
   * first and only the first. Two inclusive bounds would return it twice;
   * two exclusive ones would lose it.
   *
   * Both are TECHNICAL bounds the caller computes. This side never knows what
   * they mean — it does not know what "two hours before pickup" is, only how
   * to return rows inside an interval.
   */
  before: Date;
  after?: Date;
  limit: number;
  cursor?: string;
}

export interface SubjectIds {
  tripIds: readonly string[];
  assignmentIds: readonly string[];
  completionRequestIds: readonly string[];
}

@Injectable()
export class AiReadModelRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Trips with no active assignment whose pickup instant lies in
   * `(after, before]`. Archived and finished trips are out (they are not
   * work); trips with no `pickup_at` are out because the detector this feeds
   * keys on that instant alone (CEO: no `scheduled_on` fallback). Ordered by
   * `(pickup_at, id)` ascending — the soonest first WITHIN the band the
   * caller asked for.
   */
  async unassignedTrips(query: WindowQuery): Promise<Page<TripFacts>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db.query<TripRow & { cursor_at: string }>(
      `SELECT ${TRIP_FACTS}, t.pickup_at::text AS cursor_at
       ${TRIP_FROM}
       WHERE t.archived_at IS NULL
         AND t.status <> 'finished'
         AND t.pickup_at IS NOT NULL
         AND t.pickup_at <= $1::timestamptz
         AND ($2::timestamptz IS NULL OR t.pickup_at > $2::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM trip_driver_assignments da
                          WHERE da.trip_id = t.id AND da.state = 'active')
         AND ($3::timestamptz IS NULL OR (t.pickup_at, t.id) > ($3::timestamptz, $4::uuid))
       ORDER BY t.pickup_at ASC, t.id ASC
       LIMIT $5`,
      [query.before, query.after ?? null, cursor?.t ?? null, cursor?.i ?? null, query.limit + 1],
    );
    return toPage(
      rows.map((row) => ({ ...toTrip(row), id: row.trip_id, cursorAt: row.cursor_at })),
      query.limit,
    );
  }

  /**
   * Active assignments that have NOT started (no live execution event) on
   * live trips whose pickup instant is at or before the window. The
   * assignment's latest completion state is returned as a fact; whether it
   * excludes the assignment is the AI's rule.
   */
  async unstartedAssignments(query: WindowQuery): Promise<Page<AssignmentFacts>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db.query<AssignmentRow & { cursor_at: string }>(
      `SELECT ${ASSIGNMENT_FACTS}, t.pickup_at::text AS cursor_at
       ${ASSIGNMENT_FROM}
       WHERE a.state = 'active'
         AND t.archived_at IS NULL
         AND t.status <> 'finished'
         AND t.pickup_at IS NOT NULL
         AND t.pickup_at <= $1::timestamptz
         AND ($2::timestamptz IS NULL OR t.pickup_at > $2::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM trip_execution_events e
                          WHERE e.driver_assignment_id = a.id AND e.voided_at IS NULL)
         AND ($3::timestamptz IS NULL OR (t.pickup_at, a.id) > ($3::timestamptz, $4::uuid))
       ORDER BY t.pickup_at ASC, a.id ASC
       LIMIT $5`,
      [query.before, query.after ?? null, cursor?.t ?? null, cursor?.i ?? null, query.limit + 1],
    );
    return toPage(
      rows.map((row) => ({ ...toAssignment(row), id: row.assignment_id, cursorAt: row.cursor_at })),
      query.limit,
    );
  }

  /** Pending completion requests submitted at or before the window, oldest first. */
  async pendingCompletions(query: WindowQuery): Promise<Page<CompletionRequestFacts>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db.query<CompletionRow & { cursor_at: string }>(
      `SELECT ${COMPLETION_FACTS}, r.submitted_at::text AS cursor_at
       ${COMPLETION_FROM}
       WHERE r.state = 'pending'
         AND r.submitted_at <= $1::timestamptz
         AND ($2::timestamptz IS NULL OR r.submitted_at > $2::timestamptz)
         AND ($3::timestamptz IS NULL OR (r.submitted_at, r.id) > ($3::timestamptz, $4::uuid))
       ORDER BY r.submitted_at ASC, r.id ASC
       LIMIT $5`,
      [query.before, query.after ?? null, cursor?.t ?? null, cursor?.i ?? null, query.limit + 1],
    );
    return toPage(
      rows.map((row) => ({ ...toCompletion(row), id: row.request_id, cursorAt: row.cursor_at })),
      query.limit,
    );
  }

  /**
   * The current facts for named subjects — for the AI's Resolution phase.
   *
   * ★ NO FILTER AT ALL. An archived trip, a finished trip, an ended
   * assignment, an approved request: all come back with their state, because
   * "the condition has cleared" is a conclusion the AI must draw from FACTS
   * it received, never from an id that quietly fell out of a filtered list.
   * An id that is absent from the result does not exist.
   */
  async lookup(ids: SubjectIds): Promise<SubjectLookupResult> {
    const [trips, assignments, completionRequests] = await Promise.all([
      ids.tripIds.length === 0
        ? []
        : this.db.query<TripRow>(`SELECT ${TRIP_FACTS} ${TRIP_FROM} WHERE t.id = ANY($1::uuid[])`, [ids.tripIds]),
      ids.assignmentIds.length === 0
        ? []
        : this.db.query<AssignmentRow>(`SELECT ${ASSIGNMENT_FACTS} ${ASSIGNMENT_FROM} WHERE a.id = ANY($1::uuid[])`, [
            ids.assignmentIds,
          ]),
      ids.completionRequestIds.length === 0
        ? []
        : this.db.query<CompletionRow>(`SELECT ${COMPLETION_FACTS} ${COMPLETION_FROM} WHERE r.id = ANY($1::uuid[])`, [
            ids.completionRequestIds,
          ]),
    ]);

    return {
      trips: trips.map(toTrip),
      assignments: assignments.map(toAssignment),
      completionRequests: completionRequests.map(toCompletion),
    };
  }
}
