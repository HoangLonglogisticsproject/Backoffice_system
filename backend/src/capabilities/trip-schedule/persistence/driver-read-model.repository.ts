import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { DriverTrip } from '../domain/driver-read-model';
import type { Coordinates } from '../domain/trip-location';

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
 * LEFT JOIN on both catalogues: a trip may have no lorry and no customer yet.
 */
const FROM_ASSIGNMENT = `
    FROM trip_driver_assignments a
    JOIN trip_schedules t   ON t.id = a.trip_id
    LEFT JOIN trip_vehicles v  ON v.id = t.vehicle_id
    LEFT JOIN trip_customers c ON c.id = t.customer_id`;

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
   * The trips this driver is on right now.
   *
   * Not paginated, for the reason ADR-0002 §4 gives for the short lists: a
   * driver has one lorry and a handful of live trips, and a cursor on a list
   * that never exceeds a screen is machinery with nothing to do.
   *
   * Archived trips are excluded — a row taken off the board is not work.
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
          AND t.archived_at IS NULL
        ORDER BY t.scheduled_on DESC, t.id DESC`,
      [driverUserId],
    );
    return rows.map(toDriverTrip);
  }

  /**
   * One trip, if it is this driver's.
   *
   * Returns `null` for a trip that exists but belongs to somebody else, which
   * the service turns into the same 404 a missing trip gets: telling a caller
   * that a trip exists but is not theirs is telling them something about
   * somebody else's work.
   */
  async findForDriver(
    tripId: string,
    driverUserId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DriverTrip | null> {
    const rows = await executor.query<DriverTripRow>(
      `SELECT ${DRIVER_TRIP_COLUMNS}
       ${FROM_ASSIGNMENT}
        WHERE a.trip_id = $1
          AND a.driver_user_id = $2
          AND a.state = 'active'
          AND t.archived_at IS NULL`,
      [tripId, driverUserId],
    );
    return rows[0] ? toDriverTrip(rows[0]) : null;
  }
}
