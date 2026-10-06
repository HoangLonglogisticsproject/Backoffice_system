import { dispatchCrewOn, entryCrewOn, supersessionOn } from '../helpers/trip-board-fixture';
import { Pool, type PoolClient } from 'pg';
import {
  TEST_URL,
  applyAllMigrations,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import type { Database } from '@common/types/database.port';
import { businessToday } from '@common/pagination/date-range-page-query.dto';
import { UserRepository } from '@core/users/persistence/user.repository';
import { AssignmentRequestReviewService } from '../../src/capabilities/trip-schedule/application/assignment-request-review.service';
import { DriverAssignmentRequestService } from '../../src/capabilities/trip-schedule/application/driver-assignment-request.service';
import { DriverPortalService } from '../../src/capabilities/trip-schedule/application/driver-portal.service';
import { TripCompletionService } from '../../src/capabilities/trip-schedule/application/trip-completion.service';
import { TripExecutionService } from '../../src/capabilities/trip-schedule/application/trip-execution.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import { EXECUTION_EVENT_TYPES, type ExecutionEventType } from '../../src/capabilities/trip-schedule/domain/trip-execution';
import { DriverTripReadModelRepository } from '../../src/capabilities/trip-schedule/persistence/driver-read-model.repository';
import { OpenBookingRepository } from '../../src/capabilities/trip-schedule/persistence/open-booking.repository';
import {
  TripCustomerRepository,
  TripLocationRepository,
  TripVehicleRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { TripAssignmentRequestRepository } from '../../src/capabilities/trip-schedule/persistence/trip-assignment-request.repository';
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
 * Open bookings and drivers' asks, against a REAL PostgreSQL (0035).
 *
 * The rules live in transactions — trip lock, then request, then the crew — so
 * they are tested where they live: two writers on one trip, a held lock, an
 * index refusing the second row.
 */
const SCHEMA = 'driver_open_booking_itest';
const NOT_OPEN = { code: 'VALIDATION_FAILED', details: { booking: 'BOOKING_NOT_OPEN' } };
const PICKUP = { latitude: 10.8188, longitude: 106.6564 };
const DELIVERY = { latitude: 10.7769, longitude: 106.7009 };
/** Exactly what a driver may see of a booking that is not theirs. */
const SAFE_KEYS = [
  'cargoInfo', 'delivery', 'driverInstructions', 'myPendingRequestId', 'pickup',
  'scheduledDeliveryAt', 'scheduledOn', 'scheduledPickupAt', 'tripId',
];

/** `offset` days from today on the business calendar, as `YYYY-MM-DD`. */
const day = (offset: number): string => {
  const date = new Date(`${businessToday(new Date())}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

describeIntegration('Driver open bookings — real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let database: Database;
  let board: TripScheduleService;
  let execution: TripExecutionService;
  let completion: TripCompletionService;
  let asks: DriverAssignmentRequestService;
  let review: AssignmentRequestReviewService;
  let portal: DriverPortalService;
  let operator: string;
  let driverA: string;
  let driverB: string;
  let driverC: string;

  const sql = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await pool.query(text, params)).rows as T[];

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    database = poolAsDatabase(pool);

    const trips = new TripScheduleRepository(database);
    const assignments = new DriverAssignmentRepository(database);
    const events = new ExecutionEventRepository(database);
    const completions = new CompletionRequestRepository(database);
    const history = new TripStatusHistoryRepository(database);
    const users = new UserRepository(database);
    const notifications = new NotificationService(new NotificationRepository(database), new NotificationStream());
    const requests = new TripAssignmentRequestRepository(database);
    const bookings = new OpenBookingRepository(database);

    board = new TripScheduleService(database, trips, new TripCustomerRepository(database), history,
      new TripLocationRepository(database), entryCrewOn(database), supersessionOn(database));
    execution = new TripExecutionService(database, trips, assignments, events, new TripVehicleRepository(database),
      users, notifications, completions, history, new VehicleDailyFuelCheckRepository(database), dispatchCrewOn(database));
    completion = new TripCompletionService(database, trips, assignments, completions, new TripCostRepository(database),
      history, notifications, events, supersessionOn(database));
    asks = new DriverAssignmentRequestService(database, trips, bookings, requests, users);
    review = new AssignmentRequestReviewService(database, trips, bookings, requests, dispatchCrewOn(database), notifications);
    portal = new DriverPortalService(new DriverTripReadModelRepository(database), events, new TripCostRepository(database), completions);

    operator = (await users.insertUser({ displayName: 'Điều Độ' })).id;
    driverA = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
    driverB = (await users.insertUser({ displayName: 'Tài Xế B', accountType: 'driver' })).id;
    driverC = (await users.insertUser({ displayName: 'Tài Xế C', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE trip_assignment_requests, vehicle_daily_fuel_checks, vehicle_costs, notifications, trip_status_history,
                trip_completion_requests, trip_execution_events, trip_cost_edits, trip_costs, trip_outsource_hires,
                trip_driver_assignments, trip_schedules, trip_locations, trip_vehicles, trip_customers, trip_carriers
       RESTART IDENTITY CASCADE`,
    );
  });

  // ---------------------------------------------------------------- helpers --

  let plates = 0;
  const newTrip = async (scheduledOn = day(2)) =>
    (
      await board.create({
        scheduledOn,
        pickupLatitude: PICKUP.latitude,
        pickupLongitude: PICKUP.longitude,
        deliveryLatitude: DELIVERY.latitude,
        deliveryLongitude: DELIVERY.longitude,
        createdBy: operator,
      })
    ).id;
  const newVehicle = async (dailyFuelCheckRequired = false, status = 'active') => {
    plates += 1;
    const [row] = await sql<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by, daily_fuel_check_required, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`51K-${30000 + plates}`, operator, dailyFuelCheckRequired, status],
    );
    return row!.id;
  };
  const statesOn = (trip: string) =>
    sql<{ driver_user_id: string; state: string; resolution_reason: string | null }>(
      `SELECT driver_user_id, state, resolution_reason FROM trip_assignment_requests WHERE trip_id = $1 ORDER BY requested_at`,
      [trip],
    );
  const activeTurns = (trip: string) =>
    sql<{ id: string; driver_user_id: string }>(
      `SELECT id, driver_user_id FROM trip_driver_assignments WHERE trip_id = $1 AND state = 'active'`,
      [trip],
    );
  const toldOf = (user: string) =>
    sql<{ type: string; detail: string | null }>(
      `SELECT type, detail FROM notifications WHERE recipient_user_id = $1 ORDER BY created_at, id`,
      [user],
    );
  const openFor = async (driver: string) => (await asks.listOpenBookings(driver)).map((item) => item.tripId);
  /**
   * A trip row locked in its own transaction, left open — what a race is made
   * to wait on. ★ `FOR NO KEY UPDATE`, so a foreign key's KEY SHARE on the trip
   * (an INSERT referencing it) does NOT queue behind it: only a caller that
   * takes the trip lock itself does, which is what these cases are about.
   */
  const holdTrip = async (trip: string): Promise<PoolClient> => {
    const held = await pool.connect();
    await held.query('BEGIN');
    await held.query('SELECT id FROM trip_schedules WHERE id = $1 FOR NO KEY UPDATE', [trip]);
    return held;
  };
  const release = async (held: PoolClient) => {
    await held.query('COMMIT');
    held.release();
  };
  let taps = 0;
  const report = (assignment: string, type: ExecutionEventType, driver: string) => {
    taps += 1;
    const point = (type === 'PICKUP_CONFIRMED' && PICKUP) || (type === 'DELIVERY_CONFIRMED' && DELIVERY);
    return execution.recordEvent({
      assignmentId: assignment,
      type,
      clientEventId: `tap-${taps}`,
      recordedBy: driver,
      ...(point ? { location: { ...point, accuracyM: 10, capturedAt: new Date() } } : {}),
    });
  };

  // ------------------------------------------------------ who sees what --

  describe('open bookings — what is open', () => {
    it('1. an untouched booking from today on is open, to every driver', async () => {
      const trip = await newTrip();
      expect(await openFor(driverA)).toEqual([trip]);
      expect(await openFor(driverB)).toEqual([trip]);
    });

    it('2–4. archived, finished and crewed trips are not open', async () => {
      const archived = await newTrip();
      await board.archive(archived, operator);
      const finished = await newTrip();
      await completion.completeManually(finished, operator);
      const crewed = await newTrip();
      await execution.assign(crewed, { vehicleId: await newVehicle(), driverUserId: driverB }, operator);

      expect(await openFor(driverA)).toEqual([]);
    });

    it('a crewed trip that also needs a second lorry is still not open — phase 1', async () => {
      const trip = await newTrip();
      await execution.assign(trip, { vehicleId: await newVehicle(), driverUserId: driverB }, operator);
      await expect(asks.request(trip, driverA)).rejects.toMatchObject(NOT_OPEN);
    });

    /**
     * ★ "EXECUTING WITH NOBODY ON IT" IS A REAL STATE, so openness asks for
     * `pending`, not "not finished". Two ways it arises today, both here:
     * the canonical services (a turn's only milestone withdrawn, the turn then
     * ended — withdrawal moves the trip back to nothing), and a row the retired
     * `PATCH /trip-schedules/:id/status` set by hand before 2026-10-02.
     */
    it('★ an executing trip with zero active turns is never an open booking — however it got there', async () => {
      // Through the services: started, its milestone withdrawn, its turn ended.
      const started = await newTrip();
      const turn = await execution.assign(started, { vehicleId: await newVehicle(), driverUserId: driverB }, operator);
      const arrival = await report(turn.id, 'ARRIVED_PICKUP', driverB);
      await execution.voidEvent(started, arrival.id, { by: operator, reason: 'Báo nhầm chuyến.' });
      await execution.endAssignment(started, turn.id, { by: operator, reason: 'Đổi kế hoạch.' });
      // As the retired status route could leave it: executing, nobody ever on it.
      const legacy = await newTrip();
      await sql(`UPDATE trip_schedules SET status = 'executing' WHERE id = $1`, [legacy]);

      for (const trip of [started, legacy]) {
        const [row] = await sql<{ status: string; active: number }>(
          `SELECT status, (SELECT count(*)::int FROM trip_driver_assignments a WHERE a.trip_id = t.id AND a.state = 'active') AS active
             FROM trip_schedules t WHERE t.id = $1`,
          [trip],
        );
        expect(row).toEqual({ status: 'executing', active: 0 });
        await expect(asks.request(trip, driverA)).rejects.toMatchObject(NOT_OPEN);
      }
      expect(await openFor(driverA)).toEqual([]);
      expect(await statesOn(started)).toEqual([]);
      expect(await statesOn(legacy)).toEqual([]);
    });

    it('a booking whose day has passed is not offered', async () => {
      const trip = await newTrip();
      await sql(`UPDATE trip_schedules SET scheduled_on = $2 WHERE id = $1`, [trip, day(-1)]);
      expect(await openFor(driverA)).toEqual([]);
    });
  });

  describe('★ the projection — nothing commercial, nothing private (5–8)', () => {
    it('carries exactly the safe fields: places by name and area, no customer, contact, price or cost', async () => {
      const trip = await newTrip();
      const [customer] = await sql<{ id: string }>(
        `INSERT INTO trip_customers (name, created_by) VALUES ('KHÁCH BÍ MẬT', $1) RETURNING id`, [operator]);
      const [pickup] = await sql<{ id: string }>(
        `INSERT INTO trip_locations (customer_id, name, address, contact, ward, province, created_by)
         VALUES ($1, 'Kho OSC', '12 Đường Bí Mật', '0909 111 222', 'Phường 2', 'TP Hồ Chí Minh', $2) RETURNING id`,
        [customer!.id, operator]);
      await sql(
        `UPDATE trip_schedules SET customer_id = $2, pickup_location_id = $3, pickup_contact = '0909 333 444',
                sell_price = 9876543, purchase_price = 7654321, cargo_info = '17CTN', driver_instructions = 'Gọi trước 30 phút'
          WHERE id = $1`,
        [trip, customer!.id, pickup!.id]);
      await sql(`INSERT INTO trip_costs (trip_id, category, amount, source, created_by) VALUES ($1, 'toll', 55555, 'backoffice', $2)`,
        [trip, operator]);

      const [item] = await asks.listOpenBookings(driverA);
      expect(Object.keys(item!).sort()).toEqual(SAFE_KEYS);
      expect(item).toMatchObject({
        tripId: trip,
        pickup: { name: 'Kho OSC', area: 'Phường 2, TP Hồ Chí Minh' },
        cargoInfo: '17CTN',
        driverInstructions: 'Gọi trước 30 phút',
      });
      const wire = JSON.stringify(item);
      for (const secret of ['9876543', '7654321', '55555', 'KHÁCH BÍ MẬT', '0909', 'Đường Bí Mật', 'sellPrice', 'purchasePrice', 'margin']) {
        expect([secret, wire.includes(secret)]).toEqual([secret, false]);
      }
    });
  });

  // ---------------------------------------------------------------- asking --

  describe('asking (9–13)', () => {
    it('9. creates ONE pending request, owned by the asking driver', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      expect(asked).toMatchObject({ state: 'pending', assignmentId: null, booking: { tripId: trip } });
      expect(await statesOn(trip)).toEqual([{ driver_user_id: driverA, state: 'pending', resolution_reason: null }]);
      expect((await asks.listOpenBookings(driverA))[0]!.myPendingRequestId).toBe(asked.id);
      expect((await asks.listOpenBookings(driverB))[0]!.myPendingRequestId).toBeNull();
    });

    it('10. ★ a double tap — and two racing requests — is the same one request', async () => {
      const trip = await newTrip();
      const [first, second] = await Promise.all([asks.request(trip, driverA), asks.request(trip, driverA)]);
      const third = await asks.request(trip, driverA);
      expect(new Set([first.id, second.id, third.id]).size).toBe(1);
      expect(await statesOn(trip)).toHaveLength(1);
    });

    it('11. many drivers may ask for the same booking', async () => {
      const trip = await newTrip();
      await Promise.all([asks.request(trip, driverA), asks.request(trip, driverB), asks.request(trip, driverC)]);
      expect((await statesOn(trip)).map((row) => row.state)).toEqual(['pending', 'pending', 'pending']);
    });

    it('12–13. a driver sees and withdraws only their own', async () => {
      const trip = await newTrip();
      const mine = await asks.request(trip, driverA);
      await asks.request(trip, driverB);
      expect((await asks.listMine(driverA)).map((request) => request.id)).toEqual([mine.id]);
      await expect(asks.withdraw(mine.id, driverB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('an employee account cannot ask, and an unknown trip answers as "not open"', async () => {
      const trip = await newTrip();
      await expect(asks.request(trip, operator)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(asks.request('00000000-0000-4000-8000-000000000000', driverA)).rejects.toMatchObject(NOT_OPEN);
    });
  });

  describe('withdrawing (14–15)', () => {
    it('14–15. ★ a withdrawn ask is final — it cannot be withdrawn again, or approved', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await expect(asks.withdraw(asked.id, driverA)).resolves.toMatchObject({ state: 'withdrawn' });
      await expect(asks.withdraw(asked.id, driverA)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(review.approve(trip, asked.id, await newVehicle(), operator)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await activeTurns(trip)).toEqual([]);
      // Asking again after withdrawing is a NEW request — history keeps both.
      await asks.request(trip, driverA);
      expect((await statesOn(trip)).map((row) => row.state)).toEqual(['withdrawn', 'pending']);
    });
  });

  // ---------------------------------------------------------------- review --

  describe('review and approval (16–21)', () => {
    it('16. Dispatch sees the pending queue and every ask on a trip, with names', async () => {
      const trip = await newTrip();
      await asks.request(trip, driverA);
      await asks.request(trip, driverB);
      expect((await review.listPending()).map((row) => row.driver.displayName)).toEqual(['Tài Xế A', 'Tài Xế B']);
      expect(await review.listForTrip(trip)).toHaveLength(2);
    });

    it('19–21. ★ approval crews the asking driver with the chosen lorry, references the turn, supersedes the rest', async () => {
      const trip = await newTrip();
      const winner = await asks.request(trip, driverA);
      await asks.request(trip, driverB);
      const vehicle = await newVehicle();

      const approved = await review.approve(trip, winner.id, vehicle, operator);

      const [turn] = await activeTurns(trip);
      expect(turn).toMatchObject({ driver_user_id: driverA });
      expect(approved).toMatchObject({ state: 'approved', approvedAssignmentId: turn!.id, resolvedBy: operator });
      expect(await statesOn(trip)).toEqual([
        { driver_user_id: driverA, state: 'approved', resolution_reason: null },
        { driver_user_id: driverB, state: 'superseded', resolution_reason: 'trip_assigned' },
      ]);
      expect(await openFor(driverC)).toEqual([]);
      expect(await review.listPending()).toEqual([]);
    });

    it('18. ★ approval needs a lorry that can run: a retired one refuses, nothing moves', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await expect(review.approve(trip, asked.id, await newVehicle(false, 'archived'), operator)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await activeTurns(trip)).toEqual([]);
      expect((await statesOn(trip))[0]!.state).toBe('pending');
    });

    it('★ approval re-asks "is it still open" under the lock — a booking that moved on refuses, nothing crewed', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      // A status no write path sets on an uncrewed booking — only to prove the re-check.
      await sql(`UPDATE trip_schedules SET status = 'executing' WHERE id = $1`, [trip]);
      await expect(review.approve(trip, asked.id, await newVehicle(), operator)).rejects.toMatchObject(NOT_OPEN);
      expect(await activeTurns(trip)).toEqual([]);
    });

    it('a request on another trip answers as missing; a rejection keeps the booking open', async () => {
      const trip = await newTrip();
      const other = await newTrip();
      const asked = await asks.request(trip, driverA);
      await expect(review.approve(other, asked.id, await newVehicle(), operator)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await review.reject(trip, asked.id, '  Xe đã đủ  ', operator);
      expect(await statesOn(trip)).toEqual([{ driver_user_id: driverA, state: 'rejected', resolution_reason: 'Xe đã đủ' }]);
      expect(await openFor(driverA)).toEqual(expect.arrayContaining([trip]));
    });
  });

  describe('★ direct dispatch coexists (22, 24)', () => {
    it('22. a direct assignment wins and supersedes every pending ask', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await asks.request(trip, driverB);
      await execution.assign(trip, { vehicleId: await newVehicle(), driverUserId: driverC }, operator);

      expect((await statesOn(trip)).map((row) => [row.state, row.resolution_reason])).toEqual([
        ['superseded', 'trip_assigned'],
        ['superseded', 'trip_assigned'],
      ]);
      await expect(review.approve(trip, asked.id, await newVehicle(), operator)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('24. approval first, then a direct dispatch: a second lorry, nothing left pending', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await review.approve(trip, asked.id, await newVehicle(), operator);
      await execution.assign(trip, { vehicleId: await newVehicle(), driverUserId: driverC }, operator);
      expect(await activeTurns(trip)).toHaveLength(2);
      expect(await review.listPending()).toEqual([]);
    });
  });

  // ----------------------------------------------------------- concurrency --

  describe('★ races, against real row locks (A–H)', () => {
    it('B/C. two approvers, two requests: exactly one wins, one turn exists', async () => {
      const trip = await newTrip();
      const a = await asks.request(trip, driverA);
      const b = await asks.request(trip, driverB);
      const outcomes = await Promise.allSettled([
        review.approve(trip, a.id, await newVehicle(), operator),
        review.approve(trip, b.id, await newVehicle(), operator),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(await activeTurns(trip)).toHaveLength(1);
      expect((await statesOn(trip)).map((row) => row.state).sort()).toEqual(['approved', 'superseded']);
    });

    it('D. approval racing a direct dispatch: one outcome, never a stale pending ask', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      const held = await holdTrip(trip);
      const racing = Promise.allSettled([
        review.approve(trip, asked.id, await newVehicle(), operator),
        execution.assign(trip, { vehicleId: await newVehicle(), driverUserId: driverC }, operator),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await release(held);
      const [approval] = await racing;

      const [request] = await statesOn(trip);
      expect(['approved', 'superseded']).toContain(request!.state);
      expect(await activeTurns(trip)).toHaveLength(approval!.status === 'fulfilled' ? 2 : 1);
      expect(await review.listPending()).toEqual([]);
    });

    it('E. withdrawal racing approval: exactly one of them lands', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      const outcomes = await Promise.allSettled([
        asks.withdraw(asked.id, driverA),
        review.approve(trip, asked.id, await newVehicle(), operator),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const [request] = await statesOn(trip);
      expect(await activeTurns(trip)).toHaveLength(request!.state === 'approved' ? 1 : 0);
    });

    it('A. ★ an ask racing an uncommitted dispatch waits for it — and finds the booking taken', async () => {
      const trip = await newTrip();
      const vehicle = await newVehicle();
      // A dispatch mid-flight: the trip locked, a turn written, not yet committed.
      const held = await holdTrip(trip);
      await held.query(
        `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by) VALUES ($1, $2, $3, $4)`,
        [trip, vehicle, driverC, operator],
      );
      let settled = false;
      const asking = asks.request(trip, driverA).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Noted, then released BEFORE asserting: a failed check must never leave
      // the trip locked under every case that follows.
      const waited = !settled;
      await release(held);
      const outcome = await asking.then(() => 'asked', (error: { details?: unknown }) => error.details);
      expect(waited).toBe(true);
      // Read under the trip lock, AFTER the dispatch committed: not open any more.
      expect(outcome).toEqual(NOT_OPEN.details);
      expect(await statesOn(trip)).toEqual([]);
    });

    it('F. ★ archiving supersedes the asks and tells each driver; approval then finds no trip', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await board.archive(trip, operator);
      expect(await statesOn(trip)).toEqual([{ driver_user_id: driverA, state: 'superseded', resolution_reason: 'trip_archived' }]);
      await expect(review.approve(trip, asked.id, await newVehicle(), operator)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('G. closing a booking by hand supersedes its asks', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await completion.completeManually(trip, operator);
      expect((await statesOn(trip))[0]).toMatchObject({ state: 'superseded', resolution_reason: 'trip_closed' });
      await expect(review.approve(trip, asked.id, await newVehicle(), operator)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('H. a lorry retired before the approval refuses it — the ask stays pending', async () => {
      const trip = await newTrip();
      const vehicle = await newVehicle();
      const asked = await asks.request(trip, driverA);
      await sql(`UPDATE trip_vehicles SET status = 'archived' WHERE id = $1`, [vehicle]);
      await expect(review.approve(trip, asked.id, vehicle, operator)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await statesOn(trip))[0]!.state).toBe('pending');
    });
  });

  // -------------------------------------------------------------- downstream --

  describe('after approval, the existing lifecycle runs unchanged (25–29)', () => {
    const approvedTurn = async (dailyFuel = false) => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await review.approve(trip, asked.id, await newVehicle(dailyFuel), operator);
      return { trip, turn: (await activeTurns(trip))[0]!.id };
    };

    it('25–26. the trip is in the driver’s Lịch làm việc, through the existing read model — still no money', async () => {
      const { trip, turn } = await approvedTurn();
      await sql(`UPDATE trip_schedules SET sell_price = 9876543, purchase_price = 7654321 WHERE id = $1`, [trip]);
      const mine = await portal.listMyAssignments(driverA);
      expect(mine.map((row) => row.assignment.id)).toEqual([turn]);
      expect(JSON.stringify(mine)).not.toMatch(/9876543|7654321|sellPrice|purchasePrice/);
      expect((await asks.listMine(driverA))[0]).toMatchObject({ state: 'approved', assignmentId: turn });
    });

    it('27. ★ the #97 daily fuel gate still holds the first milestone', async () => {
      const { turn } = await approvedTurn(true);
      await expect(report(turn, 'ARRIVED_PICKUP', driverA)).rejects.toMatchObject({
        details: { dailyFuelCheck: 'FUEL_DECLARATION_REQUIRED' },
      });
    });

    it('28–29. ★ #98 still refuses an incomplete close-out, and the whole journey reaches finished', async () => {
      const { trip, turn } = await approvedTurn();
      await report(turn, 'ARRIVED_PICKUP', driverA);
      await expect(completion.submit(turn, driverA, 'none')).rejects.toMatchObject({
        details: { execution: 'EXECUTION_INCOMPLETE' },
      });
      for (const type of EXECUTION_EVENT_TYPES.slice(1)) await report(turn, type, driverA);
      const submitted = await completion.submit(turn, driverA, 'none');
      await completion.approve(trip, submitted.id, operator);
      expect((await sql<{ status: string }>(`SELECT status FROM trip_schedules WHERE id = $1`, [trip]))[0]!.status).toBe('finished');
    });
  });

  describe('notifications (30)', () => {
    it('★ the winner is told it is theirs, the others that it is gone, a rejected driver why', async () => {
      const trip = await newTrip();
      const winner = await asks.request(trip, driverA);
      await asks.request(trip, driverB);
      const other = await newTrip();
      const declined = await asks.request(other, driverC);

      await review.approve(trip, winner.id, await newVehicle(), operator);
      await review.reject(other, declined.id, 'Thiếu bằng lái hạng C', operator);

      expect((await toldOf(driverA)).map((row) => row.type)).toEqual(['TRIP_ASSIGNED']);
      expect(await toldOf(driverB)).toEqual([{ type: 'ASSIGNMENT_REQUEST_SUPERSEDED', detail: 'trip_assigned' }]);
      expect(await toldOf(driverC)).toEqual([{ type: 'ASSIGNMENT_REQUEST_REJECTED', detail: 'Thiếu bằng lái hạng C' }]);
      expect(await toldOf(operator)).toEqual([]);
    });
  });

  describe('31. ★ one statement for the whole list — no N+1', () => {
    it('reads twelve open bookings with places in a single query', async () => {
      for (let index = 0; index < 12; index += 1) await newTrip(day(1 + (index % 3)));
      const statements: string[] = [];
      const counted: Database = {
        ...database,
        query: <T>(text: string, params?: readonly unknown[]) => {
          statements.push(text);
          return database.query<T>(text, params);
        },
      };
      const items = await new OpenBookingRepository(counted).listOpen(driverA, day(0));
      expect(items).toHaveLength(12);
      expect(statements).toHaveLength(1);
    });
  });

  describe('0035 keeps its own promises', () => {
    it('refuses a second pending ask by the same driver, even written by hand', async () => {
      const trip = await newTrip();
      await asks.request(trip, driverA);
      await expect(sql(`INSERT INTO trip_assignment_requests (trip_id, driver_user_id) VALUES ($1, $2)`, [trip, driverA]))
        .rejects.toMatchObject({ code: '23505' });
    });

    it('★ refuses to re-resolve a decided request, and to delete any', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      await asks.withdraw(asked.id, driverA);
      await expect(sql(`UPDATE trip_assignment_requests SET state = 'pending', resolved_at = NULL, resolved_by = NULL WHERE id = $1`, [asked.id]))
        .rejects.toMatchObject({ code: '23001' });
      await expect(sql(`DELETE FROM trip_assignment_requests WHERE id = $1`, [asked.id])).rejects.toMatchObject({ code: '23001' });
    });

    it('refuses an approval that names another driver’s turn', async () => {
      const trip = await newTrip();
      const asked = await asks.request(trip, driverA);
      const turn = await execution.assign(await newTrip(), { vehicleId: await newVehicle(), driverUserId: driverB }, operator);
      await expect(sql(
        `UPDATE trip_assignment_requests SET state = 'approved', resolved_at = now(), resolved_by = $2, approved_assignment_id = $3 WHERE id = $1`,
        [asked.id, operator, turn.id],
      )).rejects.toMatchObject({ code: '23503' });
    });
  });
});
