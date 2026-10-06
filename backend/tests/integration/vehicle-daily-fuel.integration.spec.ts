import { entryCrewOn, dispatchCrewOn, supersessionOn } from '../helpers/trip-board-fixture';
import { Pool } from 'pg';
import {
  TEST_URL,
  applyAllMigrations,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { ConflictError, ForbiddenError, NotFoundError } from '@common/errors/domain.error';
import { businessToday } from '@common/pagination/date-range-page-query.dto';
import { UserRepository } from '@core/users/persistence/user.repository';
import { TripCatalogueService } from '../../src/capabilities/trip-schedule/application/trip-catalogue.service';
import { TripCostService } from '../../src/capabilities/trip-schedule/application/trip-cost.service';
import { TripExecutionService } from '../../src/capabilities/trip-schedule/application/trip-execution.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import { VehicleCostService } from '../../src/capabilities/trip-schedule/application/vehicle-cost.service';
import { VehicleFuelService } from '../../src/capabilities/trip-schedule/application/vehicle-fuel.service';
import type { DailyFuelDeclaration } from '../../src/capabilities/trip-schedule/domain/vehicle-fuel';
import {
  TripCustomerRepository,
  TripLocationRepository,
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
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../../src/capabilities/trip-schedule/persistence/trip-status-history.repository';
import { FleetOperationsRepository } from '../../src/capabilities/trip-schedule/persistence/fleet-operations.repository';
import { VehicleCostRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-cost.repository';
import { VehicleDailyFuelCheckRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-fuel-check.repository';
import { NotificationService } from '../../src/capabilities/notification/application/notification.service';
import { NotificationStream } from '../../src/capabilities/notification/application/notification-stream';
import { NotificationRepository } from '../../src/capabilities/notification/persistence/notification.repository';

/**
 * A lorry's daily fuel check (0034), against a REAL PostgreSQL.
 *
 * The gate, the declaration and the ledger make their promises through the
 * database — a primary key that serialises two drivers, a deferred foreign key
 * that lets the loser write nothing, triggers that keep a fact a fact — and
 * only a server can say PostgreSQL agrees. The race cases use real overlapping
 * transactions, one of them held open by hand so the wait is not left to luck.
 */
const SCHEMA = 'vehicle_daily_fuel_itest';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const REFUSED_START = { code: 'VALIDATION_FAILED', details: { dailyFuelCheck: 'FUEL_DECLARATION_REQUIRED' } };

describeIntegration('Vehicle daily fuel against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let board: TripScheduleService;
  let execution: TripExecutionService;
  let money: TripCostService;
  let fuel: VehicleFuelService;
  let ledger: VehicleCostService;
  let catalogue: TripCatalogueService;
  let totals: TripCostTotalsRepository;
  let operator: string;
  let driverA: string;
  let driverB: string;

  const sql = async <T>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];
  const codeOf = async (work: () => Promise<unknown>): Promise<string | undefined> =>
    work().then(
      () => undefined,
      (error: { code?: string }) => error.code,
    );

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    const database = poolAsDatabase(pool);

    const trips = new TripScheduleRepository(database);
    const vehicles = new TripVehicleRepository(database);
    const assignments = new DriverAssignmentRepository(database);
    const requests = new CompletionRequestRepository(database);
    const history = new TripStatusHistoryRepository(database);
    const checks = new VehicleDailyFuelCheckRepository(database);
    const vehicleCosts = new VehicleCostRepository(database);
    const users = new UserRepository(database);

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
    money = new TripCostService(
      database,
      trips,
      new TripCostRepository(database),
      new OutsourceHireRepository(database),
      new TripCostTotalsRepository(database),
      assignments,
      vehicles,
      requests,
    );
    fuel = new VehicleFuelService(database, trips, assignments, vehicles, checks, vehicleCosts, new FleetOperationsRepository(database));
    ledger = new VehicleCostService(vehicles, vehicleCosts);
    catalogue = new TripCatalogueService(vehicles, new TripCustomerRepository(database), new TripLocationRepository(database));
    totals = new TripCostTotalsRepository(database);

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
                trip_outsource_hires, trip_driver_assignments, trip_schedules, trip_vehicles,
                trip_customers, trip_carriers
       RESTART IDENTITY CASCADE`,
    );
  });

  // ---------------------------------------------------------------- helpers --

  let plates = 0;
  const newVehicle = async (dailyFuelCheckRequired: boolean, ownership: 'company' | 'outsourced' = 'company') => {
    plates += 1;
    const carrier =
      ownership === 'outsourced'
        ? (await sql<{ id: string }>(`INSERT INTO trip_carriers (name, created_by) VALUES ($1, $2) RETURNING id`, [`Nhà xe ${plates}`, operator]))[0]!.id
        : null;
    const [row] = await sql<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by, ownership, carrier_id, ownership_set_by, ownership_set_at,
                                  daily_fuel_check_required)
       VALUES ($1, $2, $3, $4, $2, now(), $5) RETURNING id`,
      [`51F-${10000 + plates}`, operator, ownership, carrier, dailyFuelCheckRequired],
    );
    return row!.id;
  };
  const newTrip = async () => (await board.create({ scheduledOn: '2026-10-04', createdBy: operator })).id;
  const turn = async (vehicleId: string, driverUserId = driverA, trip?: string) => {
    const tripId = trip ?? (await newTrip());
    const assignment = await execution.assign(tripId, { vehicleId, driverUserId }, operator);
    return { trip: tripId, assignment: assignment.id };
  };
  const arrive = (assignment: string, recordedBy = driverA, serverNow?: Date, actualAt?: Date) =>
    execution.recordEvent(
      { assignmentId: assignment, type: 'ARRIVED_PICKUP', clientEventId: `${assignment}:ARRIVED_PICKUP`, recordedBy, actualAt },
      serverNow,
    );
  const FILL: DailyFuelDeclaration = { outcome: 'fuel_added', amount: '1250000.00', liters: '50.25', odometerKm: 182345, note: 'Petrolimex Q7' };
  const declare = (
    assignment: string,
    declaration: DailyFuelDeclaration = FILL,
    key = `fuel-${assignment}`,
    by = driverA,
    serverNow?: Date,
  ) => fuel.declare({ assignmentId: assignment, declaration, clientRequestId: key, declaredBy: by }, serverNow);
  /** A check written by hand in its own transaction, left OPEN — the winner a race is made to wait on. */
  const holdCheck = async (vehicle: string, day: string, owner: { trip: string; assignment: string }, key: string) => {
    const held = await pool.connect();
    await held.query('BEGIN');
    await held.query(
      `INSERT INTO vehicle_daily_fuel_checks (vehicle_id, business_date, outcome, source_trip_id,
                                              source_assignment_id, client_request_id, created_by)
       VALUES ($1, $2::date, 'no_fuel', $3, $4, $5, $6)`,
      [vehicle, day, owner.trip, owner.assignment, key, driverA],
    );
    return held;
  };
  /** Starts `work` and says whether it was still waiting `ms` later. */
  const waitsOn = async <T>(work: Promise<T>, ms = 300): Promise<{ settled: boolean; outcome: Promise<T> }> => {
    let settled = false;
    const outcome = work.finally(() => {
      settled = true;
    });
    outcome.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { settled, outcome };
  };
  const statusOf = async (trip: string) => (await sql<{ status: string }>(`SELECT status FROM trip_schedules WHERE id = $1`, [trip]))[0]!.status;
  const eventCount = async (assignment: string) =>
    (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM trip_execution_events WHERE driver_assignment_id = $1`, [assignment]))[0]!.n;
  const checksOf = (vehicle: string) => sql<{ business_date: string; outcome: string; vehicle_cost_id: string | null }>(
    `SELECT business_date::text AS business_date, outcome, vehicle_cost_id FROM vehicle_daily_fuel_checks WHERE vehicle_id = $1`, [vehicle]);
  const costsOf = (vehicle: string) => sql<{ id: string; amount: string; liters: string | null; odometer_km: number | null; source_trip_id: string; source_assignment_id: string; business_date: string }>(
    `SELECT id, amount::text AS amount, liters::text AS liters, odometer_km, source_trip_id, source_assignment_id,
            business_date::text AS business_date FROM vehicle_costs WHERE vehicle_id = $1`, [vehicle]);
  const today = () => businessToday(new Date());

  // ------------------------------------------------------------ the gate --

  describe('★ the gate on a turn’s first milestone', () => {
    it('1. a lorry without the policy starts as before — no check asked', async () => {
      const { trip, assignment } = await turn(await newVehicle(false));

      await arrive(assignment);

      expect(await statusOf(trip)).toBe('executing');
    });

    it('2. a lorry with the policy and no check today: 422, no event, the trip still pending', async () => {
      const { trip, assignment } = await turn(await newVehicle(true));

      await expect(arrive(assignment)).rejects.toMatchObject(REFUSED_START);

      expect(await eventCount(assignment)).toBe(0);
      expect(await statusOf(trip)).toBe('pending');
    });

    it('3. fuel_added writes the check and the fill; the same milestone, retried, starts the trip', async () => {
      const vehicle = await newVehicle(true);
      const { trip, assignment } = await turn(vehicle);
      await expect(arrive(assignment)).rejects.toMatchObject(REFUSED_START);

      const check = await declare(assignment);
      const event = await arrive(assignment);

      expect(check).toMatchObject({ vehicleId: vehicle, businessDate: today(), outcome: 'fuel_added', sourceTripId: trip, sourceAssignmentId: assignment });
      const [cost] = await costsOf(vehicle);
      expect(cost).toMatchObject({ id: check.vehicleCostId, amount: '1250000.00', liters: '50.25', odometer_km: 182345, source_trip_id: trip, source_assignment_id: assignment, business_date: today() });
      expect(event.type).toBe('ARRIVED_PICKUP');
      expect(await statusOf(trip)).toBe('executing');
    });

    it('4. no_fuel writes the check and NO cost; the retried milestone passes', async () => {
      const vehicle = await newVehicle(true);
      const { trip, assignment } = await turn(vehicle);

      const check = await declare(assignment, { outcome: 'no_fuel' });
      await arrive(assignment);

      expect(check).toMatchObject({ outcome: 'no_fuel', vehicleCostId: null });
      expect(await costsOf(vehicle)).toEqual([]);
      expect(await statusOf(trip)).toBe('executing');
    });

    it('5. a second trip of the same lorry the same day is not asked again', async () => {
      const vehicle = await newVehicle(true);
      const first = await turn(vehicle);
      await declare(first.assignment);
      const second = await turn(vehicle);

      await arrive(second.assignment);

      expect(await statusOf(second.trip)).toBe('executing');
    });

    it('6. another driver on the same lorry the same day is not asked again', async () => {
      const vehicle = await newVehicle(true);
      await declare((await turn(vehicle, driverA)).assignment);
      const theirs = await turn(vehicle, driverB);

      await arrive(theirs.assignment, driverB);

      expect(await eventCount(theirs.assignment)).toBe(1);
    });

    it('7. the same driver on another lorry not yet checked is held for THAT lorry', async () => {
      await declare((await turn(await newVehicle(true))).assignment);
      const other = await turn(await newVehicle(true));

      await expect(arrive(other.assignment)).rejects.toMatchObject(REFUSED_START);
    });

    it('★ a turn already on the road is never held again — the run past midnight', async () => {
      const vehicle = await newVehicle(false);
      const { assignment } = await turn(vehicle);
      await arrive(assignment);
      // The policy turned on mid-run stands in for a new business day: either
      // way the lorry owes today's check, and the turn has already started.
      await sql(`UPDATE trip_vehicles SET daily_fuel_check_required = true WHERE id = $1`, [vehicle]);

      await execution.recordEvent({ assignmentId: assignment, type: 'ARRIVED_PICKUP', clientEventId: 'again', recordedBy: driverA });

      expect(await eventCount(assignment)).toBe(2);
    });

    it('★ voiding the fill does not undo the check — the fact stands', async () => {
      const vehicle = await newVehicle(true);
      const first = await turn(vehicle);
      const check = await declare(first.assignment);
      await sql(`UPDATE vehicle_costs SET voided_at = now(), voided_by = $2 WHERE id = $1`, [check.vehicleCostId, operator]);

      await arrive((await turn(vehicle)).assignment);

      expect(await checksOf(vehicle)).toHaveLength(1);
    });
  });

  // ------------------------------------------------------- the declaration --

  describe('★ the declaration — once per lorry per day, whoever races', () => {
    it('8. five drivers on five trips of one lorry, all at once: one check, one fill, one answer', async () => {
      const vehicle = await newVehicle(true);
      const turns = await Promise.all([driverA, driverB, driverA, driverB, driverA].map((driver) => turn(vehicle, driver)));

      const answers = await Promise.all(
        turns.map((t, index) => declare(t.assignment, FILL, `race-${index}`, index % 2 === 0 ? driverA : driverB)),
      );

      expect(await checksOf(vehicle)).toHaveLength(1);
      expect(await costsOf(vehicle)).toHaveLength(1);
      expect(new Set(answers.map((answer) => answer.sourceAssignmentId)).size).toBe(1);
    });

    it('8b. ★ the loser WAITS on the winner’s uncommitted check, then writes nothing', async () => {
      const vehicle = await newVehicle(true);
      const winner = await turn(vehicle);
      const loser = await turn(vehicle);
      const held = await pool.connect();
      try {
        await held.query('BEGIN');
        await held.query(
          `INSERT INTO vehicle_daily_fuel_checks (vehicle_id, business_date, outcome, source_trip_id,
                                                  source_assignment_id, client_request_id, created_by)
           VALUES ($1, $2::date, 'no_fuel', $3, $4, 'held', $5)`,
          [vehicle, today(), winner.trip, winner.assignment, driverA],
        );
        let answered = false;
        const pending = declare(loser.assignment).finally(() => {
          answered = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Still waiting: the primary key holds it until the winner decides.
        expect(answered).toBe(false);
        await held.query('COMMIT');

        expect(await pending).toMatchObject({ outcome: 'no_fuel', sourceAssignmentId: winner.assignment });
      } finally {
        held.release();
      }
      expect(await costsOf(vehicle)).toEqual([]);
    });

    it('9. a double tap and a retry are answered with the first check, and write one fill', async () => {
      const vehicle = await newVehicle(true);
      const { assignment } = await turn(vehicle);

      const [first, twin] = await Promise.all([declare(assignment), declare(assignment)]);
      const retry = await declare(assignment);

      expect(twin).toEqual(first);
      expect(retry).toEqual(first);
      expect(await costsOf(vehicle)).toHaveLength(1);
    });

    it('10. ★ the lorry is the assignment’s: another driver cannot declare on it, and a key cannot cross turns', async () => {
      const vehicle = await newVehicle(true);
      const mine = await turn(vehicle, driverA);
      const theirs = await turn(vehicle, driverB);

      await expect(declare(mine.assignment, FILL, 'k', driverB)).rejects.toBeInstanceOf(ForbiddenError);
      const check = await declare(mine.assignment, FILL, 'shared-key');
      // Driver B reusing A's key on the same lorry is not A's retry.
      await expect(declare(theirs.assignment, FILL, 'shared-key', driverB)).rejects.toBeInstanceOf(ConflictError);
      expect(check).toMatchObject({ vehicleId: vehicle, sourceAssignmentId: mine.assignment, createdBy: driverA });
      expect(await costsOf(vehicle)).toHaveLength(1);
    });

    it('refuses a lorry without the policy — the check is not a general fuel log', async () => {
      const { assignment } = await turn(await newVehicle(false));
      await expect(declare(assignment)).rejects.toBeInstanceOf(ConflictError);
    });

    it('14. ★ an archived trip, a finished trip and an ended turn take no declaration', async () => {
      const archived = await turn(await newVehicle(true));
      await board.archive(archived.trip, operator);
      await expect(declare(archived.assignment)).rejects.toBeInstanceOf(NotFoundError);

      const finished = await turn(await newVehicle(true));
      await sql(`UPDATE trip_schedules SET status = 'finished', closed_at = now(), closed_by = $2 WHERE id = $1`, [finished.trip, operator]);
      await expect(declare(finished.assignment)).rejects.toBeInstanceOf(ConflictError);

      const ended = await turn(await newVehicle(true));
      await execution.endAssignment(ended.trip, ended.assignment, { by: operator, reason: 'đổi xe' });
      await expect(declare(ended.assignment)).rejects.toBeInstanceOf(ConflictError);

      expect(await sql(`SELECT 1 FROM vehicle_daily_fuel_checks`)).toEqual([]);
    });
  });

  // ------------------------------------------------- counted once, not twice --

  describe('★ the trip expense and the lorry’s fuel — never both', () => {
    const tripFuel = (assignment: string, category: 'fuel' | 'toll' = 'fuel') =>
      money.declareCost({ assignmentId: assignment, category, amount: '300000.00', declaredBy: driverA });

    it('11. an operational turn on a fuel-managed lorry is refused a `fuel` line; other headings pass', async () => {
      const { assignment } = await turn(await newVehicle(true));

      await expect(tripFuel(assignment)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { category: 'FUEL_DECLARED_ON_VEHICLE' } });
      const toll = await tripFuel(assignment, 'toll');
      await expect(money.editCost(assignment, toll.id, { category: 'fuel' }, driverA)).rejects.toMatchObject({
        details: { category: 'FUEL_DECLARED_ON_VEHICLE' },
      });
    });

    it('a lorry without the policy keeps its `fuel` trip line', async () => {
      const { assignment } = await turn(await newVehicle(false));
      await expect(tripFuel(assignment)).resolves.toMatchObject({ category: 'fuel' });
    });

    it('12. a run recorded after the fact keeps its `fuel` line, whatever the lorry', async () => {
      const vehicle = await newVehicle(true);
      const recorded = await board.create({
        scheduledOn: '2026-08-20',
        entryMode: 'historical',
        crew: [{ vehicleId: vehicle, driverUserId: driverA }],
        createdBy: operator,
      });
      const [row] = await sql<{ id: string }>(`SELECT id FROM trip_driver_assignments WHERE trip_id = $1`, [recorded.id]);

      await expect(tripFuel(row!.id)).resolves.toMatchObject({ category: 'fuel', source: 'driver_portal' });
    });

    it('13. ★ a hired lorry cannot take the policy, and still cannot claim fuel on a trip', async () => {
      const hired = await newVehicle(false, 'outsourced');

      await expect(catalogue.updateVehicle(hired, { dailyFuelCheckRequired: true })).rejects.toMatchObject({
        details: { dailyFuelCheckRequired: 'OUTSOURCED_VEHICLE' },
      });
      expect(await codeOf(() => sql(`UPDATE trip_vehicles SET daily_fuel_check_required = true WHERE id = $1`, [hired]))).toBe(CHECK_VIOLATION);
      await expect(tripFuel((await turn(hired)).assignment)).rejects.toThrow('price agreed with the carrier');
    });

    it('★ the lorry’s fill never reaches the trip’s total — and the ledger reads it back', async () => {
      const vehicle = await newVehicle(true);
      const { trip, assignment } = await turn(vehicle);
      await declare(assignment);

      expect((await totals.forTrip(trip)).combined).toBe('0.00');
      const page = await ledger.page(vehicle, { from: today(), to: today(), page: 1, limit: 20, category: 'fuel' });
      expect(page).toMatchObject({ total: 1, totalPages: 1, totalAmount: '1250000.00' });
      expect(page.items[0]).toMatchObject({ amount: '1250000.00', liters: '50.25', odometerKm: 182345, createdByUser: { displayName: 'Tài Xế A' } });
      // The trip it was declared on rides along as context — still in no trip's total.
      expect(page.items[0]!.sourceTrip).toEqual({ id: trip, scheduledOn: '2026-10-04', customerName: null });
      expect(await ledger.page(vehicle, { from: '2026-01-01', to: '2026-01-31', page: 1, limit: 20 })).toMatchObject({ items: [], total: 0, totalAmount: '0.00' });
    });

    it('★ the ledger holds 0..N costs a lorry a day, and a cost with no trip has no trip — provenance is optional', async () => {
      const vehicle = await newVehicle(true);
      await declare((await turn(vehicle)).assignment);
      // No writer adds a second same-day cost yet; the ledger itself must take it.
      for (const amount of ['300000.00', '45000.00']) {
        await sql(
          `INSERT INTO vehicle_costs (vehicle_id, business_date, category, amount, source, created_by)
           VALUES ($1, $2::date, 'fuel', $3::numeric, 'backoffice', $4)`,
          [vehicle, today(), amount, operator],
        );
      }

      const page = await ledger.page(vehicle, { from: today(), to: today(), page: 1, limit: 20 });

      expect(page).toMatchObject({ total: 3, totalAmount: '1595000.00' });
      const tripless = page.items.filter((cost) => cost.source === 'backoffice');
      expect(tripless).toHaveLength(2);
      for (const cost of tripless) {
        expect(cost).toMatchObject({ sourceTripId: null, sourceTrip: null, sourceAssignmentId: null });
      }
      expect(page.items.find((cost) => cost.source === 'driver_portal')?.sourceTrip).not.toBeNull();
    });
  });

  // --------------------------------------------------------- the schema says --

  describe('the schema keeps the promises on its own', () => {
    it('a fuel_added check needs its fill, a no_fuel check may not have one', async () => {
      const vehicle = await newVehicle(true);
      const { trip, assignment } = await turn(vehicle);
      const insert = (outcome: string, cost: string | null) =>
        sql(
          `INSERT INTO vehicle_daily_fuel_checks (vehicle_id, business_date, outcome, vehicle_cost_id, source_trip_id,
                                                  source_assignment_id, client_request_id, created_by)
           VALUES ($1, '2026-10-01', $2, $3, $4, $5, 'x', $6)`,
          [vehicle, outcome, cost, trip, assignment, driverA],
        );

      expect(await codeOf(() => insert('fuel_added', null))).toBe(CHECK_VIOLATION);
      expect(await codeOf(() => insert('no_fuel', '00000000-0000-4000-8000-000000000000'))).toBe(CHECK_VIOLATION);
    });

    it('a check is never changed or removed; a fill only voided, once', async () => {
      const vehicle = await newVehicle(true);
      const check = await declare((await turn(vehicle)).assignment);

      expect(await codeOf(() => sql(`UPDATE vehicle_daily_fuel_checks SET outcome = 'no_fuel'`))).toBe(RESTRICT_VIOLATION);
      expect(await codeOf(() => sql(`DELETE FROM vehicle_daily_fuel_checks`))).toBe(RESTRICT_VIOLATION);
      expect(await codeOf(() => sql(`UPDATE vehicle_costs SET amount = 1`))).toBe(RESTRICT_VIOLATION);
      expect(await codeOf(() => sql(`DELETE FROM vehicle_costs`))).toBe(RESTRICT_VIOLATION);
      await sql(`UPDATE vehicle_costs SET voided_at = now(), voided_by = $2 WHERE id = $1`, [check.vehicleCostId, operator]);
      expect(await codeOf(() => sql(`UPDATE vehicle_costs SET voided_at = now() WHERE id = $1`, [check.vehicleCostId]))).toBe(RESTRICT_VIOLATION);
    });
  });
  // ------------------------------------------------- Workik review, pinned --

  /** 23:59:59 and 00:00:01 in Hồ Chí Minh, either side of 3 → 4 October. */
  const BEFORE_MIDNIGHT = new Date('2026-10-03T16:59:59Z');
  const AFTER_MIDNIGHT = new Date('2026-10-03T17:00:01Z');

  describe('★ a retry answers only its own driver', () => {
    it('driver B holding A’s assignment id AND key is refused before any retry is looked up', async () => {
      const vehicle = await newVehicle(true);
      const mine = await turn(vehicle, driverA);
      await declare(mine.assignment, FILL, 'a-key');

      await expect(declare(mine.assignment, FILL, 'a-key', driverB)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('★ the provenance is the locked turn’s, the author the session’s — nothing else can be named', async () => {
      const vehicle = await newVehicle(true);
      const { trip, assignment } = await turn(vehicle, driverA);
      const check = await declare(assignment);

      const [row] = await sql<{ vehicle_id: string; created_by: string; source_trip_id: string; source_assignment_id: string }>(
        `SELECT vehicle_id, created_by, source_trip_id, source_assignment_id FROM vehicle_costs WHERE id = $1`,
        [check.vehicleCostId],
      );
      expect(row).toEqual({ vehicle_id: vehicle, created_by: driverA, source_trip_id: trip, source_assignment_id: assignment });
      expect(check).toMatchObject({ vehicleId: vehicle, createdBy: driverA, sourceTripId: trip, sourceAssignmentId: assignment });
    });
  });

  describe('★ one key, one declaration — across turns and across midnight', () => {
    it('the same turn retrying after midnight gets the 03/10 check it made — one check, one fill', async () => {
      const vehicle = await newVehicle(true);
      const { assignment } = await turn(vehicle);

      const first = await declare(assignment, FILL, 'k', driverA, BEFORE_MIDNIGHT);
      const late = await declare(assignment, FILL, 'k', driverA, AFTER_MIDNIGHT);

      expect(late).toEqual(first);
      expect(first.businessDate).toBe('2026-10-03');
      expect(await checksOf(vehicle)).toHaveLength(1);
      expect(await costsOf(vehicle)).toHaveLength(1);
    });

    it('the same turn racing itself across midnight: the trip lock serialises it, one canonical check', async () => {
      const vehicle = await newVehicle(true);
      const { assignment } = await turn(vehicle);

      const [one, two] = await Promise.all([
        declare(assignment, FILL, 'k', driverA, BEFORE_MIDNIGHT),
        declare(assignment, FILL, 'k', driverA, AFTER_MIDNIGHT),
      ]);

      expect(two).toEqual(one);
      expect(await checksOf(vehicle)).toHaveLength(1);
    });

    it('★ another turn reusing the key on the next day is a 409 — never the other declaration', async () => {
      const vehicle = await newVehicle(true);
      const mine = await turn(vehicle, driverA);
      const theirs = await turn(vehicle, driverB);
      await declare(mine.assignment, FILL, 'k', driverA, BEFORE_MIDNIGHT);

      await expect(declare(theirs.assignment, FILL, 'k', driverB, AFTER_MIDNIGHT)).rejects.toBeInstanceOf(ConflictError);
      expect(await checksOf(vehicle)).toHaveLength(1);
    });

    it('★ …and racing an UNCOMMITTED winner across midnight: a 409, not a raw unique violation', async () => {
      const vehicle = await newVehicle(true);
      const winner = await turn(vehicle, driverA);
      const loser = await turn(vehicle, driverB);
      const held = await holdCheck(vehicle, '2026-10-03', winner, 'k');
      try {
        const race = await waitsOn(declare(loser.assignment, FILL, 'k', driverB, AFTER_MIDNIGHT));
        expect(race.settled).toBe(false);
        await held.query('COMMIT');

        const refusal = await race.outcome.catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(ConflictError);
        expect((refusal as { code?: string }).code).toBe('CONFLICT');
      } finally {
        held.release();
      }
      expect(await checksOf(vehicle)).toEqual([expect.objectContaining({ business_date: '2026-10-03' })]);
      expect(await costsOf(vehicle)).toEqual([]);
    });

    it('★ the same day taken by another turn under the SAME key: a 409 — the winner’s check is not handed over', async () => {
      const vehicle = await newVehicle(true);
      const winner = await turn(vehicle, driverA);
      const loser = await turn(vehicle, driverB);
      const held = await holdCheck(vehicle, '2026-10-03', winner, 'k');
      try {
        const race = await waitsOn(declare(loser.assignment, FILL, 'k', driverB, BEFORE_MIDNIGHT));
        expect(race.settled).toBe(false);
        await held.query('COMMIT');
        await expect(race.outcome).rejects.toBeInstanceOf(ConflictError);
      } finally {
        held.release();
      }
      expect(await costsOf(vehicle)).toEqual([]);
    });
  });

  describe('★ one server clock for the declaration and the gate', () => {
    it('server 23:59:59 on 03/10, the milestone stamped another day: both read 03/10', async () => {
      const vehicle = await newVehicle(true);
      const { assignment } = await turn(vehicle);

      const check = await declare(assignment, { outcome: 'no_fuel' }, 'k', driverA, BEFORE_MIDNIGHT);
      await arrive(assignment, driverA, BEFORE_MIDNIGHT, new Date('2026-10-05T03:00:00Z'));

      expect(check.businessDate).toBe('2026-10-03');
      expect(await eventCount(assignment)).toBe(1);
    });

    it('★ the server crosses midnight: a new start needs 04/10, and a new declaration writes 04/10', async () => {
      const vehicle = await newVehicle(true);
      await declare((await turn(vehicle)).assignment, { outcome: 'no_fuel' }, 'k1', driverA, BEFORE_MIDNIGHT);
      const next = await turn(vehicle);

      // A milestone stamped 03/10 does not borrow 03/10's check: the server says 04/10.
      await expect(arrive(next.assignment, driverA, AFTER_MIDNIGHT, BEFORE_MIDNIGHT)).rejects.toMatchObject(REFUSED_START);
      const check = await declare(next.assignment, { outcome: 'no_fuel' }, 'k2', driverA, AFTER_MIDNIGHT);
      await arrive(next.assignment, driverA, AFTER_MIDNIGHT);

      expect(check.businessDate).toBe('2026-10-04');
      expect((await checksOf(vehicle)).map((row) => row.business_date).sort()).toEqual(['2026-10-03', '2026-10-04']);
    });
  });

  describe('★ the policy holds still while it is read', () => {
    it('a declaration waits for an uncommitted policy change, then reads what was committed', async () => {
      const vehicle = await newVehicle(true);
      const { assignment } = await turn(vehicle);
      const held = await pool.connect();
      try {
        await held.query('BEGIN');
        await held.query(`UPDATE trip_vehicles SET daily_fuel_check_required = false WHERE id = $1`, [vehicle]);
        const race = await waitsOn(declare(assignment));
        expect(race.settled).toBe(false);
        await held.query('COMMIT');
        await expect(race.outcome).rejects.toThrow('no daily fuel check');
      } finally {
        held.release();
      }
    });

    it('the gate waits for an uncommitted policy change too — turned on, the start is held', async () => {
      const vehicle = await newVehicle(false);
      const { assignment } = await turn(vehicle);
      const held = await pool.connect();
      try {
        await held.query('BEGIN');
        await held.query(`UPDATE trip_vehicles SET daily_fuel_check_required = true WHERE id = $1`, [vehicle]);
        const race = await waitsOn(arrive(assignment));
        expect(race.settled).toBe(false);
        await held.query('COMMIT');
        await expect(race.outcome).rejects.toMatchObject(REFUSED_START);
      } finally {
        held.release();
      }
    });
  });

  it('a void reason of only spaces is refused, as 0012 refuses it on a trip cost', async () => {
    const vehicle = await newVehicle(true);
    const check = await declare((await turn(vehicle)).assignment);

    expect(
      await codeOf(() =>
        sql(`UPDATE vehicle_costs SET voided_at = now(), voided_by = $2, void_reason = '   ' WHERE id = $1`, [
          check.vehicleCostId,
          operator,
        ]),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});
