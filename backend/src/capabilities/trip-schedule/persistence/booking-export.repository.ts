import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../../common/types/database.port';
import type { BookingExport } from '../domain/booking-export';
import { IS_CREW } from './trip-schedule.repository';

/**
 * The booking export's read — the allowlist of `domain/booking-export.ts`,
 * decided HERE, in the SELECT.
 *
 * ★ NOT A BACKOFFICE ROW WITH FIELDS HIDDEN LATER. No price, cost, hire, note,
 * status or bookkeeping column is selected, and no money table is joined, so
 * no mapper can leak one (`tests/architecture/trip-write-paths.spec.ts` holds
 * that). The crew is the board's own (`IS_CREW`), folded into one JSON array so
 * the trip stays one row whatever its crew size.
 *
 * ★ THE BOARD'S VISIBILITY: an archived trip is not found, as on
 * `GET /trip-schedules/:id`. Finished trips are found — history is readable.
 */
interface BookingExportRow {
  scheduled_on: string;
  pickup_at: Date | null;
  delivery_at: Date | null;
  pickup_name: string | null;
  pickup_address: string | null;
  pickup_contact: string | null;
  delivery_name: string | null;
  delivery_address: string | null;
  delivery_contact: string | null;
  customer_name: string | null;
  cargo_info: string | null;
  driver_instructions: string | null;
  crew: Array<{ plate: string | null; driver_name: string }>;
}

@Injectable()
export class BookingExportRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(tripId: string): Promise<BookingExport | null> {
    const rows = await this.db.query<BookingExportRow>(
      `SELECT t.scheduled_on::text AS scheduled_on, t.pickup_at, t.delivery_at,
              pl.name AS pickup_name, t.pickup_address, t.pickup_contact,
              dl.name AS delivery_name, t.delivery_address, t.delivery_contact,
              c.name AS customer_name, t.cargo_info, t.driver_instructions,
              COALESCE(crew.members, '[]'::json) AS crew
         FROM trip_schedules t
         LEFT JOIN trip_customers c  ON c.id  = t.customer_id
         LEFT JOIN trip_locations pl ON pl.id = t.pickup_location_id
         LEFT JOIN trip_locations dl ON dl.id = t.delivery_location_id
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('plate', v.plate, 'driver_name', du.display_name)
                           ORDER BY a.assigned_at ASC, a.id ASC) AS members
             FROM trip_driver_assignments a
             JOIN users du ON du.id = a.driver_user_id
             LEFT JOIN trip_vehicles v ON v.id = a.vehicle_id
            WHERE a.trip_id = t.id AND ${IS_CREW}
         ) crew ON true
        WHERE t.id = $1 AND t.archived_at IS NULL`,
      [tripId],
    );
    return rows[0] ? toBookingExport(rows[0]) : null;
  }
}

/** Builds the object field by field — never a spread of the row. */
const toBookingExport = (row: BookingExportRow): BookingExport => ({
  scheduledOn: row.scheduled_on,
  scheduledPickupAt: row.pickup_at,
  scheduledDeliveryAt: row.delivery_at,
  pickup: { name: row.pickup_name, address: row.pickup_address, contact: row.pickup_contact },
  delivery: { name: row.delivery_name, address: row.delivery_address, contact: row.delivery_contact },
  customerName: row.customer_name,
  cargoInfo: row.cargo_info,
  driverInstructions: row.driver_instructions,
  crew: row.crew.map((member) => ({ plate: member.plate, driverName: member.driver_name })),
});
