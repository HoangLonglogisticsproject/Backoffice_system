import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { FuelReviewEvent, FuelReviewStatus, FuelSubmission } from '../domain/fuel-review';

export interface SubmissionFilter {
  statuses?: readonly FuelReviewStatus[];
  driver?: string;
  businessDate?: string;
  fuelTransactionId?: string;
  limit: number;
  offset: number;
}

type Row = {
  fuel_transaction_id: string; cost_id: string; vehicle_id: string; plate: string; business_date: string;
  occurred_at: Date | null; recorded_at: Date; amount: string; liters: string | null; odometer_km: number | null;
  driver_id: string | null; driver_name: string | null; vendor_name: string | null; vendor_tax_code: string | null;
  document_series: string | null; document_number: string | null; evidence_count: number;
  status: FuelReviewStatus; status_note: string | null; status_at: Date; total: number;
};

const toSubmission = (row: Row): FuelSubmission => ({
  fuelTransactionId: row.fuel_transaction_id,
  costId: row.cost_id,
  vehicle: { id: row.vehicle_id, plate: row.plate },
  businessDate: row.business_date,
  occurredAt: row.occurred_at,
  recordedAt: row.recorded_at,
  amount: row.amount,
  liters: row.liters,
  odometerKm: row.odometer_km,
  driver: row.driver_id && row.driver_name ? { id: row.driver_id, displayName: row.driver_name } : null,
  vendor: row.vendor_name || row.vendor_tax_code ? { name: row.vendor_name, taxCode: row.vendor_tax_code } : null,
  document: row.document_series || row.document_number ? { series: row.document_series, number: row.document_number } : null,
  evidenceCount: row.evidence_count,
  status: row.status,
  statusNote: row.status_note,
  statusAt: row.status_at,
});

/**
 * ★ ONE STATEMENT FOR EVERY LIST — Accounting's by state, a driver's own.
 * The money and the readings are the `vehicle_costs` row's, the facts the
 * fuel transaction's, the state the latest review step's: read, never copied.
 */
const LIST = `
  WITH latest AS (
    SELECT DISTINCT ON (fuel_transaction_id) fuel_transaction_id, status, note, at
      FROM fuel_review_events ORDER BY fuel_transaction_id, seq DESC
  )
  SELECT ft.id AS fuel_transaction_id, c.id AS cost_id, v.id AS vehicle_id, v.plate, c.business_date::text AS business_date,
         ft.occurred_at, c.created_at AS recorded_at, c.amount::text AS amount, c.liters::text AS liters, c.odometer_km,
         du.id AS driver_id, du.display_name AS driver_name, ft.vendor_name, ft.vendor_tax_code,
         ft.document_series, ft.document_number,
         (SELECT COUNT(*)::int FROM fuel_transaction_evidence e
           WHERE e.fuel_transaction_id = ft.id AND e.retired_at IS NULL) AS evidence_count,
         r.status, r.note AS status_note, r.at AS status_at, COUNT(*) OVER ()::int AS total
    FROM latest r
    JOIN fuel_transactions ft ON ft.id = r.fuel_transaction_id AND ft.voided_at IS NULL
    JOIN vehicle_costs c ON c.id = ft.vehicle_cost_id
    JOIN trip_vehicles v ON v.id = c.vehicle_id
    LEFT JOIN users du ON du.id = ft.driver_user_id
   WHERE ($1::text[] IS NULL OR r.status = ANY($1::text[]))
     AND ($2::uuid IS NULL OR ft.driver_user_id = $2)
     AND ($3::date IS NULL OR c.business_date = $3::date)
     AND ($6::uuid IS NULL OR ft.id = $6)
   ORDER BY c.created_at DESC, ft.id
   LIMIT $4 OFFSET $5`;

/** Review steps (0038) and the lists they drive. Append-only: nothing here updates or deletes. */
@Injectable()
export class FuelReviewRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(filter: SubmissionFilter): Promise<{ items: FuelSubmission[]; total: number }> {
    const rows = await this.db.query<Row>(LIST, [
      filter.statuses ?? null, filter.driver ?? null, filter.businessDate ?? null, filter.limit, filter.offset,
      filter.fuelTransactionId ?? null,
    ]);
    return { items: rows.map(toSubmission), total: rows[0]?.total ?? 0 };
  }

  /** A submitted fill's backing and driver — only a live fill that has a review. */
  async submission(fuelTransactionId: string): Promise<{ vehicleId: string; costId: string; driverUserId: string | null } | null> {
    const [row] = await this.db.query<{ vehicleId: string; costId: string; driverUserId: string | null }>(
      `SELECT ft.vehicle_id AS "vehicleId", ft.vehicle_cost_id AS "costId", ft.driver_user_id AS "driverUserId"
         FROM fuel_transactions ft
        WHERE ft.id = $1 AND ft.voided_at IS NULL AND ft.vehicle_cost_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM fuel_review_events e WHERE e.fuel_transaction_id = ft.id)`,
      [fuelTransactionId],
    );
    return row ?? null;
  }

  /** The step a fill stands at — read under the fill's row lock by every writer. */
  async latest(fuelTransactionId: string, executor: DatabaseQuery = this.db): Promise<{ status: FuelReviewStatus; seq: number } | null> {
    const [row] = await executor.query<{ status: FuelReviewStatus; seq: number }>(
      `SELECT status, seq FROM fuel_review_events WHERE fuel_transaction_id = $1 ORDER BY seq DESC LIMIT 1`,
      [fuelTransactionId],
    );
    return row ?? null;
  }

  async append(
    step: { fuelTransactionId: string; seq: number; status: FuelReviewStatus; note: string | null; actor: string },
    tx: DatabaseQuery,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO fuel_review_events (fuel_transaction_id, seq, status, note, actor) VALUES ($1, $2, $3, $4, $5)`,
      [step.fuelTransactionId, step.seq, step.status, step.note, step.actor],
    );
  }

  async history(fuelTransactionId: string): Promise<FuelReviewEvent[]> {
    const rows = await this.db.query<{ seq: number; status: FuelReviewStatus; note: string | null; at: Date; actor_id: string; actor_name: string }>(
      `SELECT e.seq, e.status, e.note, e.at, u.id AS actor_id, u.display_name AS actor_name
         FROM fuel_review_events e JOIN users u ON u.id = e.actor
        WHERE e.fuel_transaction_id = $1 ORDER BY e.seq`,
      [fuelTransactionId],
    );
    return rows.map((row) => ({
      seq: row.seq, status: row.status, note: row.note, at: row.at, actor: { id: row.actor_id, displayName: row.actor_name },
    }));
  }
}
