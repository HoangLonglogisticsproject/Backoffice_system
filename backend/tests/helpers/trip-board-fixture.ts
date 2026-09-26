import type { Pool } from 'pg';
import type { Database } from '@common/types/database.port';
import { UserRepository } from '@core/users/persistence/user.repository';
import { TripBoardService } from '../../src/capabilities/trip-schedule/application/trip-board.service';
import {
  TripScheduleService,
  type TripBoardQuery,
} from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import { DEFAULT_TRIP_BOARD_ORDER } from '../../src/capabilities/trip-schedule/domain/trip-board';
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
  const author = (await new UserRepository(base).insertUser({ displayName: 'Điều Độ' })).id;

  return {
    pool,
    board: new TripBoardService(trips, new TripBoardCostRepository(counted)),
    totals: new TripCostTotalsRepository(base),
    author,
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
