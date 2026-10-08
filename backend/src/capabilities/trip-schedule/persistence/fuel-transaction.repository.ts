import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import {
  FUEL_FACT_COLUMN,
  FUEL_FACT_KEYS,
  factText,
  type FuelFacts,
  type FuelFactsInput,
} from '../domain/fuel-transaction';

/**
 * Fuel transactions (0037), as SQL — the write side. ★ The backing row is
 * locked FOR NO KEY UPDATE: two wrappers of one cost queue on it, and a void
 * or a driver's edit waits for the commit, so the "live fuel line" checked is
 * still true when it lands. It blocks no foreign key elsewhere (FOR KEY SHARE)
 * and never takes the trip or the turn, so it forms no cycle with a driver.
 */
export interface VehicleBacking {
  id: string;
  vehicleId: string;
  businessDate: string;
  category: string;
  source: string;
  createdBy: string;
  voided: boolean;
}

export interface TripBacking {
  id: string;
  tripId: string;
  category: string;
  vehicleId: string | null;
  /** The driver of the turn that declared it, when a driver did. */
  provenanceDriver: string | null;
  voided: boolean;
}

/** A fill as stored: its fixed identity, and its facts and readings (`FuelFacts`). */
export type StoredFuelTransaction = FuelFacts & {
  id: string;
  vehicleId: string;
  businessDate: string;
  vehicleCostId: string | null;
  tripCostId: string | null;
};

/** Aliased to the domain shape, so a row needs no mapper. */
const COLUMNS = `id, vehicle_id AS "vehicleId", business_date::text AS "businessDate",
                 vehicle_cost_id AS "vehicleCostId", trip_cost_id AS "tripCostId", liters::text AS liters,
                 odometer_km AS "odometerKm", occurred_at AS "occurredAt", driver_user_id AS "driverUserId",
                 vendor_name AS "vendorName", vendor_tax_code AS "vendorTaxCode",
                 document_series AS "documentSeries", document_number AS "documentNumber"`;

const isLiveCollision = (error: unknown): boolean => {
  const failure = error as { code?: unknown; constraint?: unknown } | null;
  return failure?.code === '23505' && String(failure.constraint).startsWith('uq_fuel_transaction_');
};

/** Every method runs inside the caller's transaction — a wrap is never a lone statement. */
@Injectable()
export class FuelTransactionRepository {
  async lockVehicleCost(vehicleId: string, costId: string, tx: DatabaseQuery): Promise<VehicleBacking | null> {
    const [row] = await tx.query<VehicleBacking>(
      `SELECT id, vehicle_id AS "vehicleId", business_date::text AS "businessDate", category, source,
              created_by AS "createdBy", voided_at IS NOT NULL AS voided
         FROM vehicle_costs WHERE id = $1 AND vehicle_id = $2
          FOR NO KEY UPDATE`,
      [costId, vehicleId],
    );
    return row ?? null;
  }

  async lockTripCost(tripId: string, costId: string, tx: DatabaseQuery): Promise<TripBacking | null> {
    const [row] = await tx.query<TripBacking>(
      `SELECT tc.id, tc.trip_id AS "tripId", tc.category, tc.vehicle_id AS "vehicleId",
              a.driver_user_id AS "provenanceDriver", tc.voided_at IS NOT NULL AS voided
         FROM trip_costs tc
         LEFT JOIN trip_driver_assignments a ON a.id = tc.driver_assignment_id
        WHERE tc.id = $1 AND tc.trip_id = $2
          FOR NO KEY UPDATE OF tc`,
      [costId, tripId],
    );
    return row ?? null;
  }

  /** Every lorry the trip records — its turns' and its legacy one. Never used to choose one. */
  async tripLorries(tripId: string, tx: DatabaseQuery): Promise<string[]> {
    const rows = await tx.query<{ vehicle_id: string }>(
      `SELECT vehicle_id FROM trip_driver_assignments WHERE trip_id = $1 AND vehicle_id IS NOT NULL
       UNION
       SELECT vehicle_id FROM trip_schedules WHERE id = $1 AND vehicle_id IS NOT NULL`,
      [tripId],
    );
    return rows.map((row) => row.vehicle_id);
  }

  /** Archived lorries count: history outlives a lorry's service. */
  async vehicleExists(vehicleId: string, tx: DatabaseQuery): Promise<boolean> {
    const rows = await tx.query(`SELECT 1 FROM trip_vehicles WHERE id = $1`, [vehicleId]);
    return rows.length > 0;
  }

  async isDriverAccount(userId: string, tx: DatabaseQuery): Promise<boolean> {
    const rows = await tx.query(`SELECT 1 FROM users WHERE id = $1 AND account_type = 'driver'`, [userId]);
    return rows.length > 0;
  }

  async lockLive(
    backing: 'vehicle_cost_id' | 'trip_cost_id',
    costId: string,
    tx: DatabaseQuery,
  ): Promise<StoredFuelTransaction | null> {
    const [row] = await tx.query<StoredFuelTransaction>(
      `SELECT ${COLUMNS} FROM fuel_transactions WHERE ${backing} = $1 AND voided_at IS NULL FOR UPDATE`,
      [costId],
    );
    return row ?? null;
  }

  async insert(
    input: Omit<StoredFuelTransaction, 'id'> & { createdBy: string },
    tx: DatabaseQuery,
  ): Promise<StoredFuelTransaction> {
    try {
      const [row] = await tx.query<StoredFuelTransaction>(
        `INSERT INTO fuel_transactions
           (vehicle_id, business_date, vehicle_cost_id, trip_cost_id, liters, odometer_km, occurred_at,
            driver_user_id, vendor_name, vendor_tax_code, document_series, document_number, created_by)
         VALUES ($1, $2::date, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING ${COLUMNS}`,
        [input.vehicleId, input.businessDate, input.vehicleCostId, input.tripCostId, input.liters, input.odometerKm,
         input.occurredAt, input.driverUserId, input.vendorName, input.vendorTaxCode, input.documentSeries,
         input.documentNumber, input.createdBy],
      );
      if (!row) throw new Error('An inserted fuel transaction returned no row.');
      return row;
    } catch (error) {
      if (isLiveCollision(error)) throw new ConflictError('That cost already has a fuel transaction.');
      throw error;
    }
  }

  /** Adds facts and readings to empty columns — names from a fixed map, never from input. */
  async addFacts(id: string, additions: FuelFactsInput, tx: DatabaseQuery): Promise<void> {
    const keys = FUEL_FACT_KEYS.filter((key) => additions[key] !== undefined);
    if (keys.length === 0) return;
    const sets = keys.map((key, i) => `${FUEL_FACT_COLUMN[key]} = $${i + 2}`).join(', ');
    await tx.query(`UPDATE fuel_transactions SET ${sets} WHERE id = $1`, [id, ...keys.map((key) => additions[key])]);
  }

  /** Who added which fact or reading, and when — one row per field, ever. */
  async logFacts(id: string, facts: FuelFactsInput, by: string, tx: DatabaseQuery): Promise<void> {
    const keys = FUEL_FACT_KEYS.filter((key) => facts[key] !== undefined);
    if (keys.length === 0) return;
    await tx.query(
      `INSERT INTO fuel_transaction_enrichments (fuel_transaction_id, field, value, recorded_by)
       SELECT $1, field, value, $4 FROM unnest($2::text[], $3::text[]) AS t(field, value)`,
      [id, keys.map((key) => FUEL_FACT_COLUMN[key]), keys.map((key) => factText(facts[key] as Date | string | number)), by],
    );
  }
}
