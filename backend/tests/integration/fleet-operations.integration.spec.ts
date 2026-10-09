import { entryCrewOn, dispatchCrewOn, supersessionOn } from '../helpers/trip-board-fixture';
import { Pool } from 'pg';
import {
  TEST_URL,
  applyAllMigrations,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { fuelSubmissionWriter, stagedPhoto } from '../helpers/fuel-wiring';
import { ConflictError, ForbiddenError, NotFoundError } from '@common/errors/domain.error';
import type { Database } from '@common/types/database.port';
import { UserRepository } from '@core/users/persistence/user.repository';
import { DriverPortalService } from '../../src/capabilities/trip-schedule/application/driver-portal.service';
import { FleetOperationsService } from '../../src/capabilities/trip-schedule/application/fleet-operations.service';
import { TripExecutionService } from '../../src/capabilities/trip-schedule/application/trip-execution.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import { VehicleFuelService } from '../../src/capabilities/trip-schedule/application/vehicle-fuel.service';
import type { ExecutionEventType } from '../../src/capabilities/trip-schedule/domain/trip-execution';
import type { DailyFuelDeclaration, VehicleFuelFill } from '../../src/capabilities/trip-schedule/domain/vehicle-fuel';
import { DriverTripReadModelRepository } from '../../src/capabilities/trip-schedule/persistence/driver-read-model.repository';
import { FleetOperationsRepository } from '../../src/capabilities/trip-schedule/persistence/fleet-operations.repository';
import {
  TripCustomerRepository,
  TripLocationRepository,
  TripVehicleRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { TripCostRepository } from '../../src/capabilities/trip-schedule/persistence/trip-cost.repository';
import {
  CompletionRequestRepository,
  DriverAssignmentRepository,
  ExecutionEventRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-execution.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../../src/capabilities/trip-schedule/persistence/trip-status-history.repository';
import { VehicleCostRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-cost.repository';
import {
  KEY_REUSED,
  VehicleDailyFuelCheckRepository,
} from '../../src/capabilities/trip-schedule/persistence/vehicle-fuel-check.repository';
import { NotificationService } from '../../src/capabilities/notification/application/notification.service';
import { NotificationStream } from '../../src/capabilities/notification/application/notification-stream';
import { NotificationRepository } from '../../src/capabilities/notification/persistence/notification.repository';

/**
 * Fleet operations, the fill after the day's check, and the driver's own day —
 * against a REAL PostgreSQL.
 *
 * The clock is pinned: 10:00 on 6 October 2026 in Hồ Chí Minh. "Today" is the
 * business day of that moment, and every milestone below carries the moment it
 * claims, so the cross-midnight cases are real timestamps either side of
 * 17:00Z — midnight in Asia/Ho_Chi_Minh.
 */
const SCHEMA = 'fleet_operations_itest';

const NOW = new Date('2026-10-06T03:00:00.000Z');
const TODAY = '2026-10-06';
const YESTERDAY = '2026-10-05';
const TOMORROW = '2026-10-07';
/** 22:00 on the 5th and 01:30 on the 6th, Hồ Chí Minh — the two sides of midnight. */
const LATE_YESTERDAY = '2026-10-05T15:00:00.000Z';
const AFTER_MIDNIGHT = '2026-10-05T18:30:00.000Z';
const THIS_MORNING = '2026-10-06T01:00:00.000Z';

const NOT_OPERATED = { code: 'VALIDATION_FAILED', details: { fuelTransaction: 'NOT_OPERATED_TODAY' } };
const REFUSED_START = { code: 'VALIDATION_FAILED', details: { dailyFuelCheck: 'FUEL_DECLARATION_REQUIRED' } };

describeIntegration('Fleet operations and fuel transactions against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let board: TripScheduleService;
  let execution: TripExecutionService;
  let fuel: VehicleFuelService;
  let fleet: FleetOperationsService;
  let portal: DriverPortalService;
  let ledger: VehicleCostRepository;
  let statements: string[];
  let operator: string;
  let driverA: string;
  let driverB: string;

  const sql = async <T>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    const database = poolAsDatabase(pool);
    // The board's own statements, counted — the "no N+1" promise, measured.
    statements = [];
    const counted: Database = {
      ...database,
      query: <T>(text: string, params?: readonly unknown[]) => {
        statements.push(text);
        return database.query<T>(text, params);
      },
    };

    const trips = new TripScheduleRepository(database);
    const vehicles = new TripVehicleRepository(database);
    const assignments = new DriverAssignmentRepository(database);
    const requests = new CompletionRequestRepository(database);
    const history = new TripStatusHistoryRepository(database);
    const checks = new VehicleDailyFuelCheckRepository(database);
    const users = new UserRepository(database);
    ledger = new VehicleCostRepository(database);

    board = new TripScheduleService(
      database,
      trips,
      new TripCustomerRepository(database),
      history,
      new TripLocationRepository(database),
      entryCrewOn(database),
      supersessionOn(database),
    );
    execution = new TripExecutionService(
      database,
      trips,
      assignments,
      new ExecutionEventRepository(database),
      vehicles,
      users,
      new NotificationService(new NotificationRepository(database), new NotificationStream()),
      requests,
      history,
      checks,
      dispatchCrewOn(database),
    );
    fuel = new VehicleFuelService(database, trips, assignments, vehicles, checks, ledger, new FleetOperationsRepository(database), fuelSubmissionWriter(database));
    fleet = new FleetOperationsService(new FleetOperationsRepository(counted));
    portal = new DriverPortalService(
      new DriverTripReadModelRepository(database),
      new ExecutionEventRepository(database),
      new TripCostRepository(database),
      requests,
    );

    operator = (await users.insertUser({ displayName: 'Điều Độ' })).id;
    driverA = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
    driverB = (await users.insertUser({ displayName: 'Tài Xế B', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // TRUNCATE, not DELETE: the ledger and the checks refuse a row-level DELETE.
    await pool.query(
      `TRUNCATE vehicle_daily_fuel_checks, vehicle_costs, notifications, trip_status_history,
                trip_completion_requests, trip_execution_events, trip_cost_edits, trip_costs,
                trip_outsource_hires, trip_assignment_requests, trip_driver_assignments, trip_schedules,
                trip_vehicles, trip_customers, trip_carriers
       RESTART IDENTITY CASCADE`,
    );
    statements.length = 0;
  });

  // ---------------------------------------------------------------- helpers --

  let plates = 0;
  const newVehicle = async (dailyFuelCheckRequired = true) => {
    plates += 1;
    const [row] = await sql<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by, ownership, ownership_set_by, ownership_set_at, daily_fuel_check_required)
       VALUES ($1, $2, 'company', $2, now(), $3) RETURNING id`,
      [`51H-${20000 + plates}`, operator, dailyFuelCheckRequired],
    );
    return row!.id;
  };
  const turn = async (vehicleId: string, { driver = driverA, day = TODAY } = {}) => {
    const trip = (await board.create({ scheduledOn: day, createdBy: operator })).id;
    const assignment = await execution.assign(trip, { vehicleId, driverUserId: driver }, operator);
    return { trip, assignment: assignment.id };
  };
  /** A live milestone at the moment it claims — what the portal leaves behind, without its geofence. */
  const milestone = async (on: { trip: string; assignment: string }, type: ExecutionEventType, at: string, by = driverA) => {
    await sql(
      `INSERT INTO trip_execution_events (trip_id, driver_assignment_id, event_type, actual_at, client_event_id, recorded_by)
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6)`,
      [on.trip, on.assignment, type, at, `${on.assignment}:${type}:${at}`, by],
    );
    await sql(`UPDATE trip_schedules SET status = 'executing' WHERE id = $1 AND status = 'pending'`, [on.trip]);
  };
  const ALL: ExecutionEventType[] = ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'];
  const finish = (trip: string) =>
    sql(`UPDATE trip_schedules SET status = 'finished', closed_at = now(), closed_by = $2 WHERE id = $1`, [trip, operator]);

  let keys = 0;
  const FILL: VehicleFuelFill = { amount: '700000', liters: '30.50', odometerKm: 120500, note: null };
  /** A driver's fill carries a photo (0038), as the phone sends it. */
  const photo = async (by: string) => ({ facts: {}, evidence: [await stagedPhoto(poolAsDatabase(pool), by)] });
  const record = async (assignment: string, fill: VehicleFuelFill = FILL, key = `fill-${(keys += 1)}`, by = driverA, now = NOW) =>
    fuel.recordFill({ assignmentId: assignment, fill, clientRequestId: key, recordedBy: by, receipt: await photo(by) }, now);
  const declare = async (assignment: string, declaration: DailyFuelDeclaration, key = `check-${assignment}`, by = driverA) =>
    fuel.declare(
      {
        assignmentId: assignment,
        declaration,
        clientRequestId: key,
        declaredBy: by,
        ...(declaration.outcome === 'fuel_added' ? { receipt: await photo(by) } : {}),
      },
      NOW,
    );
  const fillOf = (amount: string): DailyFuelDeclaration => ({ outcome: 'fuel_added', amount, liters: '40.00', odometerKm: 120000, note: null });

  const dayOf = async (vehicle: string, day = TODAY, withMoney = true) => {
    const found = (await fleet.board({ day, withMoney }, NOW)).vehicles.find((row) => row.vehicle.id === vehicle);
    if (!found) throw new Error(`Lorry ${vehicle} is not on the board for ${day}.`);
    return found;
  };
  const ledgerOf = (vehicle: string, day = TODAY) => ledger.page(vehicle, { from: day, to: day, category: 'fuel' }, 200, 0);
  const count = async (table: string) => Number((await sql<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);

  // ------------------------------------------------- the three fuel cases --

  describe('★ the check, the declaration\'s fill and the ledger stay three things', () => {
    it('A — "Không đổ nhiên liệu đầu ca", then 700k at noon: the check stands, the ledger holds 700k', async () => {
      const lorry = await newVehicle();
      const run = await turn(lorry);
      await declare(run.assignment, { outcome: 'no_fuel' });

      const fill = await record(run.assignment, { ...FILL, amount: '700000' });

      expect(fill).toMatchObject({ businessDate: TODAY, amount: '700000', liters: '30.50', odometerKm: 120500 });
      expect(await sql(`SELECT outcome, vehicle_cost_id FROM vehicle_daily_fuel_checks`)).toEqual([
        { outcome: 'no_fuel', vehicle_cost_id: null },
      ]);
      expect(await ledgerOf(lorry)).toMatchObject({ total: 1, totalAmount: '700000.00' });
      const day = await dayOf(lorry);
      expect(day.fuel).toMatchObject({ obligation: 'NO_FUEL', fills: 1, totalAmount: '700000.00' });
      expect(day.fuel.check).toMatchObject({ outcome: 'no_fuel', vehicleCostId: null, amount: null });
      // No trip cost, no second check — one more ledger row and nothing else.
      expect(await count('trip_costs')).toBe(0);
      expect(await count('vehicle_daily_fuel_checks')).toBe(1);
    });

    it('B — 650k declared at the start, 300k later: the declaration says 650k, the day says 950k', async () => {
      const lorry = await newVehicle();
      const run = await turn(lorry);
      await declare(run.assignment, fillOf('650000'));

      await record(run.assignment, { ...FILL, amount: '300000' });

      const day = await dayOf(lorry);
      expect(day.fuel).toMatchObject({ obligation: 'FUEL_ADDED', fills: 2, totalAmount: '950000.00' });
      expect(day.fuel.check).toMatchObject({ outcome: 'fuel_added', amount: '650000.00' });
      // ★ The catalogue's "Chi phí xe" for that day: the same figure, to the đồng.
      const catalogue = await ledgerOf(lorry);
      expect(catalogue).toMatchObject({ total: 2, totalAmount: '950000.00' });
      expect(day.fuel.totalAmount).toBe(catalogue.totalAmount);
    });

    it('C — "Không đổ nhiên liệu đầu ca" and nothing else: answered, no fill, nothing owed', async () => {
      const lorry = await newVehicle();
      const run = await turn(lorry);
      await declare(run.assignment, { outcome: 'no_fuel' });

      const day = await dayOf(lorry);
      expect(day.fuel).toMatchObject({ obligation: 'NO_FUEL', fills: 0, totalAmount: '0.00', issues: [] });
      expect(await ledgerOf(lorry)).toMatchObject({ total: 0, totalAmount: '0.00' });
    });

    it('a fill neither answers the day\'s check nor asks it again: the gate is the check\'s alone', async () => {
      const lorry = await newVehicle();
      const first = await turn(lorry);

      // Recorded before anybody answered: the ledger grows, the check is still owed.
      await record(first.assignment);
      expect((await dayOf(lorry)).fuel.obligation).toBe('REQUIRED_MISSING');
      await expect(
        execution.recordEvent({ assignmentId: first.assignment, type: 'ARRIVED_PICKUP', clientEventId: 'a1', recordedBy: driverA }, NOW),
      ).rejects.toMatchObject(REFUSED_START);

      // Answered, then a fill: the next turn of the day starts without being asked again.
      await declare(first.assignment, { outcome: 'no_fuel' });
      await record(first.assignment);
      const second = await turn(lorry);
      await expect(
        execution.recordEvent({ assignmentId: second.assignment, type: 'ARRIVED_PICKUP', clientEventId: 'a2', recordedBy: driverA }, NOW),
      ).resolves.toMatchObject({ type: 'ARRIVED_PICKUP' });
      expect(await count('vehicle_daily_fuel_checks')).toBe(1);
    });
  });

  // ------------------------------------------------------------- authority --

  describe('★ who may record a fill: the turn must be the driver\'s work TODAY', () => {
    it('today\'s run, before its first milestone', async () => {
      const run = await turn(await newVehicle());
      await expect(record(run.assignment)).resolves.toMatchObject({ businessDate: TODAY });
    });

    it('★ today\'s run, already finished — fuelling on the way home', async () => {
      const run = await turn(await newVehicle());
      for (const type of ALL) await milestone(run, type, THIS_MORNING);
      await finish(run.trip);
      await expect(record(run.assignment)).resolves.toMatchObject({ businessDate: TODAY });
    });

    it('★ across midnight, still on the road: yesterday\'s run that started at 22:00', async () => {
      const run = await turn(await newVehicle(), { day: YESTERDAY });
      await milestone(run, 'ARRIVED_PICKUP', LATE_YESTERDAY);
      await expect(record(run.assignment)).resolves.toMatchObject({ businessDate: TODAY });
    });

    it('★ across midnight, finished after it: yesterday\'s run delivered at 01:30', async () => {
      const run = await turn(await newVehicle(), { day: YESTERDAY });
      await milestone(run, 'ARRIVED_PICKUP', LATE_YESTERDAY);
      await milestone(run, 'PICKUP_CONFIRMED', LATE_YESTERDAY);
      await milestone(run, 'ARRIVED_DELIVERY', AFTER_MIDNIGHT);
      await milestone(run, 'DELIVERY_CONFIRMED', AFTER_MIDNIGHT);
      await finish(run.trip);
      await expect(record(run.assignment)).resolves.toMatchObject({ businessDate: TODAY });
    });

    it('yesterday\'s overdue run, still not started: still somebody\'s work today', async () => {
      const run = await turn(await newVehicle(), { day: YESTERDAY });
      await expect(record(run.assignment)).resolves.toMatchObject({ businessDate: TODAY });
    });

    it('★ refuses a run finished yesterday with nothing today, and tomorrow\'s run', async () => {
      const done = await turn(await newVehicle(), { day: YESTERDAY });
      for (const type of ALL) await milestone(done, type, LATE_YESTERDAY);
      await finish(done.trip);
      const later = await turn(await newVehicle(), { day: TOMORROW });

      await expect(record(done.assignment)).rejects.toMatchObject(NOT_OPERATED);
      await expect(record(later.assignment)).rejects.toMatchObject(NOT_OPERATED);
      expect(await count('vehicle_costs')).toBe(0);
    });

    it('a withdrawn milestone proves nothing: voided readings are not a day\'s work', async () => {
      const run = await turn(await newVehicle(), { day: YESTERDAY });
      for (const type of ALL) await milestone(run, type, LATE_YESTERDAY);
      await milestone(run, 'DELIVERY_CONFIRMED', AFTER_MIDNIGHT);
      await sql(
        `UPDATE trip_execution_events SET voided_at = now(), voided_by = $2, void_reason = 'nhầm'
          WHERE driver_assignment_id = $1 AND actual_at = $3::timestamptz`,
        [run.assignment, operator, AFTER_MIDNIGHT],
      );
      await finish(run.trip);
      await expect(record(run.assignment)).rejects.toMatchObject(NOT_OPERATED);
    });

    it('refuses another driver\'s turn as the guards do — 403, nothing told', async () => {
      const run = await turn(await newVehicle());
      await expect(record(run.assignment, FILL, 'k', driverB)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('refuses an ended turn, a lorry whose fuel is not on it, and a trip off the board', async () => {
      const ended = await turn(await newVehicle());
      await execution.endAssignment(ended.trip, ended.assignment, { by: operator, reason: 'Đổi tài xế.' });
      const hired = await turn(await newVehicle(false));
      const archived = await turn(await newVehicle());
      await board.archive(archived.trip, operator);

      await expect(record(ended.assignment)).rejects.toBeInstanceOf(ConflictError);
      await expect(record(hired.assignment)).rejects.toBeInstanceOf(ConflictError);
      await expect(record(archived.assignment)).rejects.toBeInstanceOf(NotFoundError);
      expect(await count('vehicle_costs')).toBe(0);
    });
  });

  // -------------------------------------------------------------- the key --

  describe('★ the key: one intent, one row', () => {
    it('the same key with the same fill is the same row — "700000" retried is "700000.00" stored', async () => {
      const run = await turn(await newVehicle());
      const first = await record(run.assignment, FILL, 'same');
      const retry = await record(run.assignment, { ...FILL, amount: '700000.00', liters: '30.5' }, 'same');

      expect(retry.id).toBe(first.id);
      expect(await count('vehicle_costs')).toBe(1);
    });

    it('★ the same key with another fill, another turn or another driver is a 409 — and writes nothing', async () => {
      const lorry = await newVehicle();
      const mine = await turn(lorry);
      const myOther = await turn(lorry);
      const theirs = await turn(lorry, { driver: driverB });
      await record(mine.assignment, FILL, 'k');

      for (const attempt of [
        () => record(mine.assignment, { ...FILL, amount: '710000' }, 'k'),
        () => record(mine.assignment, { ...FILL, note: 'khác' }, 'k'),
        () => record(myOther.assignment, FILL, 'k'),
        () => record(theirs.assignment, FILL, 'k', driverB),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ message: KEY_REUSED });
      }
      expect(await count('vehicle_costs')).toBe(1);
    });

    it('a declaration\'s key is never a fill\'s, either way round', async () => {
      const lorry = await newVehicle();
      const run = await turn(lorry);
      await declare(run.assignment, fillOf('650000'), 'morning');
      const quiet = await turn(await newVehicle());
      await declare(quiet.assignment, { outcome: 'no_fuel' }, 'quiet');

      // Even with the very same readings: the morning's fill is the check's, never handed back as a fill.
      await expect(record(run.assignment, { amount: '650000', liters: '40.00', odometerKm: 120000, note: null }, 'morning')).rejects.toMatchObject({
        message: KEY_REUSED,
      });
      // "Không đổ nhiên liệu đầu ca" wrote no fill, and its key still is not free.
      await expect(record(quiet.assignment, FILL, 'quiet')).rejects.toMatchObject({ message: KEY_REUSED });
      expect(await count('vehicle_costs')).toBe(1);

      const other = await newVehicle();
      const next = await turn(other);
      await record(next.assignment, FILL, 'noon');
      await expect(declare(next.assignment, fillOf('650000'), 'noon')).rejects.toMatchObject({ message: KEY_REUSED });
      // The refused declaration took nothing: the check is still owed.
      expect((await dayOf(other)).fuel.obligation).toBe('REQUIRED_MISSING');
    });

    it('new keys are new fills — a lorry\'s day holds as many as were bought', async () => {
      const lorry = await newVehicle();
      const run = await turn(lorry);
      await record(run.assignment, FILL, 'one');
      await record(run.assignment, FILL, 'two');
      await record(run.assignment, FILL, 'three');

      expect(await ledgerOf(lorry)).toMatchObject({ total: 3, totalAmount: '2100000.00' });
    });

    it('a retry that arrives after midnight is answered with the original, on its own day', async () => {
      const run = await turn(await newVehicle());
      const first = await record(run.assignment, FILL, 'late');
      const retry = await record(run.assignment, FILL, 'late', driverA, new Date('2026-10-06T17:30:00.000Z'));
      expect(retry).toMatchObject({ id: first.id, businessDate: TODAY });
    });
  });

  // ------------------------------------------------------------ the board --

  describe('★ Điều hành xe — every lorry\'s day, derived', () => {
    it('reads each lorry\'s state from its turns: running, waiting, done, unassigned', async () => {
      const running = await newVehicle();
      await milestone(await turn(running), 'ARRIVED_PICKUP', THIS_MORNING);
      const waiting = await newVehicle();
      await turn(waiting);
      const delivered = await newVehicle();
      const run = await turn(delivered);
      for (const type of ALL) await milestone(run, type, THIS_MORNING);
      const idle = await newVehicle();

      const page = await fleet.board({ withMoney: false }, NOW);

      const stateOf = (id: string) => page.vehicles.find((row) => row.vehicle.id === id)?.state;
      expect([stateOf(running), stateOf(waiting), stateOf(delivered), stateOf(idle)]).toEqual([
        'running',
        'waiting',
        'done',
        'unassigned',
      ]);
      expect(page).toMatchObject({ businessDate: TODAY, withMoney: false });
      // Running and delivered answered no check: two lorries owe one; the idle one owes nothing.
      expect(page.summary).toEqual({ total: 4, running: 1, waiting: 1, unassigned: 1, fuelMissing: 3 });
      expect((await dayOf(idle)).fuel.obligation).toBe('NOT_REQUIRED');
    });

    it('★ the money is not selected without cost.read — the count and the flags still are', async () => {
      const lorry = await newVehicle();
      const run = await turn(lorry);
      await declare(run.assignment, fillOf('650000'));
      await record(run.assignment, { ...FILL, liters: null, odometerKm: null });

      const day = await dayOf(lorry, TODAY, false);

      expect(day.fuel).toMatchObject({ fills: 2, totalAmount: null, issues: ['LITERS_MISSING', 'ODOMETER_MISSING'] });
      expect(day.fuel.check).toMatchObject({ outcome: 'fuel_added', amount: null });
      expect(JSON.stringify(day)).not.toMatch(/650000|700000/);
    });

    it('flags the check owed and missing, and only for a lorry whose fuel is declared on it', async () => {
      const owed = await newVehicle();
      await turn(owed);
      const notOnLorry = await newVehicle(false);
      await turn(notOnLorry);

      expect((await dayOf(owed)).fuel).toMatchObject({ obligation: 'REQUIRED_MISSING', issues: ['FUEL_UNDECLARED'] });
      expect((await dayOf(notOnLorry)).fuel).toMatchObject({ obligation: 'NOT_REQUIRED', issues: [] });
    });

    it('★ NO MULTIPLICATION: two turns, repeated milestones and three fills fold to one honest row', async () => {
      const lorry = await newVehicle();
      const first = await turn(lorry);
      const second = await turn(lorry, { driver: driverB });
      // A milestone may be reported again — and the second turn has three readings.
      await milestone(first, 'ARRIVED_PICKUP', THIS_MORNING);
      await milestone(first, 'ARRIVED_PICKUP', '2026-10-06T01:05:00.000Z');
      await milestone(second, 'ARRIVED_PICKUP', THIS_MORNING, driverB);
      await milestone(second, 'PICKUP_CONFIRMED', THIS_MORNING, driverB);
      await milestone(second, 'PICKUP_CONFIRMED', '2026-10-06T01:10:00.000Z', driverB);
      await declare(first.assignment, fillOf('300000'));
      // Two fills of the SAME amount: a DISTINCT over amounts would drop one.
      await record(first.assignment, { ...FILL, amount: '300000' });
      await record(second.assignment, { ...FILL, amount: '450000' }, 'b', driverB);

      const day = await dayOf(lorry);

      expect(day.turns.map((t) => t.progress.reached)).toEqual([1, 2]);
      expect(day.drivers.map((d) => d.displayName).sort()).toEqual(['Tài Xế A', 'Tài Xế B']);
      expect(day.fuel).toMatchObject({ fills: 3, totalAmount: '1050000.00' });
      expect(day.fuel.totalAmount).toBe((await ledgerOf(lorry)).totalAmount);
    });

    it('★ one statement for the whole fleet, however many lorries and turns', async () => {
      for (let lorry = 0; lorry < 5; lorry += 1) {
        const vehicle = await newVehicle();
        await milestone(await turn(vehicle), 'ARRIVED_PICKUP', THIS_MORNING);
        await turn(vehicle, { driver: driverB });
      }
      statements.length = 0;

      const page = await fleet.board({ withMoney: true }, NOW);

      expect(page.vehicles).toHaveLength(5);
      expect(statements).toHaveLength(1);
    });

    it('a voided fill leaves both the board and the catalogue, together', async () => {
      const lorry = await newVehicle();
      const run = await turn(lorry);
      const kept = await record(run.assignment, { ...FILL, amount: '200000' });
      const voided = await record(run.assignment, { ...FILL, amount: '900000' });
      await sql(`UPDATE vehicle_costs SET voided_at = now(), voided_by = $2 WHERE id = $1`, [voided.id, operator]);

      const day = await dayOf(lorry);
      expect(day.fuel).toMatchObject({ fills: 1, totalAmount: '200000.00' });
      expect(await ledgerOf(lorry)).toMatchObject({ total: 1, totalAmount: '200000.00', items: [{ id: kept.id }] });
    });

    it('carries still-open work into TODAY only; another day shows what was scheduled or ran on it', async () => {
      const lorry = await newVehicle();
      await turn(lorry, { day: '2026-10-04' });

      expect((await dayOf(lorry, TODAY)).state).toBe('waiting');
      expect((await dayOf(lorry, YESTERDAY)).state).toBe('unassigned');
    });

    it('keeps a lorry taken off the books on the day it still worked, and only then', async () => {
      const retired = await newVehicle();
      const run = await turn(retired);
      await milestone(run, 'ARRIVED_PICKUP', THIS_MORNING);
      const unused = await newVehicle();
      await sql(`UPDATE trip_vehicles SET status = 'archived' WHERE id = ANY($1)`, [[retired, unused]]);

      const ids = (await fleet.board({ withMoney: false }, NOW)).vehicles.map((row) => row.vehicle.id);
      expect(ids).toEqual([retired]);
      expect((await dayOf(retired)).vehicle.archived).toBe(true);
    });
  });

  // ------------------------------------------ several trips on one lorry --

  /**
   * ★ ONE LORRY, SEVERAL TRIPS IN A DAY — ONE ROW, ONE STATE, ONE TURN IT
   * SPEAKS FOR. The state is the current turn's: the first RUNNING, else the
   * first WAITING, else the last of the day (DONE); no turn is UNASSIGNED. The
   * driver shown is that turn's driver; "next" is the first other WAITING turn.
   * Turns are in the board's total order: day, pickup time, assigned at, id.
   */
  describe('★ several trips on one lorry — one row, one deterministic state', () => {
    const rowsFor = async (vehicle: string) =>
      (await fleet.board({ withMoney: true }, NOW)).vehicles.filter((row) => row.vehicle.id === vehicle);
    const driverOf = (row: Awaited<ReturnType<typeof dayOf>>) =>
      row.turns.find((t) => t.assignmentId === row.currentAssignmentId)?.driver.displayName ?? null;
    const finishedRun = async (vehicle: string, driver = driverA) => {
      const run = await turn(vehicle, { driver });
      for (const type of ALL) await milestone(run, type, THIS_MORNING, driver);
      await finish(run.trip);
      return run;
    };

    it('A — trip A finished, trip B waiting → WAITING, speaking for B', async () => {
      const lorry = await newVehicle();
      await finishedRun(lorry);
      const b = await turn(lorry, { driver: driverB });

      const [row, ...others] = await rowsFor(lorry);
      expect(others).toEqual([]);
      expect(row).toMatchObject({ state: 'waiting', currentAssignmentId: b.assignment, nextAssignmentId: null });
      expect(driverOf(row!)).toBe('Tài Xế B');
    });

    it('B — A finished, B running, C waiting → RUNNING on B, B\'s driver, C next; the fuel unchanged', async () => {
      const lorry = await newVehicle();
      const a = await finishedRun(lorry);
      const b = await turn(lorry, { driver: driverB });
      await milestone(b, 'ARRIVED_PICKUP', THIS_MORNING, driverB);
      const c = await turn(lorry);
      // Declared through an open turn — a finished trip's turn takes no check.
      await declare(c.assignment, fillOf('400000'));
      await record(b.assignment, { ...FILL, amount: '250000' }, 'b-fill', driverB);

      const [row, ...others] = await rowsFor(lorry);
      expect(others).toEqual([]);
      expect(row!.turns.map((t) => [t.assignmentId, t.state])).toEqual([
        [a.assignment, 'done'],
        [b.assignment, 'running'],
        [c.assignment, 'waiting'],
      ]);
      expect(row).toMatchObject({ state: 'running', currentAssignmentId: b.assignment, nextAssignmentId: c.assignment });
      expect(driverOf(row!)).toBe('Tài Xế B');
      // Three turns fold into one row and never multiply the fills.
      expect(row!.fuel).toMatchObject({ fills: 2, totalAmount: '650000.00' });
      expect(row!.fuel.totalAmount).toBe((await ledgerOf(lorry)).totalAmount);
    });

    it('C — every turn done (one finished, one with all four milestones awaiting approval) → DONE on the last', async () => {
      const lorry = await newVehicle();
      await finishedRun(lorry);
      const delivered = await turn(lorry, { driver: driverB });
      for (const type of ALL) await milestone(delivered, type, THIS_MORNING, driverB);

      const [row] = await rowsFor(lorry);
      expect(row).toMatchObject({ state: 'done', currentAssignmentId: delivered.assignment, nextAssignmentId: null });
      expect(driverOf(row!)).toBe('Tài Xế B');
    });

    it('D — no turn that is the day\'s work (only tomorrow\'s, and one ended today) → UNASSIGNED', async () => {
      const lorry = await newVehicle();
      await turn(lorry, { day: TOMORROW });
      const ended = await turn(lorry);
      await execution.endAssignment(ended.trip, ended.assignment, { by: operator, reason: 'Đổi xe.' });

      const [row] = await rowsFor(lorry);
      expect(row).toMatchObject({ state: 'unassigned', turns: [], currentAssignmentId: null, nextAssignmentId: null });
    });

    it('★ the state is the TURN\'s, not the trip\'s: a second lorry on an executing trip is still waiting', async () => {
      const first = await newVehicle();
      const second = await newVehicle();
      const run = await turn(first);
      const sameTrip = await execution.assign(run.trip, { vehicleId: second, driverUserId: driverB }, operator);
      await milestone(run, 'ARRIVED_PICKUP', THIS_MORNING);
      // A turn whose only milestone was withdrawn is waiting again — the trip stays executing.
      const third = await newVehicle();
      const withdrawn = await turn(third);
      await milestone(withdrawn, 'ARRIVED_PICKUP', THIS_MORNING);
      await sql(`UPDATE trip_execution_events SET voided_at = now(), voided_by = $2, void_reason = 'nhầm' WHERE driver_assignment_id = $1`, [
        withdrawn.assignment,
        operator,
      ]);

      expect((await sql<{ status: string }>(`SELECT status FROM trip_schedules WHERE id = $1`, [run.trip]))[0]!.status).toBe('executing');
      expect((await dayOf(first)).state).toBe('running');
      expect(await dayOf(second)).toMatchObject({ state: 'waiting', currentAssignmentId: sameTrip.id });
      expect((await dayOf(third)).state).toBe('waiting');
    });

    it('★ ties are broken by the board\'s total order, never by chance: same day, same pickup → first assigned', async () => {
      const lorry = await newVehicle();
      const first = await turn(lorry);
      const second = await turn(lorry, { driver: driverB });
      const third = await turn(lorry);

      for (let read = 0; read < 3; read += 1) {
        const [row] = await rowsFor(lorry);
        expect(row!.turns.map((t) => t.assignmentId)).toEqual([first.assignment, second.assignment, third.assignment]);
        expect(row).toMatchObject({ state: 'waiting', currentAssignmentId: first.assignment, nextAssignmentId: second.assignment });
      }
    });
  });

  // -------------------------------------------------------- the driver day --

  describe('★ Ca làm việc hôm nay — the driver\'s own day', () => {
    it('groups the driver\'s turns by lorry, with progress, the fuel answer and nothing of anybody else\'s', async () => {
      const first = await newVehicle();
      const second = await newVehicle(false);
      const morning = await turn(first);
      await milestone(morning, 'ARRIVED_PICKUP', THIS_MORNING);
      await milestone(morning, 'PICKUP_CONFIRMED', THIS_MORNING);
      const afternoon = await turn(first);
      const finished = await turn(second);
      for (const type of ALL) await milestone(finished, type, THIS_MORNING);
      await finish(finished.trip);
      await declare(morning.assignment, fillOf('650000'));
      await turn(first, { driver: driverB });
      await turn(second, { day: TOMORROW });

      const day = await portal.workday(driverA, NOW);

      expect(day.businessDate).toBe(TODAY);
      expect(day.vehicles.map((v) => [v.vehicle.id, v.fuel, v.fuelOnVehicle, v.turns.map((t) => t.assignment.id)])).toEqual([
        [first, 'FUEL_ADDED', true, [morning.assignment, afternoon.assignment]],
        [second, 'NOT_REQUIRED', false, [finished.assignment]],
      ]);
      expect(day.vehicles[0]!.turns.map((t) => [t.progress, t.closed])).toEqual([
        [{ reached: 2, next: 'ARRIVED_DELIVERY' }, false],
        [{ reached: 0, next: 'ARRIVED_PICKUP' }, false],
      ]);
      expect(day.vehicles[1]!.turns[0]).toMatchObject({ closed: true, progress: { reached: 4, next: null } });
      // The fuel is the answer, never the money.
      expect(JSON.stringify(day)).not.toMatch(/650000|amount|price|cost/i);
    });

    it('is empty for a driver with no work today', async () => {
      await turn(await newVehicle(), { day: TOMORROW });
      expect(await portal.workday(driverA, NOW)).toEqual({ businessDate: TODAY, vehicles: [] });
    });
  });
});
