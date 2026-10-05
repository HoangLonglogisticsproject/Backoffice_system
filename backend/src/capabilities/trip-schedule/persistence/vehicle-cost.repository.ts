import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripCostSource } from '../domain/trip-execution';
import type { VehicleCost, VehicleCostCategory } from '../domain/vehicle-fuel';

/**
 * A lorry's cost ledger, as SQL (0034).
 *
 * ★ NO UPDATE AND NO DELETE. A figure is final once written — 0034's trigger
 * allows only a void — and phase 1 writes no void, so neither is spelled here.
 *
 * ★ `::text` ON EVERY DECIMAL, as `trip-cost.repository.ts` does and for its
 * reason: no `setTypeParser` anywhere in the process can turn them into floats.
 */

interface VehicleCostRow {
  id: string;
  vehicle_id: string;
  business_date: string;
  category: VehicleCostCategory;
  amount: string;
  liters: string | null;
  odometer_km: number | null;
  note: string | null;
  source: TripCostSource;
  source_trip_id: string | null;
  source_trip_scheduled_on: string | null;
  source_trip_customer_name: string | null;
  source_assignment_id: string | null;
  created_by: string;
  created_by_display_name: string;
  created_at: Date;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
}

/** The totals ride on every row; the cost columns are null on the one row of an empty page. */
type PageRow = { row_count: number; total_amount: string } & (
  | VehicleCostRow
  | { [K in keyof VehicleCostRow]: null }
);

const toVehicleCost = (row: VehicleCostRow): VehicleCost => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  businessDate: row.business_date,
  category: row.category,
  amount: row.amount,
  liters: row.liters,
  odometerKm: row.odometer_km,
  note: row.note,
  source: row.source,
  sourceTripId: row.source_trip_id,
  sourceTrip:
    row.source_trip_id && row.source_trip_scheduled_on
      ? { id: row.source_trip_id, scheduledOn: row.source_trip_scheduled_on, customerName: row.source_trip_customer_name }
      : null,
  sourceAssignmentId: row.source_assignment_id,
  createdBy: row.created_by,
  createdByUser: { id: row.created_by, displayName: row.created_by_display_name },
  createdAt: row.created_at,
  voidedAt: row.voided_at,
  voidedBy: row.voided_by,
  voidReason: row.void_reason,
});

@Injectable()
export class VehicleCostRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes one fill. The id is the caller's: a daily check names it before
   * this row exists, which is why that foreign key is deferred (0034).
   */
  async insert(
    input: {
      id: string;
      vehicleId: string;
      businessDate: string;
      category: VehicleCostCategory;
      amount: string;
      liters: string | null;
      odometerKm: number | null;
      note: string | null;
      source: TripCostSource;
      sourceTripId: string | null;
      sourceAssignmentId: string | null;
      clientRequestId: string | null;
      createdBy: string;
    },
    executor: DatabaseQuery,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO vehicle_costs
         (id, vehicle_id, business_date, category, amount, liters, odometer_km, note,
          source, source_trip_id, source_assignment_id, client_request_id, created_by)
       VALUES ($1, $2, $3::date, $4, $5::numeric, $6::numeric, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.id,
        input.vehicleId,
        input.businessDate,
        input.category,
        input.amount,
        input.liters,
        input.odometerKm,
        input.note,
        input.source,
        input.sourceTripId,
        input.sourceAssignmentId,
        input.clientRequestId,
        input.createdBy,
      ],
    );
  }

  /**
   * One page of a lorry's live costs over a business-date range, with the row
   * count and the money total of the WHOLE filter.
   *
   * ★ ONE STATEMENT. The totals and the page come from the same snapshot, and
   * a page past the end still carries them — the LEFT JOIN keeps the totals'
   * single row when the page itself is empty.
   *
   * The source trip and its customer are joined by primary key — at most one
   * row each, so neither can multiply a fill into the count or the sum.
   */
  async page(
    vehicleId: string,
    filter: { from: string; to: string; category: VehicleCostCategory | null },
    limit: number,
    offset: number,
  ): Promise<{ items: VehicleCost[]; total: number; totalAmount: string }> {
    const rows = await this.db.query<PageRow>(
      `WITH matching AS (
         SELECT c.*, u.display_name AS created_by_display_name,
                st.scheduled_on::text AS source_trip_scheduled_on,
                sc.name AS source_trip_customer_name
           FROM vehicle_costs c
           JOIN users u ON u.id = c.created_by
           LEFT JOIN trip_schedules st ON st.id = c.source_trip_id
           LEFT JOIN trip_customers sc ON sc.id = st.customer_id
          WHERE c.vehicle_id = $1
            AND c.business_date BETWEEN $2::date AND $3::date
            AND c.voided_at IS NULL
            AND ($4::text IS NULL OR c.category = $4)
       ), totals AS (
         SELECT COUNT(*)::int AS row_count,
                COALESCE(SUM(amount), 0)::numeric(14,2)::text AS total_amount
           FROM matching
       )
       SELECT totals.row_count, totals.total_amount,
              p.id, p.vehicle_id, p.business_date::text AS business_date, p.category,
              p.amount::text AS amount, p.liters::text AS liters, p.odometer_km, p.note,
              p.source, p.source_trip_id, p.source_trip_scheduled_on, p.source_trip_customer_name,
              p.source_assignment_id, p.created_by,
              p.created_by_display_name, p.created_at, p.voided_at, p.voided_by, p.void_reason
         FROM totals
         LEFT JOIN LATERAL (
           SELECT * FROM matching
            ORDER BY business_date DESC, created_at DESC, id DESC
            LIMIT $5 OFFSET $6
         ) p ON true`,
      [vehicleId, filter.from, filter.to, filter.category, limit, offset],
    );
    const first = rows[0];
    return {
      items: rows.filter((row): row is PageRow & VehicleCostRow => row.id !== null).map(toVehicleCost),
      total: first?.row_count ?? 0,
      totalAmount: first?.total_amount ?? '0.00',
    };
  }
}
