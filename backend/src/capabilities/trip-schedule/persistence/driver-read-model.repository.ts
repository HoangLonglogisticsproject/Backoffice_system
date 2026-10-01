import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { DriverTrip } from '../domain/driver-read-model';
import type { Coordinates } from '../domain/trip-location';
import { LIFECYCLE_PREDICATE } from './trip-schedule.repository';

/**
 * The driver's view of the board, as SQL.
 *
 * ★ THE COLUMN LIST BELOW IS A SECURITY BOUNDARY, NOT A PERFORMANCE CHOICE.
 *
 * `SELECT *` here would hand a driver every column `trip_schedules` has today
 * and every column it gains later — which is how a `margin` added next year
 * reaches a phone with no test failing and nobody deciding it should. Each
 * column is named, and `note` is absent because the contract has never said who
 * writes it or what belongs in it.
 *
 * ★ AND NOTHING IN THIS FILE JOINS `trip_costs` OR `trip_outsource_hires`.
 * That is what makes "a driver sees no money" true by CONSTRUCTION rather than
 * by filtering: there is no amount in the result set to leak, so no future edit
 * to a mapper can accidentally pass one through.
 *
 * ⚠ EVERY QUERY FILTERS ON `driver_user_id`, EVEN THE ONE ALREADY GUARDED.
 * `ActiveAssignmentGuard` refuses another driver's trip before a handler runs,
 * so the filter here is redundant — deliberately. A guard is a decorator
 * somebody can forget to write; a WHERE clause is not. If the guard is ever
 * omitted from a route, these queries return nothing rather than somebody
 * else's trip.
 */

/**
 * ★ `scheduled_on::text`, NOT the `DATE` itself. `pg` turns a `DATE` into a
 * `Date` at midnight UTC, which is the previous evening in Hồ Chí Minh — a
 * trip scheduled for the 30th shows as the 29th. The same cast the board's own
 * read uses, for the same reason.
 */
const DRIVER_TRIP_COLUMNS = `
         t.id                  AS trip_id,
         t.scheduled_on::text  AS scheduled_on,
         t.pickup_address,
         t.pickup_contact,
         t.delivery_address,
         t.delivery_contact,
         t.cargo_info,
         t.pickup_at,
         t.delivery_at,
         t.pickup_latitude,
         t.pickup_longitude,
         t.delivery_latitude,
         t.delivery_longitude,
         t.driver_instructions,
         v.id                  AS vehicle_id,
         v.plate               AS vehicle_plate,
         c.id                  AS customer_id,
         c.name                AS customer_name,
         a.id                  AS assignment_id,
         a.assigned_at`;

/**
 * Driven from the ASSIGNMENT, not from the trip.
 *
 * Starting at `trip_driver_assignments` and joining outwards means the driver's
 * own rows are the only possible starting point — a trip with no assignment for
 * this caller cannot enter the result at all. Starting at `trip_schedules` and
 * filtering afterwards would give the same answer today and would be one
 * mistaken `OR` away from giving a different one.
 *
 * ★ THE LORRY IS THE ASSIGNMENT'S (`a.vehicle_id`), never the trip's legacy
 * column: a driver holding two lorries on one trip sees each turn with its own
 * plate. Both joins LEFT: a trip may have no customer yet, and the WHERE clauses
 * below exclude the pre-0027 turns that still name no lorry.
 */
const FROM_ASSIGNMENT = `
    FROM trip_driver_assignments a
    JOIN trip_schedules t   ON t.id = a.trip_id
    LEFT JOIN trip_vehicles v  ON v.id = a.vehicle_id
    LEFT JOIN trip_customers c ON c.id = t.customer_id`;

/**
 * ★ WHICH OF THEIR OWN TURNS A DRIVER MAY OPEN — TO READ, NEVER TO ACT.
 *
 * Their live work (`active`), and every turn of theirs on a trip that has finished,
 * whatever became of the turn: approved, replaced before the end, or recorded
 * after the run ("Nhập chuyến cũ"). That is exactly the union of the two lists
 * above, so a card in either one opens. It is the TRIP's terminal state, never
 * `end_reason` — how a turn ended grants nothing.
 *
 * Acting is a different question with a different answer, and nothing here
 * widens it: every write route keeps `ActiveAssignmentGuard`, and every write
 * service refuses a closed trip under its own lock.
 */
const READABLE_BY_ITS_DRIVER = `(a.state = 'active' OR t.status = 'finished')`;

interface DriverTripRow {
  trip_id: string;
  scheduled_on: string;
  pickup_address: string | null;
  pickup_contact: string | null;
  delivery_address: string | null;
  delivery_contact: string | null;
  cargo_info: string | null;
  pickup_at: Date | null;
  delivery_at: Date | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  driver_instructions: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  customer_id: string | null;
  customer_name: string | null;
  assignment_id: string;
  assigned_at: Date;
}

/** Both halves or nothing — 0019's CHECK makes any other row impossible. */
const point = (latitude: number | null, longitude: number | null): Coordinates | null =>
  latitude !== null && longitude !== null ? { latitude, longitude } : null;

const toDriverTrip = (row: DriverTripRow): DriverTrip => ({
  tripId: row.trip_id,
  scheduledOn: row.scheduled_on,
  // Built field by field rather than spread: a spread of the row would carry
  // whatever the row happens to hold, which is the blacklist mistake wearing a
  // different hat.
  vehicle: row.vehicle_id && row.vehicle_plate ? { id: row.vehicle_id, plate: row.vehicle_plate } : null,
  customer: row.customer_id && row.customer_name ? { id: row.customer_id, name: row.customer_name } : null,
  pickupAddress: row.pickup_address,
  pickupContact: row.pickup_contact,
  deliveryAddress: row.delivery_address,
  deliveryContact: row.delivery_contact,
  cargoInfo: row.cargo_info,
  pickupLocation: point(row.pickup_latitude, row.pickup_longitude),
  deliveryLocation: point(row.delivery_latitude, row.delivery_longitude),
  scheduledPickupAt: row.pickup_at,
  scheduledDeliveryAt: row.delivery_at,
  driverInstructions: row.driver_instructions,
  assignment: { id: row.assignment_id, assignedAt: row.assigned_at },
});

@Injectable()
export class DriverTripReadModelRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The assignments this driver holds right now — one row per lorry, so a
   * driver on two lorries of one trip gets that trip twice, each with its plate.
   *
   * Not paginated, for the reason ADR-0002 §4 gives for the short lists: a
   * driver holds a handful of live turns, and a cursor on a list that never
   * exceeds a screen is machinery with nothing to do.
   *
   * Archived trips are excluded — a row taken off the board is not work. So
   * are the pre-0027 turns with no lorry: there is nothing to drive.
   *
   * ★ AND A FINISHED TRIP IS NOT WORK EITHER, whatever its turn's state: the
   * same `status <> 'finished'` as Lịch xe. Approval leaves turns `active`, and
   * "Đã xác nhận" or the legacy normalization close trips whose turns never
   * ended — all of them are "Đã chạy xong" now (`listFinishedForDriver`),
   * opened read-only, never listed as something still to do.
   */
  async listForDriver(
    driverUserId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DriverTrip[]> {
    const rows = await executor.query<DriverTripRow>(
      `SELECT ${DRIVER_TRIP_COLUMNS}
       ${FROM_ASSIGNMENT}
        WHERE a.driver_user_id = $1
          AND a.state = 'active'
          AND a.vehicle_id IS NOT NULL
          AND t.archived_at IS NULL
          ${LIFECYCLE_PREDICATE.operational}
        ORDER BY t.scheduled_on DESC, t.id DESC, a.assigned_at ASC, a.id ASC`,
      [driverUserId],
    );
    return rows.map(toDriverTrip);
  }

  /**
   * The trips this driver has already run to the end.
   *
   * ★ `t.status = 'finished'` IS THE WHOLE DEFINITION, AND IT IS NOT THE TURN'S
   * STATE. A completed trip leaves its assignments `active` (DL-97: the trip
   * closes when every active assignment has been approved), so filtering on
   * `a.state = 'ended'` would return the opposite of this list — the turns
   * somebody was taken OFF, and none of the work they actually finished.
   *
   * Filtering on the TRIP also means a driver swapped out of a trip that later
   * finished still sees it, which is right: they drove part of it. What they
   * are not shown is WHY they were swapped — `end_reason` is free text written
   * by Operations, and §5.2 keeps unclassified free text away from a driver for
   * the same reason `note` is absent from this file entirely.
   *
   * ★ NO NEW COLUMN IS SELECTED, AND THAT IS DELIBERATE. Every row here is
   * finished by construction, so there is no outcome to report; and `status`
   * itself is the dispatch board's vocabulary, which `DriverTrip` documents as
   * out of scope for a driver. The whitelist is unchanged, so this query cannot
   * leak anything the live list could not.
   *
   * ★ KEYSET, NOT OFFSET (ADR-0002). This list only grows, and it is read from
   * a phone: `OFFSET` re-walks every earlier row on each page, and a row
   * arriving mid-scroll shifts everything by one. The cursor is the pair
   * `(assigned_at, id)` — `assigned_at` alone is not unique, since one dispatch
   * action can create several turns in the same statement.
   *
   * `ORDER BY a.assigned_at DESC, a.id DESC` is exactly
   * `idx_trip_driver_assignment_driver_history` from 0023, which was created
   * for this screen and until now had no reader.
   */
  async listFinishedForDriver(
    driverUserId: string,
    { limit, before }: { limit: number; before: { assignedAt: Date; id: string } | null },
    executor: DatabaseQuery = this.db,
  ): Promise<DriverTrip[]> {
    // One statement either way: a `null` cursor is the first page, and passing
    // the bound as two nullable parameters keeps the SQL single rather than
    // branching into two near-identical strings that can drift apart.
    const rows = await executor.query<DriverTripRow>(
      `SELECT ${DRIVER_TRIP_COLUMNS}
       ${FROM_ASSIGNMENT}
        WHERE a.driver_user_id = $1
          AND t.status = 'finished'
          AND a.vehicle_id IS NOT NULL
          AND t.archived_at IS NULL
          AND ($3::timestamptz IS NULL OR (a.assigned_at, a.id) < ($3::timestamptz, $4::uuid))
        ORDER BY a.assigned_at DESC, a.id DESC
        LIMIT $2`,
      [driverUserId, limit, before?.assignedAt ?? null, before?.id ?? null],
    );
    return rows.map(toDriverTrip);
  }

  /**
   * One assignment, if it is this driver's and they may read it
   * (`READABLE_BY_ITS_DRIVER`), with whether its trip is closed.
   *
   * Returns `null` for an assignment that exists but belongs to somebody else,
   * which the service turns into the same 404 a missing one gets: telling a
   * caller that it exists but is not theirs is telling them something about
   * somebody else's work. `ReadableAssignmentGuard` asks this same statement,
   * so the route and the service cannot disagree about who may open what.
   */
  async findForDriver(
    assignmentId: string,
    driverUserId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<(DriverTrip & { closed: boolean }) | null> {
    const rows = await executor.query<DriverTripRow & { closed: boolean }>(
      `SELECT ${DRIVER_TRIP_COLUMNS},
              t.status = 'finished' AS closed
       ${FROM_ASSIGNMENT}
        WHERE a.id = $1
          AND a.driver_user_id = $2
          AND ${READABLE_BY_ITS_DRIVER}
          AND a.vehicle_id IS NOT NULL
          AND t.archived_at IS NULL`,
      [assignmentId, driverUserId],
    );
    const row = rows[0];
    return row ? { ...toDriverTrip(row), closed: row.closed } : null;
  }
}
