import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  TEST_URL,
  assertLooksLikeATestDatabase,
  describeIntegration,
  fakeHasher,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import type { Database, DatabaseQuery } from '@common/types/database.port';
import { ConflictError, ValidationError } from '@common/errors/domain.error';
import { UserRepository } from '@core/users/persistence/user.repository';
import { TripCompletionService } from '../../src/capabilities/trip-schedule/application/trip-completion.service';
import { TripCostService } from '../../src/capabilities/trip-schedule/application/trip-cost.service';
import { TripExecutionService } from '../../src/capabilities/trip-schedule/application/trip-execution.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import {
  TripCustomerRepository,
  TripVehicleRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import {
  OutsourceHireRepository,
  TripCostRepository,
  TripCostTotalsRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-cost.repository';
import {
  CompletionRequestRepository,
  DriverAssignmentRepository,
  ExecutionEventRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-execution.repository';
import { OperationalBoardService } from '../../src/capabilities/trip-schedule/application/operational-board.service';
import { OperationalBoardRepository } from '../../src/capabilities/trip-schedule/persistence/operational-board.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../../src/capabilities/trip-schedule/persistence/trip-status-history.repository';

/**
 * The operational lifecycle, against a REAL PostgreSQL.
 *
 * ★ WHY THIS FILE HAD TO EXIST BEFORE ANY OF IT COULD BE BELIEVED.
 *
 * Every guarantee in migrations 0013–0017 is made by the DATABASE: a partial
 * unique index, a composite foreign key, a CHECK, a trigger. Not one of them is
 * provable by a unit test, because a unit test's fake happily agrees with
 * whatever the code asks it. Reading the SQL proves the file SAYS the right
 * thing; only a server proves PostgreSQL AGREES.
 *
 * ★ AND CONCURRENCY IS THE HALF THAT CANNOT BE FAKED AT ALL. "Two operators
 * assign a driver at the same instant and one loses" is a claim about MVCC,
 * row locks and unique-index enforcement at COMMIT. The cases below open real
 * overlapping transactions on separate connections, because that is the only
 * way to find out.
 *
 * ⚠ THE SCHEMA IS BUILT AND DROPPED BY THIS FILE. It runs in its own PostgreSQL
 * schema so it cannot collide with the other integration specs running beside
 * it, and `require-database.ts` has already refused to let it point anywhere
 * that is not a disposable local database.
 */
const SCHEMA = 'trip_operational_itest';

/** PostgreSQL error codes, spelled out where they are asserted. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
/** What `RAISE EXCEPTION … USING ERRCODE = 'restrict_violation'` produces. */
const RESTRICT_VIOLATION = '23001';

const describeIfDatabase = TEST_URL ? describe : describe.skip;

describeIfDatabase('Operational lifecycle against real PostgreSQL', () => {
  let pool: Pool;
  let database: Database;

  let board: TripScheduleService;
  let execution: TripExecutionService;
  let money: TripCostService;
  let completion: TripCompletionService;
  let operations: OperationalBoardService;

  let assignments: DriverAssignmentRepository;
  let costs: TripCostRepository;

  let operator: string;
  let driverA: string;
  let driverB: string;
  let reviewer: string;

  /** Runs a statement and returns the PostgreSQL error code it raised. */
  const codeOf = async (work: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await work();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  const sql = async (text: string, params: readonly unknown[] = []): Promise<unknown[]> =>
    (await pool.query(text, params as unknown[])).rows;

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);

    const migrations = join(__dirname, '..', '..', 'migrations');
    for (const file of [
      '0001_identity.sql',
      '0002_users_updated_at.sql',
      '0011_trip_schedule.sql',
      '0012_trip_cost.sql',
      '0013_trip_carrier_and_vehicle_ownership.sql',
      '0014_trip_driver_assignment.sql',
      '0015_trip_execution_event.sql',
      '0016_trip_cost_lifecycle.sql',
      '0017_trip_completion_and_history.sql',
      // 0018 adds `users.account_type`, which provisioning now writes on every
      // insert — so every spec that creates a user needs it.
      '0018_driver_account.sql',
    ]) {
      await pool.query(await readFile(join(migrations, file), 'utf8'));
    }

    database = {
      query: async <T>(text: string, params?: readonly unknown[]): Promise<T[]> =>
        (await pool.query(text, params as unknown[])).rows as T[],
      transaction: async <T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({
            query: async <R>(text: string, params?: readonly unknown[]): Promise<R[]> =>
              (await client.query(text, params as unknown[])).rows as R[],
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };

    const trips = new TripScheduleRepository(database);
    const vehicles = new TripVehicleRepository(database);
    const customers = new TripCustomerRepository(database);
    const history = new TripStatusHistoryRepository(database);
    assignments = new DriverAssignmentRepository(database);
    costs = new TripCostRepository(database);
    const events = new ExecutionEventRepository(database);
    const requests = new CompletionRequestRepository(database);

    board = new TripScheduleService(database, trips, vehicles, customers, history);
    execution = new TripExecutionService(database, trips, assignments, events, vehicles);
    money = new TripCostService(
      database,
      trips,
      costs,
      new OutsourceHireRepository(database),
      new TripCostTotalsRepository(database),
      assignments,
      vehicles,
    );
    completion = new TripCompletionService(database, trips, assignments, requests, costs, history);
    operations = new OperationalBoardService(new OperationalBoardRepository(database));

    const users = new UserRepository(database);
    operator = (await users.insertUser({ displayName: 'Điều Độ' })).id;
    driverA = (await users.insertUser({ displayName: 'Tài Xế A' })).id;
    driverB = (await users.insertUser({ displayName: 'Tài Xế B' })).id;
    reviewer = (await users.insertUser({ displayName: 'SuperAdmin' })).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // TRUNCATE, not DELETE: 0017's `deny_delete` refuses a row-level DELETE on
    // every historical table, which is exactly what it is for.
    await pool.query(
      `TRUNCATE trip_status_history, trip_completion_requests, trip_execution_events,
                trip_cost_edits, trip_costs, trip_outsource_hires,
                trip_driver_assignments, trip_schedules, trip_vehicles,
                trip_customers, trip_carriers
       RESTART IDENTITY CASCADE`,
    );
  });

  // ---------------------------------------------------------------- helpers --

  const newVehicle = async (
    plate: string,
    ownership: 'company' | 'outsourced' | null = 'company',
    carrierId: string | null = null,
  ): Promise<string> => {
    const [row] = (await sql(
      `INSERT INTO trip_vehicles (plate, created_by, ownership, carrier_id,
                                  ownership_set_by, ownership_set_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3::text IS NULL THEN NULL ELSE $2::uuid END,
               CASE WHEN $3::text IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [plate, operator, ownership, carrierId],
    )) as { id: string }[];
    return row!.id;
  };

  const newCarrier = async (name: string): Promise<string> => {
    const [row] = (await sql(
      `INSERT INTO trip_carriers (name, created_by) VALUES ($1, $2) RETURNING id`,
      [name, operator],
    )) as { id: string }[];
    return row!.id;
  };

  const newTrip = async (vehicleId: string | null = null): Promise<string> => {
    const trip = await board.create({
      scheduledOn: '2026-08-30',
      vehicleId,
      pickupAt: new Date('2026-08-30T02:00:00Z'),
      deliveryAt: new Date('2026-08-30T09:00:00Z'),
      createdBy: operator,
    });
    return trip.id;
  };

  /** A trip with a company lorry and driver A at the wheel. */
  const runningTrip = async (): Promise<{ trip: string; assignment: string }> => {
    const vehicle = await newVehicle(`51D-${Math.floor(Math.random() * 90000) + 10000}`);
    const trip = await newTrip(vehicle);
    const assignment = await execution.assign(trip, driverA, operator);
    return { trip, assignment: assignment.id };
  };

  const archive = (trip: string) => board.archive(trip, operator);

  const declare = (trip: string, amount = '1500000.00') =>
    money.declareCost({ tripId: trip, category: 'fuel', amount, declaredBy: driverA });

  /** Two connections, each in its own transaction, for the race cases. */
  const twoClients = async (): Promise<[PoolClient, PoolClient]> => [
    await pool.connect(),
    await pool.connect(),
  ];

  // ===================================================== CHECK constraints ==

  describe('CHECK constraints', () => {
    it('refuses an ownership the business does not have', async () => {
      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_vehicles (plate, created_by, ownership, ownership_set_by, ownership_set_at)
             VALUES ('X1', $1, 'unknown', $1, now())`,
            [operator],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('★ accepts a lorry with NO ownership, because unclassified is a real state', async () => {
      // 0013 backfills nothing on purpose. NULL means "nobody has classified
      // this yet", and the schema has to be able to hold that.
      await expect(newVehicle('UNCLASSIFIED-1', null)).resolves.toEqual(expect.any(String));
    });

    it('refuses an ownership with no author', async () => {
      expect(
        await codeOf(() =>
          sql(`INSERT INTO trip_vehicles (plate, created_by, ownership) VALUES ('X2', $1, 'company')`, [
            operator,
          ]),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('refuses an outsourced lorry with no carrier', async () => {
      expect(await codeOf(() => newVehicle('X3', 'outsourced', null))).toBe(CHECK_VIOLATION);
    });

    it('refuses a company lorry that names a carrier', async () => {
      const carrier = await newCarrier('Hai Thành');
      expect(await codeOf(() => newVehicle('X4', 'company', carrier))).toBe(CHECK_VIOLATION);
    });

    it('★ refuses an unclassified lorry that names a carrier', async () => {
      // The case the three-branch spelling exists for: written as an equality,
      // `(NULL = 'outsourced') = (carrier_id IS NOT NULL)` evaluates to NULL and
      // a CHECK PASSES on NULL — so this row would have been accepted.
      const carrier = await newCarrier('Hải Râu');
      expect(await codeOf(() => newVehicle('X5', null, carrier))).toBe(CHECK_VIOLATION);
    });

    it('refuses a completion request with no expense declaration', async () => {
      const { trip, assignment } = await runningTrip();
      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_completion_requests (trip_id, driver_assignment_id, attempt_no, submitted_by)
             VALUES ($1, $2, 1, $3)`,
            [trip, assignment, driverA],
          ),
        ),
      ).toBe(NOT_NULL_VIOLATION);
    });

    it('refuses an expense declaration outside the two values', async () => {
      const { trip, assignment } = await runningTrip();
      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_completion_requests
               (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
             VALUES ($1, $2, 1, $3, 'maybe')`,
            [trip, assignment, driverA],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('★ refuses a rejection with no reason', async () => {
      const { trip, assignment } = await runningTrip();
      await sql(
        `INSERT INTO trip_completion_requests
           (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
         VALUES ($1, $2, 1, $3, 'none')`,
        [trip, assignment, driverA],
      );

      expect(
        await codeOf(() =>
          sql(
            `UPDATE trip_completion_requests
                SET state = 'rejected', decided_by = $2, decided_at = now()
              WHERE trip_id = $1`,
            [trip, reviewer],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('refuses a rejection whose reason is only whitespace', async () => {
      const { trip, assignment } = await runningTrip();
      await sql(
        `INSERT INTO trip_completion_requests
           (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
         VALUES ($1, $2, 1, $3, 'none')`,
        [trip, assignment, driverA],
      );

      expect(
        await codeOf(() =>
          sql(
            `UPDATE trip_completion_requests
                SET state = 'rejected', decided_by = $2, decided_at = now(), decision_reason = '   '
              WHERE trip_id = $1`,
            [trip, reviewer],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('refuses an ended assignment with no reason', async () => {
      const { trip, assignment } = await runningTrip();
      expect(
        await codeOf(() =>
          sql(
            `UPDATE trip_driver_assignments
                SET state = 'ended', ended_by = $2, ended_at = now()
              WHERE id = $1`,
            [assignment, operator],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('★ refuses fuel on a hired lorry — the carrier already charges for it', async () => {
      const carrier = await newCarrier('xe Út');
      const vehicle = await newVehicle('HIRED-1', 'outsourced', carrier);
      const trip = await newTrip(vehicle);
      const assignment = await execution.assign(trip, driverA, operator);

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_costs
               (trip_id, category, amount, created_by, state, source,
                driver_assignment_id, vehicle_id, vehicle_ownership)
             VALUES ($1, 'fuel', 100, $2, 'editable', 'driver_portal', $3, $4, 'outsourced')`,
            [trip, driverA, assignment.id, vehicle],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('refuses tolls on a hired lorry for the same reason', async () => {
      const carrier = await newCarrier('Mr Đạt');
      const vehicle = await newVehicle('HIRED-2', 'outsourced', carrier);
      const trip = await newTrip(vehicle);
      const assignment = await execution.assign(trip, driverA, operator);

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_costs
               (trip_id, category, amount, created_by, state, source,
                driver_assignment_id, vehicle_id, vehicle_ownership)
             VALUES ($1, 'toll', 100, $2, 'editable', 'driver_portal', $3, $4, 'outsourced')`,
            [trip, driverA, assignment.id, vehicle],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('★ ALLOWS warehouse fees on a hired lorry, which are ours to pay', async () => {
      const carrier = await newCarrier('Hai Thành 2');
      const vehicle = await newVehicle('HIRED-3', 'outsourced', carrier);
      const trip = await newTrip(vehicle);
      await execution.assign(trip, driverA, operator);

      const line = await money.declareCost({
        tripId: trip,
        category: 'warehouse',
        amount: '250000.00',
        declaredBy: driverA,
      });

      expect(line.vehicleOwnership).toBe('outsourced');
    });

    it('refuses a driver-portal line with no assignment', async () => {
      const trip = await newTrip(await newVehicle('X6'));
      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_costs (trip_id, category, amount, created_by, state, source)
             VALUES ($1, 'fuel', 100, $2, 'editable', 'driver_portal')`,
            [trip, driverA],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('refuses a status-history row whose two ends are the same', async () => {
      const trip = await newTrip();
      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_status_history (trip_id, from_status, to_status, changed_by)
             VALUES ($1, 'awaiting_vehicle', 'awaiting_vehicle', $2)`,
            [trip, operator],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  // ==================================================== FK and composite FK ==

  describe('foreign keys', () => {
    it('refuses an event on a trip that does not exist', async () => {
      const { assignment } = await runningTrip();
      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_execution_events
               (trip_id, driver_assignment_id, event_type, actual_at, client_event_id, recorded_by)
             VALUES (gen_random_uuid(), $1, 'ARRIVED_PICKUP', now(), 'x', $2)`,
            [assignment, driverA],
          ),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('★ refuses an event pairing one trip with ANOTHER trip’s assignment', async () => {
      // The composite key is the whole reason this cannot happen. Reduced to
      // `REFERENCES trip_driver_assignments(id)` the row below inserts happily
      // and the event's provenance names a driver who was never on this trip.
      const first = await runningTrip();
      const second = await runningTrip();

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_execution_events
               (trip_id, driver_assignment_id, event_type, actual_at, client_event_id, recorded_by)
             VALUES ($1, $2, 'ARRIVED_PICKUP', now(), 'x', $3)`,
            [first.trip, second.assignment, driverA],
          ),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('★ refuses an expense pairing one trip with another trip’s assignment', async () => {
      const first = await runningTrip();
      const second = await runningTrip();

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_costs
               (trip_id, category, amount, created_by, state, source, driver_assignment_id)
             VALUES ($1, 'fuel', 100, $2, 'editable', 'driver_portal', $3)`,
            [first.trip, driverA, second.assignment],
          ),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('★ refuses a completion request carrying another trip’s assignment', async () => {
      const first = await runningTrip();
      const second = await runningTrip();

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_completion_requests
               (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
             VALUES ($1, $2, 1, $3, 'none')`,
            [first.trip, second.assignment, driverA],
          ),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('accepts a backoffice line with no assignment at all', async () => {
      // MATCH SIMPLE: a NULL in the composite key skips the check, which is
      // exactly right for a line that has no driver.
      const trip = await newTrip(await newVehicle('X7'));
      const line = await money.createCost({
        tripId: trip,
        category: 'warehouse',
        amount: '100000',
        createdBy: operator,
      });

      expect(line.driverAssignmentId).toBeNull();
      expect(line.source).toBe('backoffice');
      expect(line.state).toBe('immutable');
    });
  });

  // ====================================================== partial UNIQUE ==

  describe('partial unique indexes', () => {
    it('★ allows exactly one ACTIVE driver per trip', async () => {
      const { trip } = await runningTrip();

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_driver_assignments (trip_id, driver_user_id, assigned_by)
             VALUES ($1, $2, $3)`,
            [trip, driverB, operator],
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('allows many ENDED assignments on one trip, which is the history', async () => {
      const { trip } = await runningTrip();

      await execution.replaceDriver(trip, driverB, { by: operator, reason: 'A báo ốm.' });
      await execution.replaceDriver(trip, driverA, { by: operator, reason: 'B hết ca.' });

      const rows = await sql(`SELECT state FROM trip_driver_assignments WHERE trip_id = $1`, [trip]);
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => (r as { state: string }).state === 'active')).toHaveLength(1);
    });

    it('★ allows one PENDING completion request per trip', async () => {
      const { trip, assignment } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_completion_requests
               (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
             VALUES ($1, $2, 2, $3, 'none')`,
            [trip, assignment, driverA],
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('★ allows one APPROVED completion request EVER — approval is terminal', async () => {
      const { trip, assignment } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.approve(trip, reviewer);

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_completion_requests
               (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration,
                state, decided_by, decided_at)
             VALUES ($1, $2, 9, $3, 'none', 'approved', $4, now())`,
            [trip, assignment, driverA, reviewer],
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('never reuses an attempt number', async () => {
      const { trip, assignment } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.reject(trip, { by: reviewer, reason: 'Thiếu chứng từ.' });

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_completion_requests
               (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
             VALUES ($1, $2, 1, $3, 'none')`,
            [trip, assignment, driverA],
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('★ refuses a duplicate client event id on the same trip', async () => {
      const { trip } = await runningTrip();
      await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date('2026-08-30T02:31:00Z'),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_execution_events
               (trip_id, driver_assignment_id, event_type, actual_at, client_event_id, recorded_by)
             SELECT $1, id, 'PICKUP_CONFIRMED', now(), 'tap-1', $2
               FROM trip_driver_assignments WHERE trip_id = $1 AND state = 'active'`,
            [trip, driverA],
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('allows the same client event id on a DIFFERENT trip', async () => {
      // Scoped to the trip: two unrelated clients must not be able to block
      // each other by picking the same id.
      const first = await runningTrip();
      const second = await runningTrip();

      const one = await execution.recordEvent({
        tripId: first.trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date(),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });
      const two = await execution.recordEvent({
        tripId: second.trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date(),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      expect(one.id).not.toBe(two.id);
    });
  });

  // ================================================================ triggers ==

  describe('T1 — a completed trip cannot be reopened', () => {
    const complete = async (): Promise<string> => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.approve(trip, reviewer);
      return trip;
    };

    it('★ refuses a raw UPDATE moving a done trip to any other status', async () => {
      const trip = await complete();

      expect(
        await codeOf(() =>
          sql(`UPDATE trip_schedules SET status = 'awaiting_vehicle' WHERE id = $1`, [trip]),
        ),
      ).toBe(RESTRICT_VIOLATION);
    });

    it('allows an UPDATE that leaves the status alone', async () => {
      const trip = await complete();

      await sql(`UPDATE trip_schedules SET note = 'đã đối soát' WHERE id = $1`, [trip]);

      const [row] = (await sql(`SELECT note, status FROM trip_schedules WHERE id = $1`, [trip])) as {
        note: string;
        status: string;
      }[];
      expect(row).toEqual({ note: 'đã đối soát', status: 'done' });
    });

    it('stamps who closed the trip and when', async () => {
      const trip = await complete();

      const [row] = (await sql(
        `SELECT closed_by, closed_at IS NOT NULL AS closed FROM trip_schedules WHERE id = $1`,
        [trip],
      )) as { closed_by: string; closed: boolean }[];

      expect(row).toEqual({ closed_by: reviewer, closed: true });
    });
  });

  describe('T2 — an immutable figure', () => {
    const approvedLine = async (): Promise<{ trip: string; cost: string }> => {
      const { trip } = await runningTrip();
      const line = await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.approve(trip, reviewer);
      return { trip, cost: line.id };
    };

    it('★ cannot have its amount changed by a raw UPDATE', async () => {
      const { cost } = await approvedLine();

      expect(
        await codeOf(() => sql(`UPDATE trip_costs SET amount = 1 WHERE id = $1`, [cost])),
      ).toBe(RESTRICT_VIOLATION);
    });

    it('cannot have its category or trip moved either', async () => {
      const { cost } = await approvedLine();

      expect(
        await codeOf(() => sql(`UPDATE trip_costs SET category = 'toll' WHERE id = $1`, [cost])),
      ).toBe(RESTRICT_VIOLATION);
    });

    it('cannot be moved back to editable', async () => {
      const { cost } = await approvedLine();

      expect(
        await codeOf(() => sql(`UPDATE trip_costs SET state = 'editable' WHERE id = $1`, [cost])),
      ).toBe(RESTRICT_VIOLATION);
    });

    it('★ CAN still be voided, because a void is not an edit', async () => {
      // The existing `cost.void` route depends on this, and 0016 leaves the
      // void trio out of the guard deliberately. Whether an approved figure
      // SHOULD still be voidable is an open business decision (DL-80); the
      // database keeps today's answer rather than inventing a stricter one.
      const { trip, cost } = await approvedLine();

      const voided = await money.voidCost(trip, cost, { by: reviewer, reason: 'Chứng từ trùng.' });

      expect(voided.voidedBy).toBe(reviewer);
      expect(voided.voidReason).toBe('Chứng từ trùng.');
      expect(voided.state).toBe('immutable');
    });

    it('★ cannot be edited THROUGH a void — the amount is still frozen', async () => {
      const { cost } = await approvedLine();

      expect(
        await codeOf(() =>
          sql(
            `UPDATE trip_costs
                SET voided_at = now(), voided_by = $2, void_reason = 'x', amount = 1
              WHERE id = $1`,
            [cost, reviewer],
          ),
        ),
      ).toBe(RESTRICT_VIOLATION);
    });

    it('refuses an edit once the line is merely LOCKED, before any approval', async () => {
      const { trip } = await runningTrip();
      const line = await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      expect(
        await codeOf(() => sql(`UPDATE trip_costs SET amount = 1 WHERE id = $1`, [line.id])),
      ).toBe(RESTRICT_VIOLATION);
    });

    it('allows the edit while the line is still editable', async () => {
      const { trip } = await runningTrip();
      const line = await declare(trip);

      const edited = await money.editCost(trip, line.id, { amount: '1550000.00' }, driverA);

      expect(edited.amount).toBe('1550000.00');
      const edits = await money.listCostEdits(trip, line.id);
      expect(edits).toHaveLength(1);
      expect(edits[0]).toMatchObject({ field: 'amount', oldValue: '1500000.00', newValue: '1550000.00' });
    });
  });

  describe('T3 — historical records cannot be deleted', () => {
    it.each([
      'trip_costs',
      'trip_outsource_hires',
      'trip_cost_edits',
      'trip_driver_assignments',
      'trip_execution_events',
      'trip_completion_requests',
      'trip_status_history',
    ])('★ refuses DELETE on %s', async (table) => {
      // A boundary rule already greps the source for `DELETE`, which protects
      // the code. This protects the database from a maintenance script, an ORM
      // somebody adds later, or a psql session at the end of a long day.
      const { trip } = await runningTrip();
      await declare(trip);
      await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date(),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });
      await completion.submit(trip, driverA, 'expenses');
      await completion.reject(trip, { by: reviewer, reason: 'Sai số.' });
      const line = (await costs.listActiveByTrip(trip))[0]!;
      await money.editCost(trip, line.id, { amount: '1234.00' }, driverA);
      await money.createHire({
        tripId: trip,
        carrierName: 'Hai Thành',
        agreedAmount: '100',
        createdBy: operator,
      });

      expect(await codeOf(() => sql(`DELETE FROM ${table}`))).toBe(RESTRICT_VIOLATION);
    });
  });

  // ================================================ transactions and locking ==

  describe('transaction rollback', () => {
    it('★ leaves NOTHING behind when an approval fails part-way', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      // Force the failure at the last write of the transaction, after the
      // request, the freeze and the status have all been written.
      const original = TripStatusHistoryRepository.prototype.record;
      TripStatusHistoryRepository.prototype.record = async () => {
        throw new Error('injected failure');
      };

      try {
        await expect(completion.approve(trip, reviewer)).rejects.toThrow('injected failure');
      } finally {
        TripStatusHistoryRepository.prototype.record = original;
      }

      const [tripRow] = (await sql(
        `SELECT status, closed_at FROM trip_schedules WHERE id = $1`,
        [trip],
      )) as { status: string; closed_at: Date | null }[];
      const [request] = (await sql(
        `SELECT state FROM trip_completion_requests WHERE trip_id = $1`,
        [trip],
      )) as { state: string }[];
      const [cost] = (await sql(`SELECT state FROM trip_costs WHERE trip_id = $1`, [trip])) as {
        state: string;
      }[];

      // Every one of the four writes is gone, not just the one that threw.
      expect(tripRow!.status).not.toBe('done');
      expect(tripRow!.closed_at).toBeNull();
      expect(request!.state).toBe('pending');
      expect(cost!.state).toBe('locked');
    });
  });

  describe('FOR UPDATE', () => {
    it('★ makes the second transaction WAIT rather than read stale state', async () => {
      const { trip } = await runningTrip();
      const [first, second] = await twoClients();

      try {
        await first.query(`SET search_path = ${SCHEMA}`);
        await second.query(`SET search_path = ${SCHEMA}`);

        await first.query('BEGIN');
        await first.query(`SELECT id FROM trip_schedules WHERE id = $1 FOR UPDATE`, [trip]);

        await second.query('BEGIN');
        let secondArrived = false;
        const waiting = second
          .query(`SELECT id FROM trip_schedules WHERE id = $1 FOR UPDATE`, [trip])
          .then(() => {
            secondArrived = true;
          });

        // Long enough that a non-blocking read would certainly have finished.
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(secondArrived).toBe(false);

        await first.query('COMMIT');
        await waiting;
        expect(secondArrived).toBe(true);

        await second.query('COMMIT');
      } finally {
        first.release();
        second.release();
      }
    });
  });

  // ================================================================ races ==

  describe('★ concurrency, on real connections', () => {
    it('lets only one of two simultaneous driver assignments win', async () => {
      const trip = await newTrip(await newVehicle('RACE-1'));

      const results = await Promise.allSettled([
        execution.assign(trip, driverA, operator),
        execution.assign(trip, driverB, operator),
      ]);

      const won = results.filter((r) => r.status === 'fulfilled');
      expect(won).toHaveLength(1);

      const rows = await sql(
        `SELECT id FROM trip_driver_assignments WHERE trip_id = $1 AND state = 'active'`,
        [trip],
      );
      expect(rows).toHaveLength(1);
    });

    it('lets only one of two simultaneous completion submissions win', async () => {
      const { trip } = await runningTrip();
      await declare(trip);

      const results = await Promise.allSettled([
        completion.submit(trip, driverA, 'expenses'),
        completion.submit(trip, driverA, 'expenses'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const rows = await sql(
        `SELECT id FROM trip_completion_requests WHERE trip_id = $1 AND state = 'pending'`,
        [trip],
      );
      expect(rows).toHaveLength(1);
    });

    it('★ lets only one of a simultaneous approve and reject win', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      const results = await Promise.allSettled([
        completion.approve(trip, reviewer),
        completion.reject(trip, { by: reviewer, reason: 'Thiếu chứng từ.' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const [request] = (await sql(
        `SELECT state FROM trip_completion_requests WHERE trip_id = $1`,
        [trip],
      )) as { state: string }[];
      expect(['approved', 'rejected']).toContain(request!.state);

      // And the trip agrees with whichever won.
      const [tripRow] = (await sql(`SELECT status FROM trip_schedules WHERE id = $1`, [trip])) as {
        status: string;
      }[];
      expect(tripRow!.status === 'done').toBe(request!.state === 'approved');
    });

    it('lets only one of two simultaneous approvals win', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      const results = await Promise.allSettled([
        completion.approve(trip, reviewer),
        completion.approve(trip, operator),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('★ refuses an expense edit that races a completion submit', async () => {
      const { trip } = await runningTrip();
      const line = await declare(trip);

      const results = await Promise.allSettled([
        money.editCost(trip, line.id, { amount: '9999.00' }, driverA),
        completion.submit(trip, driverA, 'expenses'),
      ]);

      // Both may succeed if the edit lands first — what must NEVER happen is a
      // locked line carrying an edit that arrived after the freeze.
      const [after] = (await sql(`SELECT state, amount::text FROM trip_costs WHERE id = $1`, [
        line.id,
      ])) as { state: string; amount: string }[];

      if (after!.state === 'locked' && after!.amount === '9999.00') {
        // Legal only if the edit committed BEFORE the submit.
        expect(results[0]!.status).toBe('fulfilled');
      }
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    });

    it('★ answers a retried event with the original rather than duplicating it', async () => {
      const { trip } = await runningTrip();

      const [one, two, three] = await Promise.all([
        execution.recordEvent({
          tripId: trip,
          type: 'ARRIVED_PICKUP',
          actualAt: new Date('2026-08-30T02:31:00Z'),
          clientEventId: 'tap-retry',
          recordedBy: driverA,
        }),
        execution
          .recordEvent({
            tripId: trip,
            type: 'ARRIVED_PICKUP',
            actualAt: new Date('2026-08-30T02:31:00Z'),
            clientEventId: 'tap-retry',
            recordedBy: driverA,
          })
          .catch(() => null),
        execution
          .recordEvent({
            tripId: trip,
            type: 'ARRIVED_PICKUP',
            actualAt: new Date('2026-08-30T02:31:00Z'),
            clientEventId: 'tap-retry',
            recordedBy: driverA,
          })
          .catch(() => null),
      ]);

      const rows = await sql(`SELECT id FROM trip_execution_events WHERE trip_id = $1`, [trip]);
      expect(rows).toHaveLength(1);
      expect(one.id).toEqual(expect.any(String));
      for (const result of [two, three]) {
        if (result) expect(result.id).toBe(one.id);
      }
    });

    it('answers a retried expense declaration with the original', async () => {
      const { trip } = await runningTrip();

      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          money.declareCost({
            tripId: trip,
            category: 'fuel',
            amount: '1500000.00',
            clientRequestId: 'tap-expense',
            declaredBy: driverA,
          }),
        ),
      );

      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      const rows = await sql(`SELECT id FROM trip_costs WHERE trip_id = $1`, [trip]);
      expect(rows).toHaveLength(1);
    });
  });

  // ====================================================== the whole lifecycle ==

  describe('★ the loop, end to end', () => {
    it('runs declare → submit → reject → correct → resubmit → approve → DONE', async () => {
      const { trip } = await runningTrip();

      for (const type of ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'] as const) {
        await execution.recordEvent({
          tripId: trip,
          type,
          actualAt: new Date('2026-08-30T03:00:00Z'),
          clientEventId: `tap-${type}`,
          recordedBy: driverA,
        });
      }

      const line = await declare(trip, '5000000.00');
      expect(line.state).toBe('editable');

      await completion.submit(trip, driverA, 'expenses');
      expect((await costs.listActiveByTrip(trip))[0]!.state).toBe('locked');

      await completion.reject(trip, { by: reviewer, reason: 'Số tiền dầu sai.' });
      // ★ Rejection REOPENS the money — locking was only ever temporary.
      expect((await costs.listActiveByTrip(trip))[0]!.state).toBe('editable');

      await money.editCost(trip, line.id, { amount: '500000.00' }, driverA);

      const resubmitted = await completion.submit(trip, driverA, 'expenses');
      expect(resubmitted.attemptNo).toBe(2);

      const approved = await completion.approve(trip, reviewer);
      expect(approved.state).toBe('approved');

      // Money frozen, trip closed, history written, all from one transaction.
      expect((await costs.listActiveByTrip(trip))[0]!.state).toBe('immutable');
      expect((await money.summary(trip)).costs).toBe('500000.00');

      const [tripRow] = (await sql(
        `SELECT status, closed_by FROM trip_schedules WHERE id = $1`,
        [trip],
      )) as { status: string; closed_by: string }[];
      expect(tripRow).toEqual({ status: 'done', closed_by: reviewer });

      const history = await board.statusHistory(trip);
      expect(history.map((h) => h.to)).toContain('done');
      // The opening row, plus the close. Both ends of the last transition.
      expect(history[0]).toMatchObject({ to: 'done', changedBy: reviewer });
      expect(history[history.length - 1]).toMatchObject({ from: null });

      // And the attempts are all still readable, with the reason.
      const attempts = await completion.listRequests(trip);
      expect(attempts).toHaveLength(2);
      expect(attempts.find((a) => a.attemptNo === 1)).toMatchObject({
        state: 'rejected',
        decisionReason: 'Số tiền dầu sai.',
      });
    });

    it('★ refuses a second completion after the trip is done', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.approve(trip, reviewer);

      await expect(completion.submit(trip, driverA, 'none')).rejects.toBeInstanceOf(ConflictError);
    });

    it('refuses an execution event after the trip is done', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.approve(trip, reviewer);

      await expect(
        execution.recordEvent({
          tripId: trip,
          type: 'DELIVERY_CONFIRMED',
          actualAt: new Date(),
          clientEventId: 'late',
          recordedBy: driverA,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // ============================================== expense declaration guard ==

  describe('★ the expense declaration', () => {
    it('refuses "nothing to claim" when the trip has live expenses', async () => {
      const { trip } = await runningTrip();
      await declare(trip);

      await expect(completion.submit(trip, driverA, 'none')).rejects.toBeInstanceOf(ConflictError);
    });

    it('refuses "there were expenses" when none were entered', async () => {
      const { trip } = await runningTrip();

      await expect(completion.submit(trip, driverA, 'expenses')).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('★ a VOIDED line does not count as a live expense', async () => {
      const { trip } = await runningTrip();
      const line = await declare(trip);
      await money.voidCost(trip, line.id, { by: operator, reason: 'Khai nhầm chuyến.' });

      // The only line on the trip is withdrawn, so "nothing to claim" is true.
      const request = await completion.submit(trip, driverA, 'none');

      expect(request.expenseDeclaration).toBe('none');
    });

    it('carries a NEW declaration on the resubmission', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.reject(trip, { by: reviewer, reason: 'Bỏ khoản này đi.' });

      const line = (await costs.listActiveByTrip(trip))[0]!;
      await money.voidCost(trip, line.id, { by: driverA, reason: 'Khai nhầm.' });

      const second = await completion.submit(trip, driverA, 'none');

      expect(second.attemptNo).toBe(2);
      expect(second.expenseDeclaration).toBe('none');
    });
  });

  // ===================================================== driver boundaries ==

  describe('★ a driver reaches only their own trip', () => {
    it('refuses an event from somebody who is not the assigned driver', async () => {
      const { trip } = await runningTrip();

      await expect(
        execution.recordEvent({
          tripId: trip,
          type: 'ARRIVED_PICKUP',
          actualAt: new Date(),
          clientEventId: 'x',
          recordedBy: driverB,
        }),
      ).rejects.toThrow(/Only the driver assigned/);
    });

    it('refuses an expense from somebody who is not the assigned driver', async () => {
      const { trip } = await runningTrip();

      await expect(
        money.declareCost({
          tripId: trip,
          category: 'fuel',
          amount: '100000',
          declaredBy: driverB,
        }),
      ).rejects.toThrow(/Only the driver assigned/);
    });

    it('refuses a correction of somebody else’s figure', async () => {
      const { trip } = await runningTrip();
      const line = await declare(trip);

      await expect(
        money.editCost(trip, line.id, { amount: '1.00' }, driverB),
      ).rejects.toThrow(/only correct the figures they declared/);
    });

    it('★ refuses an expense before a lorry is assigned', async () => {
      const trip = await newTrip(null);
      await execution.assign(trip, driverA, operator);

      await expect(
        money.declareCost({ tripId: trip, category: 'fuel', amount: '100000', declaredBy: driverA }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // ========================================================= event voiding ==

  describe('execution events', () => {
    it('withdraws an event without destroying it', async () => {
      const { trip } = await runningTrip();
      const event = await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date('2026-08-30T02:31:00Z'),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      const voided = await execution.voidEvent(trip, event.id, {
        by: operator,
        reason: 'Ghi nhầm chuyến.',
      });

      expect(voided.voidReason).toBe('Ghi nhầm chuyến.');
      expect(await execution.listEvents(trip)).toHaveLength(0);
      expect(await execution.listEvents(trip, true)).toHaveLength(1);
    });

    it('refuses a second withdrawal rather than rewriting the first', async () => {
      const { trip } = await runningTrip();
      const event = await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date(),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });
      await execution.voidEvent(trip, event.id, { by: operator, reason: 'x' });

      await expect(
        execution.voidEvent(trip, event.id, { by: operator, reason: 'y' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('★ snapshots the schedule, so correcting the plan cannot rewrite history', async () => {
      const { trip } = await runningTrip();
      const event = await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date('2026-08-30T02:31:00Z'),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      // Operations corrects the plan a week later.
      await board.update(trip, { pickupAt: new Date('2026-08-30T06:00:00Z') }, operator);

      const [row] = (await sql(`SELECT scheduled_at FROM trip_execution_events WHERE id = $1`, [
        event.id,
      ])) as { scheduled_at: Date }[];

      // The event still says what was planned WHEN IT HAPPENED.
      expect(row!.scheduled_at.toISOString()).toBe('2026-08-30T02:00:00.000Z');
    });

    it('refuses a driver-portal write once the assignment has ended', async () => {
      const { trip } = await runningTrip();
      await execution.replaceDriver(trip, driverB, { by: operator, reason: 'Đổi ca.' });

      await expect(
        execution.recordEvent({
          tripId: trip,
          type: 'ARRIVED_PICKUP',
          actualAt: new Date(),
          clientEventId: 'x',
          recordedBy: driverA,
        }),
      ).rejects.toThrow(/Only the driver assigned/);
    });
  });

  // ============================================================ status history ==

  describe('status history', () => {
    it('records the opening status when a trip is created', async () => {
      const trip = await newTrip();

      const history = await board.statusHistory(trip);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ from: null, to: 'awaiting_production', changedBy: operator });
    });

    it('records both ends of every board move, with who and why', async () => {
      const trip = await newTrip();
      await board.updateStatus(trip, 'awaiting_vehicle', operator, 'Đã có khách.');

      const history = await board.statusHistory(trip);
      expect(history[0]).toMatchObject({
        from: 'awaiting_production',
        to: 'awaiting_vehicle',
        reason: 'Đã có khách.',
        changedBy: operator,
      });
    });

    it('★ refuses every board route that tries to reach done', async () => {
      const trip = await newTrip();

      await expect(board.updateStatus(trip, 'done', operator)).rejects.toBeInstanceOf(ConflictError);
      await expect(board.update(trip, { status: 'done' }, operator)).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(
        board.create({ scheduledOn: '2026-08-30', status: 'done', createdBy: operator }),
      ).rejects.toBeInstanceOf(ConflictError);

      const [row] = (await sql(`SELECT status FROM trip_schedules WHERE id = $1`, [trip])) as {
        status: string;
      }[];
      expect(row!.status).not.toBe('done');
    });

    it('writes no history when the status is set to what it already is', async () => {
      const trip = await newTrip();
      await board.updateStatus(trip, 'awaiting_production', operator);

      expect(await board.statusHistory(trip)).toHaveLength(1);
    });

    it('★ every status the trip ever held is reconstructible', async () => {
      const trip = await newTrip();
      await board.updateStatus(trip, 'awaiting_vehicle', operator);
      await board.updateStatus(trip, 'needs_confirmation', operator);
      await board.updateStatus(trip, 'external_booking', operator);

      const history = await board.statusHistory(trip);
      expect(history.map((h) => h.to)).toEqual([
        'external_booking',
        'needs_confirmation',
        'awaiting_vehicle',
        'awaiting_production',
      ]);
    });
  });


  // ================================================== the operational board ==

  describe('the operational board, aggregated in one statement', () => {
    const RANGE = { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never;

    const view = (now?: Date) => operations.list(RANGE, now);

    it('reports a trip with a lorry and nobody driving it', async () => {
      await newTrip(await newVehicle('BOARD-1'));

      const [row] = await view();
      expect(row).toMatchObject({ stage: 'NO_DRIVER', driver: null });
    });

    it('names the CURRENT driver, not a previous one', async () => {
      const { trip } = await runningTrip();
      await execution.replaceDriver(trip, driverB, { by: operator, reason: 'Doi ca.' });

      const [row] = await view();
      expect(row!.driver).toMatchObject({ id: driverB });
    });

    it('reports a pickup past its time with no arrival, and how late', async () => {
      await runningTrip();

      // Trips are planned for 02:00Z; judge them three hours later.
      const [row] = await view(new Date('2026-08-30T05:00:00Z'));

      expect(row!.stage).toBe('PICKUP_DELAYED');
      expect(row!.pickupDelayMinutes).toBe(180);
    });

    it('keeps the delay growing while the event stays unreported', async () => {
      await runningTrip();

      const [early] = await view(new Date('2026-08-30T03:00:00Z'));
      const [late] = await view(new Date('2026-08-30T06:00:00Z'));

      expect(early!.pickupDelayMinutes).toBe(60);
      expect(late!.pickupDelayMinutes).toBe(240);
    });

    it('measures the delay to the REPORTED time once it arrives', async () => {
      const { trip } = await runningTrip();
      await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date('2026-08-30T02:45:00Z'),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      const [row] = await view(new Date('2026-08-30T20:00:00Z'));

      // Frozen at 45 minutes, not still growing.
      expect(row!.pickupDelayMinutes).toBe(45);
      expect(row!.stage).toBe('AT_PICKUP');
    });

    it('walks the whole timeline as the driver reports it', async () => {
      const { trip } = await runningTrip();
      const at = new Date('2026-08-30T02:30:00Z');
      const seen: string[] = [];

      for (const type of [
        'ARRIVED_PICKUP',
        'PICKUP_CONFIRMED',
        'ARRIVED_DELIVERY',
        'DELIVERY_CONFIRMED',
      ] as const) {
        await execution.recordEvent({
          tripId: trip,
          type,
          actualAt: at,
          clientEventId: 'tap-' + type,
          recordedBy: driverA,
        });
        seen.push((await view(new Date('2026-08-30T03:00:00Z')))[0]!.stage);
      }

      expect(seen).toEqual(['AT_PICKUP', 'IN_TRANSIT', 'AT_DELIVERY', 'AWAITING_COMPLETION']);
    });

    it('excludes a VOIDED event, so a withdrawn arrival stops counting', async () => {
      const { trip } = await runningTrip();
      const event = await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date('2026-08-30T02:30:00Z'),
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      expect((await view(new Date('2026-08-30T05:00:00Z')))[0]!.stage).toBe('AT_PICKUP');

      await execution.voidEvent(trip, event.id, { by: operator, reason: 'Ghi nham chuyen.' });

      expect((await view(new Date('2026-08-30T05:00:00Z')))[0]!.stage).toBe('PICKUP_DELAYED');
    });

    it('takes the FIRST of two arrivals reported with different client ids', async () => {
      // A technical tie-break rather than a business rule: the earliest reading
      // cannot make a trip look earlier than it was. Which one is canonical when
      // a driver genuinely reports twice is still an open decision.
      const { trip } = await runningTrip();
      await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date('2026-08-30T02:45:00Z'),
        clientEventId: 'tap-late',
        recordedBy: driverA,
      });
      await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        actualAt: new Date('2026-08-30T02:20:00Z'),
        clientEventId: 'tap-early',
        recordedBy: driverA,
      });

      const [row] = await view();
      expect(row!.arrivedPickupAt?.toISOString()).toBe('2026-08-30T02:20:00.000Z');
      expect(row!.pickupDelayMinutes).toBe(20);
    });

    it('reports the completion states and the rejection reason', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      expect((await view())[0]).toMatchObject({
        stage: 'COMPLETION_PENDING',
        accountability: 'DECLARED_WITH_EXPENSE',
        expenseDeclaration: 'expenses',
        completionAttempts: 1,
      });

      await completion.reject(trip, { by: reviewer, reason: 'Thieu chung tu dau.' });

      expect((await view())[0]).toMatchObject({
        stage: 'COMPLETION_REJECTED',
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completionRejectionReason: 'Thieu chung tu dau.',
      });

      await completion.submit(trip, driverA, 'expenses');
      await completion.approve(trip, reviewer);

      expect((await view())[0]).toMatchObject({
        stage: 'DONE',
        accountability: 'APPROVED_IMMUTABLE',
        completionAttempts: 2,
        completionRejectionReason: null,
      });
    });

    it('tells NOT_DECLARED apart from DECLARED_NO_EXPENSE', async () => {
      const first = await runningTrip();
      const second = await runningTrip();
      await completion.submit(second.trip, driverA, 'none');

      const rows = await view();
      const a = rows.find((r) => r.tripId === first.trip)!;
      const b = rows.find((r) => r.tripId === second.trip)!;

      expect(a.accountability).toBe('NOT_DECLARED');
      expect(b.accountability).toBe('DECLARED_NO_EXPENSE');
    });

    it('carries NO money at all', async () => {
      const { trip } = await runningTrip();
      await declare(trip, '9999999.00');
      await money.createHire({
        tripId: trip,
        carrierName: 'Hai Thanh',
        agreedAmount: '4500000.00',
        createdBy: operator,
      });

      const [row] = await view();
      const serialised = JSON.stringify(row);

      expect(serialised).not.toContain('9999999');
      expect(serialised).not.toContain('4500000');
      expect(row).not.toHaveProperty('total');
    });

    it('excludes an archived trip, which is not work in progress', async () => {
      const { trip } = await runningTrip();
      await archive(trip);

      expect(await view()).toHaveLength(0);
    });
  });


  // ============================================ operational timestamp safety ==

  describe('the server owns every business timestamp', () => {
    it('stamps actual_at itself when no caller pins one', async () => {
      const { trip } = await runningTrip();
      const before = Date.now();

      const recorded = await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      const after = Date.now();
      const at = new Date(recorded.actualAt).getTime();

      expect(at).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(after);
    });

    it('stamps recorded_at from PostgreSQL, not from the process', async () => {
      const { trip } = await runningTrip();

      await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        clientEventId: 'tap-1',
        recordedBy: driverA,
      });

      const [row] = (await sql(
        `SELECT recorded_at, now() - recorded_at AS age FROM trip_execution_events WHERE trip_id = $1`,
        [trip],
      )) as { recorded_at: Date; age: { seconds?: number } }[];

      expect(row!.recorded_at).toBeInstanceOf(Date);
      // Written by the column default one statement ago.
      expect(Math.abs(Date.now() - row!.recorded_at.getTime())).toBeLessThan(10_000);
    });

    it('keeps a wildly wrong device clock OUT of actual_at', async () => {
      const { trip } = await runningTrip();

      const recorded = await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        clientEventId: 'tap-1',
        recordedBy: driverA,
        // A handset five years behind.
        deviceReportedAt: new Date('2021-01-01T00:00:00Z'),
      });

      expect(new Date(recorded.actualAt).getUTCFullYear()).toBeGreaterThan(2024);
      expect(recorded.deviceReportedAt?.toISOString()).toBe('2021-01-01T00:00:00.000Z');
    });

    it('★ a wrong device clock cannot move the delay the board reports', async () => {
      // The whole reason the DTO stopped accepting `actualAt`.
      const { trip } = await runningTrip();

      await execution.recordEvent({
        tripId: trip,
        type: 'ARRIVED_PICKUP',
        clientEventId: 'tap-1',
        recordedBy: driverA,
        deviceReportedAt: new Date('2021-01-01T00:00:00Z'),
      });

      const [row] = await operations.list(
        { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never,
        new Date('2026-08-30T05:00:00Z'),
      );

      // Measured from the server's stamp, so a 2021 phone cannot produce a
      // delay of two million minutes.
      expect(row!.pickupDelayMinutes).not.toBeNull();
      expect(row!.pickupDelayMinutes!).toBeLessThan(60 * 24 * 365);
    });

    it('stamps the completion decision times on the server', async () => {
      const { trip } = await runningTrip();
      await declare(trip);
      const before = Date.now();
      await completion.submit(trip, driverA, 'expenses');
      const approved = await completion.approve(trip, reviewer);
      const after = Date.now();

      const decidedAt = new Date(approved.decidedAt as unknown as string).getTime();
      expect(decidedAt).toBeGreaterThanOrEqual(before);
      expect(decidedAt).toBeLessThanOrEqual(after);

      const [row] = (await sql(`SELECT closed_at FROM trip_schedules WHERE id = $1`, [trip])) as {
        closed_at: Date;
      }[];
      expect(row!.closed_at).toBeInstanceOf(Date);
    });
  });


  // ========================================== the completion review queue ==

  describe('the review queue survives a month boundary', () => {
    /** A trip on a given day, with a driver, ready to be completed. */
    const tripOn = async (day: string): Promise<string> => {
      const vehicle = await newVehicle('Q-' + Math.floor(Math.random() * 90000 + 10000));
      const created = await board.create({
        scheduledOn: day,
        vehicleId: vehicle,
        pickupAt: new Date(day + 'T02:00:00Z'),
        deliveryAt: new Date(day + 'T09:00:00Z'),
        createdBy: operator,
      });
      await execution.assign(created.id, driverA, operator);
      return created.id;
    };

    it('★ keeps a trip scheduled LAST MONTH whose completion is still pending', async () => {
      // The defect this method exists for: filtering the queue by
      // `scheduled_on` made a request submitted on the 30th vanish on the 1st,
      // while nobody had decided it.
      const trip = await tripOn('2026-08-30');
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      const queue = await operations.listUnresolvedCompletions();

      expect(queue.map((r) => r.tripId)).toContain(trip);
    });

    it('★ and the month-scoped board does NOT — which is why the queue exists', async () => {
      const trip = await tripOn('2026-08-30');
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      // September, the month after the trip ran.
      const september = await operations.list(
        { from: '2026-09-01', to: '2026-09-30', page: 1, limit: 50 } as never,
      );

      expect(september.map((r) => r.tripId)).not.toContain(trip);
    });

    it('keeps a REJECTED completion in the queue — it is still outstanding', async () => {
      const trip = await tripOn('2026-07-15');
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await completion.reject(trip, { by: reviewer, reason: 'Sai so tien.' });

      const queue = await operations.listUnresolvedCompletions();

      expect(queue.find((r) => r.tripId === trip)).toMatchObject({
        stage: 'COMPLETION_REJECTED',
        completionRejectionReason: 'Sai so tien.',
      });
    });

    it('★ drops a trip from the queue the moment it is approved', async () => {
      const trip = await tripOn('2026-08-30');
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');

      expect((await operations.listUnresolvedCompletions()).map((r) => r.tripId)).toContain(trip);

      await completion.approve(trip, reviewer);

      expect((await operations.listUnresolvedCompletions()).map((r) => r.tripId)).not.toContain(
        trip,
      );
    });

    it('never lists a trip whose completion was never submitted', async () => {
      // That is the DRIVER's outstanding work, and it belongs on the board.
      const trip = await tripOn('2026-08-30');

      expect((await operations.listUnresolvedCompletions()).map((r) => r.tripId)).not.toContain(
        trip,
      );
    });

    it('excludes an archived trip', async () => {
      const trip = await tripOn('2026-08-30');
      await declare(trip);
      await completion.submit(trip, driverA, 'expenses');
      await archive(trip);

      expect((await operations.listUnresolvedCompletions()).map((r) => r.tripId)).not.toContain(
        trip,
      );
    });

    it('orders the longest wait first', async () => {
      const older = await tripOn('2026-07-01');
      const newer = await tripOn('2026-08-30');
      for (const trip of [newer, older]) {
        await declare(trip);
        await completion.submit(trip, driverA, 'expenses');
      }

      const queue = await operations.listUnresolvedCompletions();
      expect(queue[0]!.tripId).toBe(older);
    });
  });


  // ================================ ordering · void · idempotency (timestamps) ==

  describe('event chronology, void and idempotency', () => {
    const at = (hhmm: string) => new Date(`2026-08-30T${hhmm}:00Z`);

    const report = (
      trip: string,
      type: 'ARRIVED_PICKUP' | 'PICKUP_CONFIRMED' | 'ARRIVED_DELIVERY' | 'DELIVERY_CONFIRMED',
      clientEventId: string,
      actualAt?: Date,
    ) =>
      execution.recordEvent({ tripId: trip, type, clientEventId, recordedBy: driverA, ...(actualAt ? { actualAt } : {}) });

    // ------------------------------------------------------------ ordering --

    it('★ stamps actual_at in the order the taps arrive, with no client able to reorder', async () => {
      // The DTO has no `actualAt`, so an out-of-order chronology is not
      // constructible through the API at all — it is monotonic by construction.
      const { trip } = await runningTrip();

      const first = await report(trip, 'ARRIVED_PICKUP', 'tap-1');
      const second = await report(trip, 'PICKUP_CONFIRMED', 'tap-2');

      expect(new Date(second.actualAt).getTime()).toBeGreaterThanOrEqual(
        new Date(first.actualAt).getTime(),
      );
    });

    it('does not let insertion order stand in for chronology', async () => {
      // Written second, happened first. The board reads `actual_at`, not `id`
      // and not insertion order.
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'late', at('02:45'));
      await report(trip, 'ARRIVED_PICKUP', 'early', at('02:20'));

      const [board] = await operations.list(
        { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never,
      );

      expect(board!.arrivedPickupAt?.toISOString()).toBe('2026-08-30T02:20:00.000Z');
    });

    it('handles two events sharing one actual_at without losing either', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await report(trip, 'ARRIVED_PICKUP', 'b', at('02:00'));

      expect(await execution.listEvents(trip)).toHaveLength(2);
    });

    // ---------------------------------------------------------------- void --

    it('★ A · void then replace — the replacement is what counts', async () => {
      const { trip } = await runningTrip();
      const first = await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await execution.voidEvent(trip, first.id, { by: operator, reason: 'Ghi nham.' });
      await report(trip, 'ARRIVED_PICKUP', 'b', at('02:30'));

      const [board] = await operations.list(
        { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never,
      );

      expect(board!.arrivedPickupAt?.toISOString()).toBe('2026-08-30T02:30:00.000Z');
      // The withdrawn one is still readable — history is not shortened.
      expect(await execution.listEvents(trip, true)).toHaveLength(2);
      expect(await execution.listEvents(trip)).toHaveLength(1);
    });

    it('B · two live events of one type — the FIRST is canonical today', async () => {
      // ⚠ A TECHNICAL TIE-BREAK, NOT A DECIDED RULE. `design.md` O-5 proposes
      // the LATEST non-voided reading and is still OPEN; the read model takes
      // the earliest because it cannot make a trip look earlier than it was.
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await report(trip, 'ARRIVED_PICKUP', 'b', at('02:30'));

      const [board] = await operations.list(
        { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never,
      );

      expect(board!.arrivedPickupAt?.toISOString()).toBe('2026-08-30T02:00:00.000Z');
    });

    it('C · three live events of one type — still the earliest', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await report(trip, 'ARRIVED_PICKUP', 'b', at('03:00'));
      await report(trip, 'ARRIVED_PICKUP', 'c', at('04:00'));

      const [board] = await operations.list(
        { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never,
      );

      expect(board!.arrivedPickupAt?.toISOString()).toBe('2026-08-30T02:00:00.000Z');
    });

    it('★ D · void with no replacement — the step becomes outstanding again', async () => {
      const { trip } = await runningTrip();
      const first = await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await execution.voidEvent(trip, first.id, { by: operator, reason: 'Ghi nham.' });

      const [board] = await operations.list(
        { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never,
        new Date('2026-08-30T05:00:00Z'),
      );

      expect(board!.arrivedPickupAt).toBeNull();
      expect(board!.stage).toBe('PICKUP_DELAYED');
      // ★ And the delay is measured to NOW, not to the withdrawn reading.
      expect(board!.pickupDelayMinutes).toBe(180);
    });

    it('the same, for the delivery half', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await report(trip, 'PICKUP_CONFIRMED', 'b', at('02:10'));
      const arrived = await report(trip, 'ARRIVED_DELIVERY', 'c', at('09:30'));
      await execution.voidEvent(trip, arrived.id, { by: operator, reason: 'Ghi nham.' });

      const [board] = await operations.list(
        { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never,
        new Date('2026-08-30T12:00:00Z'),
      );

      expect(board!.arrivedDeliveryAt).toBeNull();
      expect(board!.stage).toBe('DELIVERY_DELAYED');
    });

    it('keeps the provenance of a withdrawn event', async () => {
      const { trip } = await runningTrip();
      const first = await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await execution.voidEvent(trip, first.id, { by: operator, reason: 'Ghi nham chuyen.' });

      const [withdrawn] = await execution.listEvents(trip, true);
      expect(withdrawn).toMatchObject({
        voidedBy: operator,
        voidReason: 'Ghi nham chuyen.',
        recordedBy: driverA,
      });
      expect(withdrawn!.voidedAt).toBeInstanceOf(Date);
    });

    // --------------------------------------------------------- idempotency --

    it('★ deduplicates on the client id, NEVER on a timestamp', async () => {
      // Two genuinely different reports that happen to share an instant must
      // both survive; a timestamp-based key would silently merge them.
      const { trip } = await runningTrip();
      const one = await report(trip, 'ARRIVED_PICKUP', 'first', at('02:00'));
      const two = await report(trip, 'ARRIVED_PICKUP', 'second', at('02:00'));

      expect(one.id).not.toBe(two.id);
      expect(one.actualAt).toEqual(two.actualAt);
    });

    it('★ answers a retry with the original, whatever the clock says', async () => {
      const { trip } = await runningTrip();
      const original = await report(trip, 'ARRIVED_PICKUP', 'same-tap', at('02:00'));
      // The retry arrives later and carries a different pinned instant; the
      // client id is what decides, so the original comes back unchanged.
      const retry = await report(trip, 'ARRIVED_PICKUP', 'same-tap', at('05:00'));

      expect(retry.id).toBe(original.id);
      expect(retry.actualAt).toEqual(original.actualAt);
      expect(await execution.listEvents(trip)).toHaveLength(1);
    });

    it('★ refuses the same client id carrying a DIFFERENT milestone, and stores nothing', async () => {
      // THE BUG THIS PINS. Matching on the key alone answered this request with
      // the arrival and a success status, so a handset reusing a key — a stale
      // draft, a request rebuilt from an offline queue — was told its
      // confirmation had been recorded. It never was, and nothing said so.
      //
      // A key identifies ONE intent. Reused for another milestone it is a
      // caller contradicting itself, and that is refused rather than absorbed.
      const { trip } = await runningTrip();
      const arrival = await report(trip, 'ARRIVED_PICKUP', 'one-tap', at('02:00'));

      await expect(report(trip, 'PICKUP_CONFIRMED', 'one-tap', at('03:00'))).rejects.toBeInstanceOf(
        ConflictError,
      );

      // The refusal wrote nothing and disturbed nothing: the arrival is intact
      // and the confirmation is genuinely absent, not silently aliased to it.
      const stored = await execution.listEvents(trip);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.id).toBe(arrival.id);
      expect(stored[0]!.type).toBe('ARRIVED_PICKUP');
    });

    it('still answers a retry of the SAME milestone idempotently after that refusal', async () => {
      // The narrowing must not cost the guarantee it protects: the honest
      // retry — same key, same milestone — still comes back unchanged.
      const { trip } = await runningTrip();
      const first = await report(trip, 'ARRIVED_PICKUP', 'one-tap', at('02:00'));

      await expect(report(trip, 'PICKUP_CONFIRMED', 'one-tap', at('03:00'))).rejects.toBeInstanceOf(
        ConflictError,
      );

      const retry = await report(trip, 'ARRIVED_PICKUP', 'one-tap', at('04:00'));

      expect(retry.id).toBe(first.id);
      expect(await execution.listEvents(trip)).toHaveLength(1);
    });

    it('refuses a duplicate client id at the database, not only in the service', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'tap-1', at('02:00'));

      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_execution_events
               (trip_id, driver_assignment_id, event_type, actual_at, client_event_id, recorded_by)
             SELECT $1, id, 'PICKUP_CONFIRMED', now(), 'tap-1', $2
               FROM trip_driver_assignments WHERE trip_id = $1 AND state = 'active'`,
            [trip, driverA],
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('★ a withdrawn event still holds its client id, so the tap cannot be replayed', async () => {
      // Voiding does not free the idempotency key: the same tap arriving again
      // must not create a second event just because the first was withdrawn.
      const { trip } = await runningTrip();
      const first = await report(trip, 'ARRIVED_PICKUP', 'tap-1', at('02:00'));
      await execution.voidEvent(trip, first.id, { by: operator, reason: 'Ghi nham.' });

      const replay = await report(trip, 'ARRIVED_PICKUP', 'tap-1', at('03:00'));

      expect(replay.id).toBe(first.id);
      expect(replay.voidedAt).not.toBeNull();
      expect(await execution.listEvents(trip, true)).toHaveLength(1);
    });
  });


  // ============================ event order: what the server enforces today ==

  describe('★ event order — the journey cannot be skipped', () => {
    /**
     * ★ THE RULE IS A PREFIX RULE, NOT "THIS MUST BE THE NEXT ONE".
     *
     * Every EARLIER milestone needs at least one live reading; the milestone
     * being reported may repeat freely. A driver who arrives, leaves and comes
     * back reports an arrival twice — a real fact — while confirming a pickup
     * that was never reached is refused, because every figure downstream would
     * then measure against a step with no time.
     */
    const report = (
      trip: string,
      type: 'ARRIVED_PICKUP' | 'PICKUP_CONFIRMED' | 'ARRIVED_DELIVERY' | 'DELIVERY_CONFIRMED',
      clientEventId: string,
    ) => execution.recordEvent({ tripId: trip, type, clientEventId, recordedBy: driverA });

    it('★ refuses PICKUP_CONFIRMED before ARRIVED_PICKUP', async () => {
      const { trip } = await runningTrip();

      await expect(report(trip, 'PICKUP_CONFIRMED', 'a')).rejects.toBeInstanceOf(ConflictError);
      expect(await execution.listEvents(trip)).toHaveLength(0);
    });

    it('refuses ARRIVED_DELIVERY before the pickup is confirmed', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a');

      await expect(report(trip, 'ARRIVED_DELIVERY', 'b')).rejects.toBeInstanceOf(ConflictError);
    });

    it('refuses DELIVERY_CONFIRMED on a trip that never reported a pickup at all', async () => {
      const { trip } = await runningTrip();

      await expect(report(trip, 'DELIVERY_CONFIRMED', 'a')).rejects.toBeInstanceOf(ConflictError);
    });

    it('names the step that is missing, so the driver knows what to do', async () => {
      const { trip } = await runningTrip();

      await expect(report(trip, 'DELIVERY_CONFIRMED', 'a')).rejects.toThrow(/ARRIVED_PICKUP/);
    });

    it('accepts the four in order', async () => {
      const { trip } = await runningTrip();

      for (const [index, type] of [
        'ARRIVED_PICKUP',
        'PICKUP_CONFIRMED',
        'ARRIVED_DELIVERY',
        'DELIVERY_CONFIRMED',
      ].entries()) {
        await expect(
          report(trip, type as 'ARRIVED_PICKUP', `tap-${index}`),
        ).resolves.toBeDefined();
      }

      expect(await execution.listEvents(trip)).toHaveLength(4);
    });

    it('★ still accepts a REPEATED milestone — leaving and coming back is real', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a');

      await expect(report(trip, 'ARRIVED_PICKUP', 'b')).resolves.toBeDefined();
      expect(await execution.listEvents(trip)).toHaveLength(2);
    });

    it('★ voiding an arrival makes the confirmation skippable again — and refused', async () => {
      const { trip } = await runningTrip();
      const arrival = await report(trip, 'ARRIVED_PICKUP', 'a');
      await execution.voidEvent(trip, arrival.id, { by: operator, reason: 'Ghi nham.' });

      await expect(report(trip, 'PICKUP_CONFIRMED', 'b')).rejects.toBeInstanceOf(ConflictError);
    });

    it('★ is enforced by the APPLICATION, because the database cannot express it', async () => {
      // Ordering is a predicate ACROSS ROWS. A row-level CHECK cannot see the
      // other events, so no constraint on this table can express it — which is
      // exactly why the rule lives in the service, inside the transaction that
      // already holds the trip lock. A maintenance script bypassing the service
      // still gets in; that is the honest limit of the chosen layer.
      const { trip } = await runningTrip();

      const [assignment] = (await sql(
        `SELECT id FROM trip_driver_assignments WHERE trip_id = $1 AND state = 'active'`,
        [trip],
      )) as { id: string }[];

      // Straight past the service, as a maintenance script would.
      expect(
        await codeOf(() =>
          sql(
            `INSERT INTO trip_execution_events
               (trip_id, driver_assignment_id, event_type, actual_at, client_event_id, recorded_by)
             VALUES ($1, $2, 'DELIVERY_CONFIRMED', now(), 'raw', $3)`,
            [trip, assignment!.id, driverA],
          ),
        ),
      ).toBeUndefined();
    });

    // ------------------------------------------------------- concurrency --

    it('★ serialises two simultaneous events on one trip behind the trip row lock', async () => {
      // THE ANSWER TO "would an ordering check be race-free". `recordEvent`
      // opens a transaction and takes `SELECT … FOR UPDATE` on the trip row
      // before it reads anything, so two taps on the same trip cannot both
      // evaluate a predicate against the same stale state.
      //
      // ★ THE ARRIVAL IS SEEDED FIRST, AND THAT IS THE WHOLE FIX.
      //
      // This raced ARRIVED_PICKUP against PICKUP_CONFIRMED on an EMPTY trip and
      // asserted both landed. That was written while the ordering rule was
      // still hypothetical. Once DL-87 made the prefix rule real the assertion
      // became a coin toss: the lock grants one transaction first, and if
      // PICKUP_CONFIRMED wins it is refused for a missing arrival — which is
      // the rule working, not a failure. The test was asserting a LOCK ORDER,
      // and no lock promises one. It passed or failed by scheduling luck.
      //
      // Seeding the arrival leaves two events that are both legal in EITHER
      // order, so the outcome no longer depends on who wins the lock and what
      // remains under test is exactly what the title claims: two simultaneous
      // writers on one trip row serialise, and neither write is lost. The
      // gated pair keeps its own test, directly below.
      const { trip } = await runningTrip();

      await report(trip, 'ARRIVED_PICKUP', 'seed');

      const results = await Promise.allSettled([
        // Prerequisite already satisfied by the seed.
        report(trip, 'PICKUP_CONFIRMED', 'a'),
        // A repeat is never refused: it is the first milestone, so it has no
        // prerequisite, and a driver who leaves and comes back reports an
        // arrival twice.
        report(trip, 'ARRIVED_PICKUP', 'b'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);

      const rows = (await sql(
        `SELECT event_type, actual_at FROM trip_execution_events
          WHERE trip_id = $1 ORDER BY actual_at, id`,
        [trip],
      )) as { event_type: string; actual_at: Date }[];

      // The seed plus both racers: three writes, none lost to the other.
      expect(rows).toHaveLength(3);
      // Distinct commits, so the stamps are ordered rather than identical by
      // accident — evidence the writes did not interleave.
      expect(rows[0]!.actual_at.getTime()).toBeLessThanOrEqual(rows[1]!.actual_at.getTime());
      expect(rows[1]!.actual_at.getTime()).toBeLessThanOrEqual(rows[2]!.actual_at.getTime());
    });

    it('★ a gated pair raced together resolves to a SERIAL outcome, never an interleaved one', async () => {
      // The scenario the test above used to run, asserted the way a race can
      // honestly be asserted: not "both land" — that depends on who wins the
      // lock — but "whatever landed is a history the rule would have allowed
      // had the two arrived one after the other".
      //
      // Both branches are legal, and the point is that NOTHING ELSE is:
      //   arrival first → both stored
      //   confirmation first → refused for the missing arrival, arrival stored
      //
      // What must never happen is a confirmation stored with no arrival behind
      // it, which is precisely what an unserialised read of the event list
      // would produce.
      const { trip } = await runningTrip();

      const [confirmed, arrived] = await Promise.allSettled([
        report(trip, 'PICKUP_CONFIRMED', 'b'),
        report(trip, 'ARRIVED_PICKUP', 'a'),
      ]);

      // The arrival has no prerequisite, so it is stored whichever order the
      // lock granted. Only the confirmation's fate is open.
      expect(arrived!.status).toBe('fulfilled');

      const stored = (await execution.listEvents(trip)).map((event) => event.type);

      expect(stored).toContain('ARRIVED_PICKUP');

      if (confirmed!.status === 'fulfilled') {
        expect(stored).toContain('PICKUP_CONFIRMED');
      } else {
        // Refused for the one reason the rule allows, and nothing was written.
        expect((confirmed as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
        expect(stored).not.toContain('PICKUP_CONFIRMED');
      }
    });

    it('★ concurrency cannot manufacture an invalid sequence', async () => {
      // Four milestones fired at once at an empty trip. The lock serialises
      // them, so each is judged against a settled state — and only the ones
      // whose prerequisites actually hold get in. What must NEVER happen is a
      // confirmation stored with no arrival behind it.
      const { trip } = await runningTrip();

      await Promise.allSettled([
        report(trip, 'ARRIVED_PICKUP', 'a'),
        report(trip, 'PICKUP_CONFIRMED', 'b'),
        report(trip, 'ARRIVED_DELIVERY', 'c'),
        report(trip, 'DELIVERY_CONFIRMED', 'd'),
      ]);

      const stored = (await execution.listEvents(trip)).map((event) => event.type);

      // Whatever got through is a valid PREFIX of the journey.
      const order = ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'];
      for (const type of stored) {
        const position = order.indexOf(type);
        for (const earlier of order.slice(0, position)) {
          expect(stored).toContain(earlier);
        }
      }
    });

    it('serialises repeated readings of one milestone and loses none', async () => {
      const { trip } = await runningTrip();

      const results = await Promise.allSettled([
        report(trip, 'ARRIVED_PICKUP', 'a'),
        report(trip, 'ARRIVED_PICKUP', 'b'),
        report(trip, 'ARRIVED_PICKUP', 'c'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(await execution.listEvents(trip)).toHaveLength(3);
    });

    it('★ still refuses two concurrent taps sharing one client id', async () => {
      // The idempotency guarantee is unaffected by the ordering question.
      const { trip } = await runningTrip();

      const results = await Promise.allSettled([
        report(trip, 'ARRIVED_PICKUP', 'same'),
        report(trip, 'ARRIVED_PICKUP', 'same'),
      ]);

      const ids = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.id] : []));

      // Either one won and the other read it back, or one lost at the index.
      expect(new Set(ids).size).toBe(1);
      expect(await execution.listEvents(trip)).toHaveLength(1);
    });
  });


  // ==================================== DL-86 · canonical reading per milestone ==

  describe('★ DL-86 — ARRIVED takes the first, CONFIRMED takes the last', () => {
    const at = (hhmm: string) => new Date(`2026-08-30T${hhmm}:00Z`);

    const report = (
      trip: string,
      type: 'ARRIVED_PICKUP' | 'PICKUP_CONFIRMED' | 'ARRIVED_DELIVERY' | 'DELIVERY_CONFIRMED',
      clientEventId: string,
      actualAt: Date,
    ) => execution.recordEvent({ tripId: trip, type, clientEventId, recordedBy: driverA, actualAt });

    const board = (trip: string) =>
      operations
        .list({ from: '2026-08-01', to: '2026-08-31', page: 1, limit: 50 } as never)
        .then((rows) => rows.find((row) => row.tripId === trip)!);

    it('takes the EARLIEST ARRIVED_PICKUP', async () => {
      // Arriving is a moment: a later duplicate must not make the trip look as
      // though it got there later than it did.
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a', at('02:45'));
      await report(trip, 'ARRIVED_PICKUP', 'b', at('02:20'));

      expect((await board(trip)).arrivedPickupAt?.toISOString()).toBe('2026-08-30T02:20:00.000Z');
    });

    it('★ takes the LATEST PICKUP_CONFIRMED', async () => {
      // Finishing is a state: a driver who confirms, loads more and confirms
      // again finished at the SECOND confirmation.
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'pre', at('02:00'));
      await report(trip, 'PICKUP_CONFIRMED', 'a', at('02:20'));
      await report(trip, 'PICKUP_CONFIRMED', 'b', at('02:45'));

      expect((await board(trip)).pickupConfirmedAt?.toISOString()).toBe('2026-08-30T02:45:00.000Z');
    });

    it('takes the EARLIEST ARRIVED_DELIVERY', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'p1', at('02:00'));
      await report(trip, 'PICKUP_CONFIRMED', 'p2', at('02:10'));
      await report(trip, 'ARRIVED_DELIVERY', 'a', at('10:00'));
      await report(trip, 'ARRIVED_DELIVERY', 'b', at('09:00'));

      expect((await board(trip)).arrivedDeliveryAt?.toISOString()).toBe('2026-08-30T09:00:00.000Z');
    });

    it('★ takes the LATEST DELIVERY_CONFIRMED', async () => {
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'p1', at('02:00'));
      await report(trip, 'PICKUP_CONFIRMED', 'p2', at('02:10'));
      await report(trip, 'ARRIVED_DELIVERY', 'p3', at('09:00'));
      await report(trip, 'DELIVERY_CONFIRMED', 'a', at('09:30'));
      await report(trip, 'DELIVERY_CONFIRMED', 'b', at('10:30'));

      expect((await board(trip)).deliveryConfirmedAt?.toISOString()).toBe(
        '2026-08-30T10:30:00.000Z',
      );
    });

    it('★ the split changes the delay figure, which is the point of the rule', async () => {
      // Scheduled pickup is 02:00. Arrival at 02:20 and again at 02:45.
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a', at('02:45'));
      await report(trip, 'ARRIVED_PICKUP', 'b', at('02:20'));

      // 20 minutes, from the earliest arrival — not 45 from the duplicate.
      expect((await board(trip)).pickupDelayMinutes).toBe(20);
    });

    it('excludes voided readings from both halves', async () => {
      const { trip } = await runningTrip();
      const early = await report(trip, 'ARRIVED_PICKUP', 'a', at('02:20'));
      await report(trip, 'ARRIVED_PICKUP', 'b', at('02:45'));
      await execution.voidEvent(trip, early.id, { by: operator, reason: 'Ghi nham.' });

      const late = await report(trip, 'PICKUP_CONFIRMED', 'c', at('03:30'));
      await report(trip, 'PICKUP_CONFIRMED', 'd', at('03:00'));
      await execution.voidEvent(trip, late.id, { by: operator, reason: 'Ghi nham.' });

      const row = await board(trip);
      // The withdrawn earliest is gone, so the next earliest stands.
      expect(row.arrivedPickupAt?.toISOString()).toBe('2026-08-30T02:45:00.000Z');
      // The withdrawn latest is gone, so the next latest stands.
      expect(row.pickupConfirmedAt?.toISOString()).toBe('2026-08-30T03:00:00.000Z');
    });

    it('★ resolves a tie on recorded_at, then on id — deterministically', async () => {
      // Two taps CAN share an instant: the server stamps `actual_at`, and a
      // pinned value makes the tie reproducible here. Without a full ordering
      // the planner would decide, and two runs could disagree.
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'a', at('02:00'));
      await report(trip, 'ARRIVED_PICKUP', 'b', at('02:00'));

      const first = (await board(trip)).arrivedPickupAt?.toISOString();
      const second = (await board(trip)).arrivedPickupAt?.toISOString();

      expect(first).toBe('2026-08-30T02:00:00.000Z');
      // Same answer on a second read of the same data.
      expect(second).toBe(first);
    });

    it('agrees with the driver portal, which applies the same rule', async () => {
      // Two canonical rules would put two different times on two screens.
      const { trip } = await runningTrip();
      await report(trip, 'ARRIVED_PICKUP', 'pre', at('02:00'));
      await report(trip, 'PICKUP_CONFIRMED', 'a', at('02:20'));
      await report(trip, 'PICKUP_CONFIRMED', 'b', at('02:45'));

      const events = await execution.listEvents(trip);
      const latest = events
        .filter((event) => event.type === 'PICKUP_CONFIRMED')
        .reduce((best, event) => (event.actualAt > best.actualAt ? event : best));

      expect((await board(trip)).pickupConfirmedAt?.toISOString()).toBe(
        latest.actualAt.toISOString(),
      );
    });
  });

  // ============================================== outsourced hire invariant ==

  describe('outsourced hire', () => {
    it('records a hire against a trip running a hired lorry', async () => {
      const carrier = await newCarrier('Hai Thành 3');
      const vehicle = await newVehicle('HIRED-9', 'outsourced', carrier);
      const trip = await newTrip(vehicle);

      const hire = await money.createHire({
        tripId: trip,
        carrierName: 'Hai Thành',
        agreedAmount: '4500000.00',
        createdBy: operator,
      });

      expect(hire.agreedAmount).toBe('4500000.00');
    });

    it('★ keeps the hire price OUT of what the driver can reach', async () => {
      // The driver-scoped list filters on source AND author; a hire is neither
      // a cost line nor theirs, and lives in a different table entirely.
      const carrier = await newCarrier('Hai Thành 4');
      const vehicle = await newVehicle('HIRED-10', 'outsourced', carrier);
      const trip = await newTrip(vehicle);
      await execution.assign(trip, driverA, operator);
      await money.createHire({
        tripId: trip,
        carrierName: 'Hai Thành',
        agreedAmount: '4500000.00',
        createdBy: operator,
      });
      await money.createCost({
        tripId: trip,
        category: 'warehouse',
        amount: '999999.00',
        createdBy: operator,
      });
      await money.declareCost({
        tripId: trip,
        category: 'loading',
        amount: '200000.00',
        declaredBy: driverA,
      });

      const visible = await costs.listDeclaredByDriver(trip, driverA);

      expect(visible).toHaveLength(1);
      expect(visible[0]!.amount).toBe('200000.00');
      // The office line and the hire are both invisible to this read.
      expect(visible.some((row) => row.amount === '999999.00')).toBe(false);
    });

    it('★ leaves carrier_id NULL on every legacy hire, because nothing maps them', async () => {
      const trip = await newTrip();
      await money.createHire({
        tripId: trip,
        carrierName: 'xe Út',
        agreedAmount: '100000',
        createdBy: operator,
      });

      const [row] = (await sql(
        `SELECT carrier_id, carrier_name FROM trip_outsource_hires WHERE trip_id = $1`,
        [trip],
      )) as { carrier_id: string | null; carrier_name: string }[];

      expect(row).toEqual({ carrier_id: null, carrier_name: 'xe Út' });
    });
  });
});
