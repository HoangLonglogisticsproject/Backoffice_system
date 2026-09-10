import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { DateRange } from './trip-schedule.repository';
import type { ExpenseDeclaration } from '../domain/trip-execution';

/**
 * One aggregated row per ASSIGNMENT: the plan, what that lorry reported, and
 * where that turn's paperwork stands. A trip with nobody on it is one row with
 * no assignment, so "NO_DRIVER" is still a finding the board can make.
 *
 * ★ THE ASSIGNMENT IS THE UNIT (ADR-0004). Execution and completion belong to a
 * lorry's turn, not to the trip: two lorries on one trip are two timelines and
 * two reviews. A trip-level row would have to merge them, and a merged timeline
 * says nothing true about either. The review queue below is therefore one row
 * per outstanding REQUEST, which is what a reviewer decides.
 *
 * ★ ONE STATEMENT, NOT N+1. A board showing a month of trips would otherwise
 * issue four queries per row — events, assignment, completion, catalogue — and
 * a hundred trips would be four hundred round trips for a screen somebody
 * refreshes all day.
 *
 * ★ AND THE AGGREGATION IS `FILTER`, NOT FOUR LEFT JOINS. Joining the event
 * table four times multiplies the rows before anything can be read off them.
 * `MIN(...) FILTER (WHERE event_type = ...)` collapses each trip's events to one
 * row inside a single scan.
 *
 * ★ `MIN`, MEANING THE FIRST OCCURRENCE, AND THAT IS A TECHNICAL TIE-BREAK
 * RATHER THAN A BUSINESS RULE. `client_event_id` already stops a retry
 * duplicating an event, but nothing stops a driver reporting ARRIVED_PICKUP
 * twice with two different ids. Which one is canonical when that happens is an
 * open decision; until it is taken, the FIRST arrival is treated as the
 * arrival, because that is the reading that cannot make a trip look earlier
 * than it was. Voided events are excluded throughout.
 */

interface BoardRow {
  trip_id: string;
  scheduled_on: string;
  /** The assignment this row is about; `null` on a trip with nobody on it. */
  assignment_id: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  customer_id: string | null;
  customer_name: string | null;
  driver_user_id: string | null;
  driver_display_name: string | null;
  pickup_at: Date | null;
  delivery_at: Date | null;
  arrived_pickup_at: Date | null;
  pickup_confirmed_at: Date | null;
  arrived_delivery_at: Date | null;
  delivery_confirmed_at: Date | null;
  /** The latest attempt on this assignment, if any. */
  completion_request_id: string | null;
  completion_state: 'pending' | 'approved' | 'rejected' | null;
  expense_declaration: ExpenseDeclaration | null;
  decision_reason: string | null;
  completion_attempts: string;
}

export type OperationalBoardRecord = BoardRow;

/**
 * The latest attempt per ASSIGNMENT, and how many there have been.
 *
 * `DISTINCT ON` is PostgreSQL's way of saying "one row per assignment, the one
 * with the highest attempt" without a window function and a filter around it.
 *
 * ★ THE NEWEST ATTEMPT IS ALSO THE APPROVED ONE WHEREVER THERE IS ONE.
 * `uq_assignment_completion_approved` allows exactly one approval per
 * assignment ever, and nothing can be submitted on an approved turn — so no
 * later attempt can exist after it. Ordering by `attempt_no DESC` therefore
 * needs no special case for approval.
 */
const LATEST_COMPLETION = `
  SELECT DISTINCT ON (r.driver_assignment_id)
         r.driver_assignment_id,
         r.id               AS completion_request_id,
         r.state            AS completion_state,
         r.expense_declaration,
         r.decision_reason,
         count(*) OVER (PARTITION BY r.driver_assignment_id) AS completion_attempts
    FROM trip_completion_requests r
   ORDER BY r.driver_assignment_id, r.attempt_no DESC`;

/**
 * The four reported times, one row per ASSIGNMENT.
 *
 * `FILTER` rather than four self-joins: joining the event table four times
 * multiplies rows before anything can be read off them.
 */
/**
 * The canonical reading of each milestone — DL-86.
 *
 * ★ ARRIVING AND FINISHING ARE NOT THE SAME SHAPE OF FACT, so they are not read
 * the same way.
 *
 *   ARRIVED_*    the FIRST non-voided reading. Arriving is a moment: the first
 *                time the lorry was at the place. A later duplicate cannot make
 *                the trip look as though it got there later than it did.
 *
 *   CONFIRMED_*  the LAST non-voided reading. Finishing is a state: a driver who
 *                confirms, loads more, and confirms again finished at the SECOND
 *                confirmation. Taking the first would close the step while work
 *                was still happening.
 *
 * ★ AND THE TIE-BREAK IS DETERMINISTIC, three deep: `actual_at`, then
 * `recorded_at`, then `id`. Two events sharing an instant is not hypothetical —
 * the server stamps `actual_at` and two taps can land in the same millisecond —
 * and `min()`/`max()` alone would then pick whichever the planner happened to
 * scan first, so the same data could report two different figures on two runs.
 * `DISTINCT ON` with a full ordering cannot.
 *
 * Voided events are excluded throughout: a withdrawn reading is not a reading.
 */
const EVENTS = `
  SELECT driver_assignment_id,
         max(actual_at) FILTER (WHERE event_type = 'ARRIVED_PICKUP')     AS arrived_pickup_at,
         max(actual_at) FILTER (WHERE event_type = 'PICKUP_CONFIRMED')   AS pickup_confirmed_at,
         max(actual_at) FILTER (WHERE event_type = 'ARRIVED_DELIVERY')   AS arrived_delivery_at,
         max(actual_at) FILTER (WHERE event_type = 'DELIVERY_CONFIRMED') AS delivery_confirmed_at
    FROM (
      SELECT DISTINCT ON (e.driver_assignment_id, e.event_type)
             e.driver_assignment_id, e.event_type, e.actual_at
        FROM trip_execution_events e
       WHERE e.voided_at IS NULL
       ORDER BY e.driver_assignment_id,
                e.event_type,
                -- ★ FIRST for an arrival, LAST for a confirmation, and the two
                -- remaining keys make the choice reproducible when instants tie.
                CASE WHEN e.event_type IN ('ARRIVED_PICKUP', 'ARRIVED_DELIVERY')
                     THEN e.actual_at END ASC,
                CASE WHEN e.event_type IN ('PICKUP_CONFIRMED', 'DELIVERY_CONFIRMED')
                     THEN e.actual_at END DESC,
                e.recorded_at ASC,
                e.id ASC
    ) canonical
   GROUP BY driver_assignment_id`;

@Injectable()
export class OperationalBoardRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Every active assignment on every trip in the range, with its operational
   * facts — plus one row for each trip that has nobody on it.
   *
   * ⚠ THE DATE RANGE IS MANDATORY, and it is the same one ADR-0003 requires of
   * the dispatch board — for the same reason. An unbounded scan of every trip
   * ever run is not a screen anybody wants and not a query this should offer.
   *
   * Archived trips are excluded: a row taken off the board is not work in
   * progress, which is the only thing this view is about.
   */
  async listInRange(range: DateRange, executor: DatabaseQuery = this.db): Promise<BoardRow[]> {
    return executor.query<BoardRow>(
      `${BOARD_SELECT}
        WHERE t.scheduled_on >= $1::date
          AND t.scheduled_on <= $2::date
          AND t.archived_at IS NULL
        ORDER BY t.scheduled_on DESC, t.id DESC, a.assigned_at ASC, a.id ASC`,
      [range.from, range.to],
    );
  }

  /**
   * Every completion request NOT yet concluded, whatever month its trip ran —
   * one row per request, which is what a reviewer decides.
   *
   * ★ NO DATE RANGE, AND THAT IS THE POINT OF THE METHOD.
   *
   * A completion submitted on the 30th and still undecided on the 1st is not
   * last month's — it is work outstanding today. Filtering the review queue by
   * `scheduled_on` made it disappear at midnight on the last day of the month,
   * which is exactly when somebody needs it most. The trip's schedule and the
   * reviewer's workload are different axes.
   *
   * ★ AND IT IS BOUNDED WITHOUT ONE. `uq_assignment_completion_pending` allows
   * one pending request per assignment, and a decided turn leaves the set for
   * good, so this returns "reviews not yet done" — the same argument ADR-0002
   * §4 makes for the short lists. A queue that grows large is the alarm, not
   * the problem: hiding it behind a date filter would silence exactly that
   * signal.
   *
   * `rejected` is included because a turn sent back is still the company's
   * outstanding work; it waits on the driver rather than on the reviewer, and
   * dropping it off the screen is how it is forgotten.
   */
  async listUnresolvedCompletions(executor: DatabaseQuery = this.db): Promise<BoardRow[]> {
    return executor.query<BoardRow>(
      `${BOARD_SELECT}
        WHERE t.archived_at IS NULL
          AND completion.completion_state IN ('pending', 'rejected')
        ORDER BY t.scheduled_on ASC, t.id ASC, a.assigned_at ASC, a.id ASC`,
      [],
    );
  }
}

/**
 * The projection both reads share. Only the WHERE differs.
 *
 * ★ ONE ROW PER ACTIVE ASSIGNMENT, BY DESIGN. The LEFT JOIN onto the active
 * assignments multiplies a trip by its crew, and here that is the intended
 * shape: each row is one lorry's turn, with that turn's events and that turn's
 * completion joined by `a.id`. A trip with no active assignment still yields
 * one row, with every assignment column null. The dispatch list, which counts
 * and pages TRIPS, does the opposite and aggregates — see
 * `trip-schedule.repository.ts`.
 *
 * The lorry is the assignment's (`a.vehicle_id`), never the trip's legacy column.
 */
const BOARD_SELECT = `
       WITH events AS (${EVENTS}),
            completion AS (${LATEST_COMPLETION})
       SELECT t.id                   AS trip_id,
              t.scheduled_on::text   AS scheduled_on,
              t.pickup_at,
              t.delivery_at,
              a.id                   AS assignment_id,
              v.id                   AS vehicle_id,
              v.plate                AS vehicle_plate,
              c.id                   AS customer_id,
              c.name                 AS customer_name,
              a.driver_user_id,
              u.display_name         AS driver_display_name,
              events.arrived_pickup_at,
              events.pickup_confirmed_at,
              events.arrived_delivery_at,
              events.delivery_confirmed_at,
              completion.completion_request_id,
              completion.completion_state,
              completion.expense_declaration,
              completion.decision_reason,
              COALESCE(completion.completion_attempts, 0) AS completion_attempts
         FROM trip_schedules t
         LEFT JOIN trip_customers c ON c.id = t.customer_id
         LEFT JOIN trip_driver_assignments a
                ON a.trip_id = t.id AND a.state = 'active'
         LEFT JOIN trip_vehicles v  ON v.id = a.vehicle_id
         LEFT JOIN users u          ON u.id = a.driver_user_id
         LEFT JOIN events           ON events.driver_assignment_id = a.id
         LEFT JOIN completion       ON completion.driver_assignment_id = a.id`;
