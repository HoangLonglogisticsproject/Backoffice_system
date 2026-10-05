import { entryCrewOn, dispatchCrewOn, supersessionOn } from '../helpers/trip-board-fixture';
import { Pool } from 'pg';
import {
  TEST_URL,
  applyAllMigrations,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { NotFoundError } from '@common/errors/domain.error';
import { UserRepository } from '@core/users/persistence/user.repository';
import { TripCompletionService } from '../../src/capabilities/trip-schedule/application/trip-completion.service';
import { TripExecutionService } from '../../src/capabilities/trip-schedule/application/trip-execution.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import {
  EXECUTION_EVENT_TYPES,
  type ExecutionEventType,
} from '../../src/capabilities/trip-schedule/domain/trip-execution';
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
import { VehicleDailyFuelCheckRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-fuel-check.repository';
import { NotificationService } from '../../src/capabilities/notification/application/notification.service';
import { NotificationStream } from '../../src/capabilities/notification/application/notification-stream';
import { NotificationRepository } from '../../src/capabilities/notification/persistence/notification.repository';

/**
 * A turn closes only over its whole execution (contract §10.5), against a REAL
 * PostgreSQL.
 *
 * The request and its approval both ask `missingMilestones` under the trip
 * lock, and a withdrawal takes that lock too — so the rule is tested where it
 * lives: in a transaction, against rows another transaction can change.
 */
const SCHEMA = 'trip_completion_integrity_itest';
const INCOMPLETE = { code: 'VALIDATION_FAILED', details: { execution: 'EXECUTION_INCOMPLETE' } };

/** Tân Sơn Nhất cargo, then District 1 — the two points every trip here has. */
const PICKUP = { latitude: 10.8188, longitude: 106.6564 };
const DELIVERY = { latitude: 10.7769, longitude: 106.7009 };

describeIntegration('Completion needs a complete execution — real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let board: TripScheduleService;
  let execution: TripExecutionService;
  let completion: TripCompletionService;
  let operator: string;
  let reviewer: string;
  let driverA: string;
  let driverB: string;

  const sql = async <T>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    const database = poolAsDatabase(pool);

    const trips = new TripScheduleRepository(database);
    const assignments = new DriverAssignmentRepository(database);
    const events = new ExecutionEventRepository(database);
    const requests = new CompletionRequestRepository(database);
    const history = new TripStatusHistoryRepository(database);
    const users = new UserRepository(database);
    const notifications = new NotificationService(new NotificationRepository(database), new NotificationStream());

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
      events,
      new TripVehicleRepository(database),
      users,
      notifications,
      requests,
      history,
      new VehicleDailyFuelCheckRepository(database),
      dispatchCrewOn(database),
    );
    completion = new TripCompletionService(
      database,
      trips,
      assignments,
      requests,
      new TripCostRepository(database),
      history,
      notifications,
      events,
      supersessionOn(database),
    );

    operator = (await users.insertUser({ displayName: 'Điều Độ' })).id;
    reviewer = (await users.insertUser({ displayName: 'SuperAdmin' })).id;
    driverA = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
    driverB = (await users.insertUser({ displayName: 'Tài Xế B', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
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
  const newTrip = async () =>
    (
      await board.create({
        scheduledOn: '2026-10-04',
        pickupLatitude: PICKUP.latitude,
        pickupLongitude: PICKUP.longitude,
        deliveryLatitude: DELIVERY.latitude,
        deliveryLongitude: DELIVERY.longitude,
        createdBy: operator,
      })
    ).id;
  const turnOn = async (trip: string, driverUserId = driverA) => {
    plates += 1;
    const [vehicle] = await sql<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`,
      [`51G-${20000 + plates}`, operator],
    );
    return (await execution.assign(trip, { vehicleId: vehicle!.id, driverUserId }, operator)).id;
  };
  const reading = (point: { latitude: number; longitude: number }) => ({
    location: { ...point, accuracyM: 10, capturedAt: new Date() },
  });
  let taps = 0;
  const report = (assignment: string, type: ExecutionEventType, driver = driverA) => {
    taps += 1;
    const evidence =
      (type === 'PICKUP_CONFIRMED' && reading(PICKUP)) || (type === 'DELIVERY_CONFIRMED' && reading(DELIVERY)) || {};
    return execution.recordEvent({ assignmentId: assignment, type, clientEventId: `tap-${taps}`, recordedBy: driver, ...evidence });
  };
  /** Reports the first `count` milestones, in order. */
  const walk = async (assignment: string, count: number, driver = driverA) => {
    const reported = [];
    for (const type of EXECUTION_EVENT_TYPES.slice(0, count)) reported.push(await report(assignment, type, driver));
    return reported;
  };
  const requestsOn = (trip: string) =>
    sql<{ state: string }>(`SELECT state FROM trip_completion_requests WHERE trip_id = $1`, [trip]);
  const statusOf = async (trip: string) =>
    (await sql<{ status: string }>(`SELECT status FROM trip_schedules WHERE id = $1`, [trip]))[0]!.status;

  // --------------------------------------------------------------- submit --

  describe('★ submitting a completion', () => {
    it.each([
      ['1. no milestone at all', 0],
      ['2. only ARRIVED_PICKUP', 1],
      ['3. up to PICKUP_CONFIRMED', 2],
      ['4. up to ARRIVED_DELIVERY', 3],
    ])('%s → 422 EXECUTION_INCOMPLETE, and no request row', async (_case, count) => {
      const trip = await newTrip();
      const turn = await turnOn(trip);
      await walk(turn, count);

      await expect(completion.submit(turn, driverA, 'none')).rejects.toMatchObject(INCOMPLETE);

      expect(await requestsOn(trip)).toEqual([]);
    });

    it('5. every milestone live → accepted, pending', async () => {
      const trip = await newTrip();
      const turn = await turnOn(trip);
      await walk(turn, 4);

      await expect(completion.submit(turn, driverA, 'none')).resolves.toMatchObject({ state: 'pending' });
    });

    it('★ a live DELIVERY_CONFIRMED is not enough — its arrival withdrawn, the request is refused', async () => {
      const trip = await newTrip();
      const turn = await turnOn(trip);
      const [arrival] = await walk(turn, 4);
      await execution.voidEvent(trip, arrival!.id, { by: operator, reason: 'Ghi nhầm.' });

      await expect(completion.submit(turn, driverA, 'none')).rejects.toMatchObject(INCOMPLETE);
    });
  });

  // -------------------------------------------------------------- approve --

  describe('★ approving it asks again', () => {
    it('7. a milestone withdrawn after the request → approval refused, nothing moves', async () => {
      const trip = await newTrip();
      const turn = await turnOn(trip);
      const reported = await walk(turn, 4);
      const request = await completion.submit(turn, driverA, 'none');
      await execution.voidEvent(trip, reported[1]!.id, { by: operator, reason: 'Ảnh lấy hàng sai.' });

      await expect(completion.approve(trip, request.id, reviewer)).rejects.toMatchObject(INCOMPLETE);

      expect(await requestsOn(trip)).toEqual([{ state: 'pending' }]);
      expect(await statusOf(trip)).toBe('executing');
    });

    it('8. the milestone reported again → approval succeeds, the trip closes', async () => {
      const trip = await newTrip();
      const turn = await turnOn(trip);
      const reported = await walk(turn, 4);
      const request = await completion.submit(turn, driverA, 'none');
      await execution.voidEvent(trip, reported[1]!.id, { by: operator, reason: 'Ảnh lấy hàng sai.' });
      await report(turn, 'PICKUP_CONFIRMED');

      await expect(completion.approve(trip, request.id, reviewer)).resolves.toMatchObject({ state: 'approved' });
      expect(await statusOf(trip)).toBe('finished');
    });

    it('★ a withdrawal that commits while the approval waits on the trip lock is seen — refused', async () => {
      const trip = await newTrip();
      const turn = await turnOn(trip);
      const reported = await walk(turn, 4);
      const request = await completion.submit(turn, driverA, 'none');

      const held = await pool.connect();
      try {
        await held.query('BEGIN');
        await held.query(`SELECT 1 FROM trip_schedules WHERE id = $1 FOR UPDATE`, [trip]);
        await held.query(
          `UPDATE trip_execution_events SET voided_at = now(), voided_by = $2, void_reason = 'x' WHERE id = $1`,
          [reported[3]!.id, operator],
        );
        let settled = false;
        const approval = completion.approve(trip, request.id, reviewer).finally(() => {
          settled = true;
        });
        approval.catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);
        await held.query('COMMIT');

        await expect(approval).rejects.toMatchObject(INCOMPLETE);
      } finally {
        held.release();
      }
      expect(await statusOf(trip)).toBe('executing');
    });
  });

  it('★ a withdrawal queues behind the trip lock — the lock the request and its approval read under', async () => {
    const trip = await newTrip();
    const turn = await turnOn(trip);
    const [arrival] = await walk(turn, 1);

    const held = await pool.connect();
    try {
      await held.query('BEGIN');
      await held.query(`SELECT 1 FROM trip_schedules WHERE id = $1 FOR UPDATE`, [trip]);
      let settled = false;
      const withdrawal = execution.voidEvent(trip, arrival!.id, { by: operator, reason: 'Ghi nhầm.' }).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await held.query('COMMIT');
      await expect(withdrawal).resolves.toMatchObject({ id: arrival!.id, voidedBy: operator });
    } finally {
      held.release();
    }
  });

  // ------------------------------------------------- rejection, many turns --

  it('9. a rejection reopens the money, not the rule — a resubmission over a withdrawn milestone is refused', async () => {
    const trip = await newTrip();
    const turn = await turnOn(trip);
    const reported = await walk(turn, 4);
    const request = await completion.submit(turn, driverA, 'none');
    await completion.reject(trip, request.id, { by: reviewer, reason: 'Thiếu mốc giao.' });
    await execution.voidEvent(trip, reported[2]!.id, { by: operator, reason: 'Sai điểm giao.' });

    await expect(completion.submit(turn, driverA, 'none')).rejects.toMatchObject(INCOMPLETE);
    await report(turn, 'ARRIVED_DELIVERY');
    await expect(completion.submit(turn, driverA, 'none')).resolves.toMatchObject({ state: 'pending', attemptNo: 2 });
  });

  it('10. ★ two turns: each is judged on its OWN milestones, and the trip waits for both', async () => {
    const trip = await newTrip();
    const a = await turnOn(trip, driverA);
    const b = await turnOn(trip, driverB);
    await walk(a, 4, driverA);
    await walk(b, 3, driverB);

    const requestA = await completion.submit(a, driverA, 'none');
    // A's complete journey proves nothing about B's.
    await expect(completion.submit(b, driverB, 'none')).rejects.toMatchObject(INCOMPLETE);

    await completion.approve(trip, requestA.id, reviewer);
    expect(await statusOf(trip)).toBe('executing');

    await report(b, 'DELIVERY_CONFIRMED', driverB);
    await completion.approve(trip, (await completion.submit(b, driverB, 'none')).id, reviewer);
    expect(await statusOf(trip)).toBe('finished');
  });

  // ------------------------------------------------------------ unchanged --

  it('11. a run recorded after the fact is untouched: born finished, and still takes no request', async () => {
    const vehicle = (await sql<{ id: string }>(`INSERT INTO trip_vehicles (plate, created_by) VALUES ('51G-99999', $1) RETURNING id`, [operator]))[0]!.id;
    const recorded = await board.create({
      scheduledOn: '2026-08-20',
      entryMode: 'historical',
      crew: [{ vehicleId: vehicle, driverUserId: driverA }],
      createdBy: operator,
    });
    const [turn] = await sql<{ id: string }>(`SELECT id FROM trip_driver_assignments WHERE trip_id = $1`, [recorded.id]);

    expect(recorded.status).toBe('finished');
    await expect(completion.submit(turn!.id, driverA, 'none')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('12. the SuperAdmin break-glass still closes a trip whatever its milestones — on purpose, and recorded', async () => {
    const trip = await newTrip();
    const turn = await turnOn(trip);
    await walk(turn, 1);

    await completion.completeManually(trip, reviewer);

    expect(await statusOf(trip)).toBe('finished');
    const [move] = await sql<{ reason: string; changed_by: string }>(
      `SELECT reason, changed_by FROM trip_status_history WHERE trip_id = $1 AND to_status = 'finished'`,
      [trip],
    );
    expect(move).toEqual({ reason: 'manual_completion', changed_by: reviewer });
  });
});
