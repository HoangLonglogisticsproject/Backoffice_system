import type { Pool } from 'pg';
import type { Database } from '@common/types/database.port';
import { UserRepository } from '@core/users/persistence/user.repository';
import { TripBoardService } from '../../src/capabilities/trip-schedule/application/trip-board.service';
import {
  TripScheduleService,
  type TripBoardQuery,
} from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import { DEFAULT_TRIP_BOARD_ORDER } from '../../src/capabilities/trip-schedule/domain/trip-board';
import type { TripCostCategory } from '../../src/capabilities/trip-schedule/domain/trip-cost';
import { TripBoardCostRepository } from '../../src/capabilities/trip-schedule/persistence/trip-board-cost.repository';
import {
  TripCustomerRepository,
  TripLocationRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { TripCostTotalsRepository } from '../../src/capabilities/trip-schedule/persistence/trip-cost.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../../src/capabilities/trip-schedule/persistence/trip-status-history.repository';
import {
  TEST_URL,
  applyAllMigrations,
  assertLooksLikeATestDatabase,
  openTestSchema,
  poolAsDatabase,
} from './integration-database';

/**
 * The dispatch board's read path wired to a real PostgreSQL, for the specs that
 * pin its order and its cost column.
 *
 * ★ `statements` RECORDS EVERY STATEMENT THE BOARD ISSUES. It is what lets a
 * spec say "one page, two queries" as a measurement rather than as a promise.
 */
export interface TripBoardFixture {
  pool: Pool;
  board: TripBoardService;
  /** The canonical per-trip totals — what the cost dialog shows. */
  totals: TripCostTotalsRepository;
  author: string;
  /** A driver account, for crews and for lines declared from the portal. */
  driver: string;
  statements: string[];
}

export async function openTripBoard(schema: string): Promise<TripBoardFixture> {
  assertLooksLikeATestDatabase(TEST_URL as string);
  const pool = await openTestSchema(TEST_URL as string, schema);
  await applyAllMigrations(pool);

  const base = poolAsDatabase(pool);
  const statements: string[] = [];
  const counted: Database = {
    ...base,
    query: <T>(text: string, params?: readonly unknown[]) => {
      statements.push(text);
      return base.query<T>(text, params);
    },
  };

  const trips = new TripScheduleService(
    counted,
    new TripScheduleRepository(counted),
    new TripCustomerRepository(counted),
    new TripStatusHistoryRepository(counted),
    new TripLocationRepository(counted),
  );
  const users = new UserRepository(base);
  const author = (await users.insertUser({ displayName: 'Điều Độ' })).id;
  const driver = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;

  return {
    pool,
    board: new TripBoardService(trips, new TripBoardCostRepository(counted)),
    totals: new TripCostTotalsRepository(base),
    author,
    driver,
    statements,
  };
}

/** August 2026, first page, the default order — override what a case is about. */
export const boardQuery = (over: Partial<TripBoardQuery> = {}): TripBoardQuery => ({
  from: '2026-08-01',
  to: '2026-08-31',
  page: 1,
  limit: 50,
  assignment: 'all',
  ...DEFAULT_TRIP_BOARD_ORDER,
  ...over,
});

/** A bare trip on `day`. Columns a case needs to control are set by the case. */
export async function addTrip(fixture: TripBoardFixture, day: string): Promise<string> {
  const { rows } = await fixture.pool.query<{ id: string }>(
    `INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ($1, $2) RETURNING id`,
    [day, fixture.author],
  );
  return rows[0]!.id;
}

/** TRUNCATE rather than DELETE: 0017's `deny_delete` refuses row deletes by design. */
export async function clearTrips(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE trip_status_history, trip_completion_requests, trip_execution_events,
              trip_cost_edits, trip_costs, trip_outsource_hires,
              trip_driver_assignments, trip_schedules, trip_vehicles
     RESTART IDENTITY CASCADE`,
  );
}

/**
 * One own-vehicle cost line. A `fromDriver` line is what the portal writes:
 * `driver_portal`, still `editable` — declared, not yet reviewed.
 */
export async function addCost(
  fx: TripBoardFixture,
  trip: string,
  amount: string,
  line: { category?: TripCostCategory; voided?: boolean; fromDriver?: string } = {},
): Promise<void> {
  const { category = 'fuel', voided = false, fromDriver = null } = line;
  await fx.pool.query(
    `INSERT INTO trip_costs (trip_id, category, amount, created_by, voided_at, voided_by,
                             source, state, driver_assignment_id)
     VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END, CASE WHEN $5 THEN $4::uuid END,
             CASE WHEN $6::uuid IS NULL THEN 'backoffice' ELSE 'driver_portal' END,
             CASE WHEN $6::uuid IS NULL THEN 'immutable' ELSE 'editable' END, $6)`,
    [trip, category, amount, fx.author, voided, fromDriver],
  );
}

/** One outsourced hire — somebody else's lorry, at an agreed price. */
export async function addHire(fx: TripBoardFixture, trip: string, amount: string, voided = false): Promise<void> {
  await fx.pool.query(
    `INSERT INTO trip_outsource_hires (trip_id, carrier_name, agreed_amount, created_by, voided_at, voided_by)
     VALUES ($1, 'Hai Thành', $2, $3, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN $3::uuid END)`,
    [trip, amount, fx.author, voided],
  );
}

/** A lorry and the fixture's driver on the trip. Returns the assignment. */
export async function addCrew(fx: TripBoardFixture, trip: string, plate: string): Promise<string> {
  const { rows } = await fx.pool.query<{ id: string }>(
    `INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`,
    [plate, fx.author],
  );
  const { rows: assigned } = await fx.pool.query<{ id: string }>(
    `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [trip, rows[0]!.id, fx.driver, fx.author],
  );
  return assigned[0]!.id;
}
