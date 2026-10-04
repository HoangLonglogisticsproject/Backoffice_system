import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { DailyFuelCheck, DailyFuelOutcome } from '../domain/vehicle-fuel';

/**
 * A lorry's daily fuel check, as SQL (0034).
 *
 * ★ INSERT AND READ, NOTHING ELSE. A check is a recorded fact — 0034's trigger
 * refuses any UPDATE or DELETE — so this class offers no way to spell one.
 */

interface CheckRow {
  vehicle_id: string;
  business_date: string;
  outcome: DailyFuelOutcome;
  vehicle_cost_id: string | null;
  source_trip_id: string;
  source_assignment_id: string;
  client_request_id: string;
  created_by: string;
  created_at: Date;
}

/** The message a reused key earns, wherever the collision is caught. */
export const KEY_REUSED = 'That client request id was already used for another declaration. Use a new one.';

/**
 * ★ TWO DIFFERENT CONFLICTS, NEVER CONFUSED. The lorry's day already taken is
 * the obligation met — `ON CONFLICT … DO NOTHING`, and the caller reads the
 * winner. The KEY already taken (by another turn, or on another day: the index
 * is per lorry, not per day) is a caller reusing an id for a different
 * declaration — refused as itself, a 409, never a raw unique violation.
 */
const isKeyCollision = (error: unknown): boolean => {
  const failure = error as { code?: unknown; constraint?: unknown } | null;
  return failure?.code === '23505' && failure.constraint === 'uq_vehicle_daily_fuel_check_client_request';
};

/** `business_date::text`: `pg` turns a `DATE` into the previous evening in Hồ Chí Minh. */
const CHECK_COLUMNS = `vehicle_id, business_date::text AS business_date, outcome, vehicle_cost_id,
  source_trip_id, source_assignment_id, client_request_id, created_by, created_at`;

const toCheck = (row: CheckRow): DailyFuelCheck => ({
  vehicleId: row.vehicle_id,
  businessDate: row.business_date,
  outcome: row.outcome,
  vehicleCostId: row.vehicle_cost_id,
  sourceTripId: row.source_trip_id,
  sourceAssignmentId: row.source_assignment_id,
  clientRequestId: row.client_request_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

@Injectable()
export class VehicleDailyFuelCheckRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Takes the lorry's check for the day, or returns `null` when another
   * declaration already holds it.
   *
   * ★ THE PRIMARY KEY DECIDES, NOT A READ BEFORE IT. Two declarations for one
   * lorry and one day both reach this statement; PostgreSQL makes the second
   * wait for the first to commit, then skips it. The caller reads the winner.
   */
  async claim(
    input: {
      vehicleId: string;
      businessDate: string;
      outcome: DailyFuelOutcome;
      vehicleCostId: string | null;
      sourceTripId: string;
      sourceAssignmentId: string;
      clientRequestId: string;
      createdBy: string;
    },
    executor: DatabaseQuery,
  ): Promise<DailyFuelCheck | null> {
    try {
      const rows = await executor.query<CheckRow>(
        `INSERT INTO vehicle_daily_fuel_checks
           (vehicle_id, business_date, outcome, vehicle_cost_id,
            source_trip_id, source_assignment_id, client_request_id, created_by)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (vehicle_id, business_date) DO NOTHING
         RETURNING ${CHECK_COLUMNS}`,
        [
          input.vehicleId,
          input.businessDate,
          input.outcome,
          input.vehicleCostId,
          input.sourceTripId,
          input.sourceAssignmentId,
          input.clientRequestId,
          input.createdBy,
        ],
      );
      return rows[0] ? toCheck(rows[0]) : null;
    } catch (error) {
      // The day was free but the key was not: another declaration — another
      // turn, or the day before near midnight — already carries it.
      if (isKeyCollision(error)) throw new ConflictError(KEY_REUSED);
      throw error;
    }
  }

  async find(
    vehicleId: string,
    businessDate: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DailyFuelCheck | null> {
    const rows = await executor.query<CheckRow>(
      `SELECT ${CHECK_COLUMNS} FROM vehicle_daily_fuel_checks
        WHERE vehicle_id = $1 AND business_date = $2::date`,
      [vehicleId, businessDate],
    );
    return rows[0] ? toCheck(rows[0]) : null;
  }

  /** The check a retried declaration already wrote, if it wrote one — on any day. */
  async findByClientRequest(
    vehicleId: string,
    clientRequestId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DailyFuelCheck | null> {
    const rows = await executor.query<CheckRow>(
      `SELECT ${CHECK_COLUMNS} FROM vehicle_daily_fuel_checks
        WHERE vehicle_id = $1 AND client_request_id = $2`,
      [vehicleId, clientRequestId],
    );
    return rows[0] ? toCheck(rows[0]) : null;
  }

  async exists(vehicleId: string, businessDate: string, executor: DatabaseQuery): Promise<boolean> {
    const rows = await executor.query<{ one: number }>(
      `SELECT 1 AS one FROM vehicle_daily_fuel_checks
        WHERE vehicle_id = $1 AND business_date = $2::date`,
      [vehicleId, businessDate],
    );
    return rows.length > 0;
  }
}
