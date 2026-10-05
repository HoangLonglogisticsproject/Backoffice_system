import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  AssignmentRequestState,
  DriverOpenBooking,
  DriverOpenBookingItem,
  TripAssignmentRequest,
} from '../domain/trip-assignment-request';

/**
 * The driver-safe reads of bookings that are not the driver's (0035).
 *
 * ★ THE PROJECTION IS DECIDED HERE, IN THE SELECT. Not a backoffice row with
 * fields hidden later: no price, cost, hire, customer, contact or address
 * column is ever selected, so none can leak through a forgotten mapper. Each
 * end is a place NAME (the free-text pickup line only when the trip has no
 * place on file) and its AREA.
 */

/**
 * ★ "OPEN", SAID ONCE. Booked and untouched (`pending` — not the retired
 * `confirmed`, not executing, not finished), on the board, and nobody on it.
 * Phase 1: a trip with any active turn is not open, even if it needs a second
 * lorry. Both the list and every write that depends on openness ask this.
 */
const OPEN_BOOKING = `
  t.archived_at IS NULL
  AND t.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM trip_driver_assignments a WHERE a.trip_id = t.id AND a.state = 'active')`;

const BOOKING_COLUMNS = `
  t.id AS trip_id, t.scheduled_on::text AS scheduled_on, t.pickup_at, t.delivery_at,
  t.cargo_info, t.driver_instructions,
  COALESCE(pl.name, t.pickup_address) AS pickup_name,
  NULLIF(concat_ws(', ', pl.ward, pl.district, pl.province), '') AS pickup_area,
  COALESCE(dl.name, t.delivery_address) AS delivery_name,
  NULLIF(concat_ws(', ', dl.ward, dl.district, dl.province), '') AS delivery_area`;

const BOOKING_FROM = `
  FROM trip_schedules t
  LEFT JOIN trip_locations pl ON pl.id = t.pickup_location_id
  LEFT JOIN trip_locations dl ON dl.id = t.delivery_location_id`;

interface BookingRow {
  trip_id: string;
  scheduled_on: string;
  pickup_at: Date | null;
  delivery_at: Date | null;
  cargo_info: string | null;
  driver_instructions: string | null;
  pickup_name: string | null;
  pickup_area: string | null;
  delivery_name: string | null;
  delivery_area: string | null;
}

const toBooking = (row: BookingRow): DriverOpenBooking => ({
  tripId: row.trip_id,
  scheduledOn: row.scheduled_on,
  scheduledPickupAt: row.pickup_at,
  scheduledDeliveryAt: row.delivery_at,
  pickup: { name: row.pickup_name, area: row.pickup_area },
  delivery: { name: row.delivery_name, area: row.delivery_area },
  cargoInfo: row.cargo_info,
  driverInstructions: row.driver_instructions,
});

type RequestBookingRow = BookingRow & {
  id: string;
  driver_user_id: string;
  state: AssignmentRequestState;
  requested_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  approved_assignment_id: string | null;
  resolution_reason: string | null;
};

/**
 * ponytail: fixed caps, no paging. Open bookings from today on are tens, and a
 * driver's own asks are read newest first; page when either outgrows its cap.
 */
const OPEN_BOOKING_CAP = 200;
const OWN_REQUEST_CAP = 50;

@Injectable()
export class OpenBookingRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Open bookings from `fromDay` on, soonest first, each with the caller's own pending ask. */
  async listOpen(driverUserId: string, fromDay: string): Promise<DriverOpenBookingItem[]> {
    const rows = await this.db.query<BookingRow & { my_pending_request_id: string | null }>(
      `SELECT ${BOOKING_COLUMNS}, mine.id AS my_pending_request_id
         ${BOOKING_FROM}
         LEFT JOIN trip_assignment_requests mine
                ON mine.trip_id = t.id AND mine.driver_user_id = $1 AND mine.state = 'pending'
        WHERE ${OPEN_BOOKING} AND t.scheduled_on >= $2::date
        ORDER BY t.scheduled_on, t.pickup_at NULLS LAST, t.id
        LIMIT ${OPEN_BOOKING_CAP}`,
      [driverUserId, fromDay],
    );
    return rows.map((row) => ({ ...toBooking(row), myPendingRequestId: row.my_pending_request_id }));
  }

  /**
   * The trip as an open booking, or `null` when it is not one right now.
   * Asked under the caller's trip lock, so the answer holds until it commits.
   */
  async findOpen(tripId: string, tx: DatabaseQuery): Promise<DriverOpenBooking | null> {
    const rows = await tx.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE t.id = $1 AND ${OPEN_BOOKING}`,
      [tripId],
    );
    return rows[0] ? toBooking(rows[0]) : null;
  }

  /** The safe projection of one trip, open or not — what a driver's own request shows. */
  async findBooking(tripId: string, executor: DatabaseQuery = this.db): Promise<DriverOpenBooking | null> {
    const rows = await executor.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE t.id = $1`, [tripId]);
    return rows[0] ? toBooking(rows[0]) : null;
  }

  /** A driver's own asks, newest first, each with its booking — one statement. */
  async listRequestsOf(
    driverUserId: string,
  ): Promise<Array<{ request: TripAssignmentRequest; booking: DriverOpenBooking }>> {
    const rows = await this.db.query<RequestBookingRow>(
      `SELECT r.id, r.driver_user_id, r.state, r.requested_at, r.resolved_at, r.resolved_by,
              r.approved_assignment_id, r.resolution_reason, ${BOOKING_COLUMNS}
         FROM trip_assignment_requests r
         JOIN trip_schedules t ON t.id = r.trip_id
         LEFT JOIN trip_locations pl ON pl.id = t.pickup_location_id
         LEFT JOIN trip_locations dl ON dl.id = t.delivery_location_id
        WHERE r.driver_user_id = $1
        ORDER BY r.requested_at DESC, r.id DESC
        LIMIT ${OWN_REQUEST_CAP}`,
      [driverUserId],
    );
    return rows.map((row) => ({
      request: {
        id: row.id,
        tripId: row.trip_id,
        driverUserId: row.driver_user_id,
        state: row.state,
        requestedAt: row.requested_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        approvedAssignmentId: row.approved_assignment_id,
        resolutionReason: row.resolution_reason,
      },
      booking: toBooking(row),
    }));
  }
}
