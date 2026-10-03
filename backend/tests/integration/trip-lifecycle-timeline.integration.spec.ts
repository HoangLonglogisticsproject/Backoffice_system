import { businessToday } from '@common/pagination/date-range-page-query.dto';
import { TripCostService } from '../../src/capabilities/trip-schedule/application/trip-cost.service';
import { TripVehicleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import {
  OutsourceHireRepository,
  TripCostRepository,
  TripCostTotalsRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-cost.repository';
import {
  CompletionRequestRepository,
  DriverAssignmentRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-execution.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import type { TripLifecycle } from '../../src/capabilities/trip-schedule/domain/trip-schedule';
import { describeIntegration, poolAsDatabase } from '../helpers/integration-database';
import {
  addCost,
  addCrew,
  addHire,
  addTrip,
  boardQuery,
  clearTrips,
  openTripBoard,
  type TripBoardFixture,
} from '../helpers/trip-board-fixture';

/**
 * Lịch xe, Lịch sử chuyến and the trip's timeline against a REAL PostgreSQL.
 *
 *   ONE TRIP, TWO PROJECTIONS    split at the canonical `finished`, never at a date
 *   THE TIMELINE HOLDS           delivery strictly after pickup, create and edit alike
 *   THE DAY IS THE PICKUP'S      `scheduled_on` derived, a contradiction refused
 *   THE ACTION SETS THE INTENT   operational refuses a past day; historical records one
 */
describeIntegration('Trip lifecycle projections and timeline against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let fx: TripBoardFixture;

  beforeAll(async () => {
    fx = await openTripBoard('trip_lifecycle_timeline_itest');
  });

  afterAll(async () => {
    await fx?.pool.end();
  });

  beforeEach(async () => {
    await clearTrips(fx.pool);
  });

  /** A day on the business calendar, relative to the real today. */
  const day = (offset: number): string => businessToday(new Date(Date.now() + offset * 86_400_000));
  /** A Hồ Chí Minh wall-clock time on `on`. */
  const at = (on: string, time: string): Date => new Date(`${on}T${time}:00+07:00`);

  const setStatus = (trip: string, status: string) =>
    fx.pool.query(`UPDATE trip_schedules SET status = $2 WHERE id = $1`, [trip, status]);
  /** The canonical closed state — what `finishTrip` leaves behind. */
  const finish = (trip: string) =>
    fx.pool.query(
      `UPDATE trip_schedules SET status = 'finished', closed_at = now(), closed_by = $2 WHERE id = $1`,
      [trip, fx.author],
    );

  const idsIn = async (lifecycle: TripLifecycle): Promise<string[]> =>
    (await fx.board.page(boardQuery({ from: day(-40), to: day(40), lifecycle }), false)).items.map((t) => t.id);

  const storedTrips = async (): Promise<number> =>
    Number((await fx.pool.query<{ n: string }>(`SELECT count(*) AS n FROM trip_schedules`)).rows[0]!.n);

  describe('★ Lịch xe and Lịch sử chuyến — one trip, two projections', () => {
    it('keeps current, future and OVERDUE unfinished trips on Lịch xe, and none of them in History', async () => {
      const today = await addTrip(fx, day(0));
      const future = await addTrip(fx, day(3));
      const overdue = await addTrip(fx, day(-1));
      await setStatus(overdue, 'executing');

      expect((await idsIn('operational')).sort()).toEqual([today, future, overdue].sort());
      expect(await idsIn('history')).toEqual([]);
    });

    it('moves a finished trip to History and off Lịch xe', async () => {
      const open = await addTrip(fx, day(-2));
      const done = await addTrip(fx, day(-2));
      await finish(done);

      expect(await idsIn('operational')).toEqual([open]);
      expect(await idsIn('history')).toEqual([done]);
    });

    it('★ decides by the terminal state, never by the date', async () => {
      const finishedTomorrow = await addTrip(fx, day(1));
      await finish(finishedTomorrow);
      const unfinishedLastMonth = await addTrip(fx, day(-30));

      expect(await idsIn('history')).toEqual([finishedTomorrow]);
      expect(await idsIn('operational')).toEqual([unfinishedLastMonth]);
    });

    it('counts a trip closed before 0017 — `finished`, no closing stamp — as history all the same', async () => {
      const legacy = await addTrip(fx, day(-5));
      await setStatus(legacy, 'finished');

      expect(await idsIn('history')).toEqual([legacy]);
    });

    it('★ one History row per trip whatever the crew, its cost split from ONE aggregate', async () => {
      const trip = await addTrip(fx, day(-3));
      await addCrew(fx, trip, '51D-10001');
      await addCrew(fx, trip, '51D-10002');
      await addCost(fx, trip, '800000');
      await addCost(fx, trip, '200000', { category: 'toll' });
      await addHire(fx, trip, '3000000');
      await finish(trip);

      fx.statements.length = 0;
      const page = await fx.board.page(boardQuery({ from: day(-40), to: day(40), lifecycle: 'history' }), true);

      expect(page.total).toBe(1);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.assignments).toHaveLength(2);
      expect(page.items[0]!.costSummary).toMatchObject({
        total: '4000000.00',
        hires: '3000000.00',
        byCategory: { fuel: '800000.00', toll: '200000.00' },
      });
      // The page and the cost aggregate: two statements, however many trips.
      expect(fx.statements).toHaveLength(2);
    });

    it('recovers the total for a page past the end within the same projection', async () => {
      for (const offset of [-1, -2, -3]) await finish(await addTrip(fx, day(offset)));
      await addTrip(fx, day(-1));

      const beyond = await fx.board.page(
        boardQuery({ from: day(-40), to: day(40), lifecycle: 'history', page: 9, limit: 2 }),
        false,
      );

      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(3);
    });
  });

  describe('★ the timeline: delivery strictly after pickup', () => {
    const on = day(5);
    const refusal = { code: 'VALIDATION_FAILED', details: { deliveryAt: 'NOT_AFTER_PICKUP' } };

    it('refuses 17:36 → 16:36 on the same day, however the request was crafted, and stores nothing', async () => {
      await expect(
        fx.trips.create({ pickupAt: at(on, '17:36'), deliveryAt: at(on, '16:36'), createdBy: fx.author }),
      ).rejects.toMatchObject(refusal);
      expect(await storedTrips()).toBe(0);
    });

    it('refuses a delivery at the pickup instant itself', async () => {
      await expect(
        fx.trips.create({ pickupAt: at(on, '17:36'), deliveryAt: at(on, '17:36'), createdBy: fx.author }),
      ).rejects.toMatchObject(refusal);
    });

    it('accepts 17:36 → 16:36 the NEXT day, and files it on the pickup day', async () => {
      const created = await fx.trips.create({
        pickupAt: at(on, '17:36'),
        deliveryAt: at(day(6), '16:36'),
        createdBy: fx.author,
      });

      expect(created.scheduledOn).toBe(on);
      expect(created.deliveryAt?.toISOString()).toBe(at(day(6), '16:36').toISOString());
    });

    it('★ refuses an edit that turns a valid trip backwards, and leaves the row as it was', async () => {
      const trip = await fx.trips.create({
        pickupAt: at(on, '08:00'),
        deliveryAt: at(on, '12:00'),
        createdBy: fx.author,
      });

      await expect(fx.trips.update(trip.id, { deliveryAt: at(on, '07:00') }, fx.author)).rejects.toMatchObject(
        refusal,
      );
      const { rows } = await fx.pool.query<{ delivery_at: Date }>(
        `SELECT delivery_at FROM trip_schedules WHERE id = $1`,
        [trip.id],
      );
      expect(rows[0]!.delivery_at.toISOString()).toBe(at(on, '12:00').toISOString());
    });

    it('★ keeps a row typed backwards before the rule editable — until a time is moved', async () => {
      const legacy = await addTrip(fx, on);
      await fx.pool.query(`UPDATE trip_schedules SET pickup_at = $2, delivery_at = $3 WHERE id = $1`, [
        legacy,
        at(on, '17:36'),
        at(on, '16:36'),
      ]);

      // Pricing it, or fixing its note, moves neither time.
      await expect(fx.trips.update(legacy, { note: 'đã đối chiếu' }, fx.author)).resolves.toMatchObject({
        note: 'đã đối chiếu',
      });
      // Touching a time is what has to make it right.
      await expect(fx.trips.update(legacy, { pickupAt: at(on, '17:00') }, fx.author)).rejects.toMatchObject(
        refusal,
      );
    });
  });

  describe('★ the board day is the pickup day', () => {
    it('derives it on the Hồ Chí Minh calendar — 00:30 there is still yesterday in UTC', async () => {
      const on = day(4);
      const created = await fx.trips.create({ pickupAt: at(on, '00:30'), createdBy: fx.author });

      expect(created.scheduledOn).toBe(on);
    });

    it('refuses a day that contradicts the pickup — the 29th beside the 23rd', async () => {
      await expect(
        fx.trips.create({ scheduledOn: day(10), pickupAt: at(day(4), '17:36'), createdBy: fx.author }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { scheduledOn: 'NOT_THE_PICKUP_DAY' } });
    });

    it('★ keeps a stored mismatch through an unrelated edit, and converges when the pickup moves', async () => {
      const legacy = await addTrip(fx, day(10));
      await fx.pool.query(`UPDATE trip_schedules SET pickup_at = $2 WHERE id = $1`, [legacy, at(day(4), '17:36')]);

      const noted = await fx.trips.update(legacy, { note: 'x', pickupAt: at(day(4), '17:36') }, fx.author);
      expect(noted.scheduledOn).toBe(day(10));

      const moved = await fx.trips.update(legacy, { pickupAt: at(day(5), '09:00') }, fx.author);
      expect(moved.scheduledOn).toBe(day(5));
    });
  });

  describe('★ the route sets the intent, not the date', () => {
    const lastWeek = { pickupAt: at(day(-7), '17:36'), deliveryAt: at(day(-6), '16:36') };

    it('refuses last week through the booking, and stores nothing', async () => {
      await expect(
        fx.trips.create({ ...lastWeek, entryMode: 'operational', createdBy: fx.author }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { scheduledOn: 'PAST_DAY' } });
      expect(await storedTrips()).toBe(0);
    });

    it('★ books a pickup HOURS AHEAD — the future is what a booking is for', async () => {
      const soon = new Date(Date.now() + 3_600_000);
      const created = await fx.trips.create({
        pickupAt: soon,
        deliveryAt: new Date(soon.getTime() + 3_600_000),
        entryMode: 'operational',
        createdBy: fx.author,
      });

      expect(created.status).toBe('pending');
      expect(created.pickupAt?.toISOString()).toBe(soon.toISOString());
    });

    /**
     * ★ THE OPERATIONAL BOUNDARY, THROUGH THE SERVICE AND POSTGRESQL, WITH THE
     * SERVER'S CLOCK PINNED to 2026-10-03 10:52 in Hồ Chí Minh — the one `now`
     * a caller may pass, and only tests do.
     */
    describe('★ at 2026-10-03 10:52:43 (Hồ Chí Minh)', () => {
      const now = new Date('2026-10-03T10:52:43+07:00');
      const book = (entry: { scheduledOn?: string; pickupAt?: Date }) =>
        fx.trips.create({ ...entry, entryMode: 'operational', createdBy: fx.author }, now);

      it.each([
        ['yesterday', { scheduledOn: '2026-10-02' }, { scheduledOn: 'PAST_DAY' }],
        ['today with no pickup time', { scheduledOn: '2026-10-03' }, { pickupAt: 'TIME_REQUIRED' }],
        ['today 09:00', { pickupAt: at('2026-10-03', '09:00') }, { pickupAt: 'PAST_INSTANT' }],
        ['today 10:51', { pickupAt: at('2026-10-03', '10:51') }, { pickupAt: 'PAST_INSTANT' }],
      ])('refuses %s with the usual 422 shape, and stores nothing', async (_case, entry, details) => {
        await expect(book(entry)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details });
        expect(await storedTrips()).toBe(0);
      });

      it('★ takes today 10:52 and 11:00, tomorrow with and without an hour — each pending on its own day', async () => {
        const booked = [
          await book({ pickupAt: at('2026-10-03', '10:52') }),
          await book({ pickupAt: at('2026-10-03', '11:00') }),
          await book({ scheduledOn: '2026-10-04' }),
          await book({ pickupAt: at('2026-10-04', '08:00') }),
        ];

        expect(booked.map((trip) => [trip.scheduledOn, trip.pickupAt?.toISOString() ?? null, trip.status])).toEqual([
          ['2026-10-03', at('2026-10-03', '10:52').toISOString(), 'pending'],
          ['2026-10-03', at('2026-10-03', '11:00').toISOString(), 'pending'],
          ['2026-10-04', null, 'pending'],
          ['2026-10-04', at('2026-10-04', '08:00').toISOString(), 'pending'],
        ]);
        expect(await storedTrips()).toBe(4);
      });

      it('leaves the historical intent alone — today with no hour, and 09:00, are runs that happened', async () => {
        const record = (entry: { scheduledOn?: string; pickupAt?: Date }) =>
          fx.trips.create({ ...entry, entryMode: 'historical', createdBy: fx.author }, now);

        expect((await record({ scheduledOn: '2026-10-03' })).status).toBe('finished');
        expect((await record({ pickupAt: at('2026-10-03', '09:00') })).status).toBe('finished');
      });
    });

    it('★ a booking whose pickup hour has since passed is still corrected — the rule is the create’s', async () => {
      // Booked properly on 1/9 for 11:00 that day; long past by any real clock.
      const booked = await fx.trips.create(
        { pickupAt: at('2026-09-01', '11:00'), entryMode: 'operational', createdBy: fx.author },
        new Date('2026-09-01T10:52:43+07:00'),
      );

      const corrected = await fx.trips.update(
        booked.id,
        { note: 'giờ thực tế', sellPrice: '2500000', pickupAt: at('2026-09-01', '10:30') },
        fx.author,
      );
      expect(corrected).toMatchObject({ note: 'giờ thực tế', scheduledOn: '2026-09-01', status: 'pending' });
      expect(corrected.pickupAt?.toISOString()).toBe(at('2026-09-01', '10:30').toISOString());
    });

    it('★ books a DATE with no hour yet — the day is kept, no instant is invented', async () => {
      const created = await fx.trips.create({ scheduledOn: day(3), entryMode: 'operational', createdBy: fx.author });

      expect(created.scheduledOn).toBe(day(3));
      expect(created.pickupAt).toBeNull();
      expect(created.deliveryAt).toBeNull();
    });

    it('★ lets a record with no times be corrected — note, price — without asking for them', async () => {
      const legacy = await addTrip(fx, day(-3));

      await expect(
        fx.trips.update(legacy, { note: 'đã đối chiếu', sellPrice: '2500000' }, fx.author),
      ).resolves.toMatchObject({ note: 'đã đối chiếu', pickupAt: null, scheduledOn: day(-3) });
    });
  });

  describe('★ one create, the server decides the lifecycle — no bypass', () => {
    it('opens a booking pending, with the usual first history row', async () => {
      const booked = await fx.trips.create({ scheduledOn: day(2), entryMode: 'operational', createdBy: fx.author });

      expect(booked.status).toBe('pending');
      const { rows } = await fx.pool.query<{ from_status: string | null; to_status: string; reason: string | null }>(
        `SELECT from_status, to_status, reason FROM trip_status_history WHERE trip_id = $1`,
        [booked.id],
      );
      expect(rows).toEqual([{ from_status: null, to_status: 'pending', reason: null }]);
    });

    it('★ refuses `finished` asked of a booking — the 409 the board gives', async () => {
      await expect(
        fx.trips.create({ scheduledOn: day(2), status: 'finished', entryMode: 'operational', createdBy: fx.author }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await storedTrips()).toBe(0);
    });

    it('★ refuses any status named on a historical entry — finished is the server’s to set', async () => {
      await expect(
        fx.trips.create({ scheduledOn: day(-2), status: 'pending', entryMode: 'historical', createdBy: fx.author }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { status: 'STATUS_SET_BY_ENTRY' } });
      expect(await storedTrips()).toBe(0);
    });

    it('refuses a crew on a booking — dispatch crews it once it exists', async () => {
      const crew = [{ vehicleId: '00000000-0000-4000-8000-000000000001', driverUserId: fx.driver }];
      await expect(
        fx.trips.create({ scheduledOn: day(2), crew, entryMode: 'operational', createdBy: fx.author }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { crew: 'CREW_AFTER_BOOKING' } });
      expect(await storedTrips()).toBe(0);
    });
  });

  describe('★ "Nhập chuyến cũ" — a run recorded after it ended', () => {
    const lastWeek = { pickupAt: at(day(-7), '17:36'), deliveryAt: at(day(-6), '16:36') };

    const historyRows = async (trip: string) =>
      (
        await fx.pool.query<{ from_status: string | null; to_status: string; reason: string | null }>(
          `SELECT from_status, to_status, reason FROM trip_status_history WHERE trip_id = $1`,
          [trip],
        )
      ).rows;

    const lorry = async (plate: string): Promise<string> =>
      (
        await fx.pool.query<{ id: string }>(
          `INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`,
          [plate, fx.author],
        )
      ).rows[0]!.id;

    it('★ is born finished — created NOW, dated when it ran — and is in History at once, never on Lịch xe', async () => {
      const before = Date.now();
      const recorded = await fx.trips.create({ entryMode: 'historical',  ...lastWeek, createdBy: fx.author });

      expect(recorded.status).toBe('finished');
      expect(recorded.scheduledOn).toBe(day(-7));
      expect(recorded.pickupAt?.toISOString()).toBe(lastWeek.pickupAt.toISOString());
      expect(recorded.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
      expect(await idsIn('history')).toEqual([recorded.id]);
      expect(await idsIn('operational')).toEqual([]);

      const { rows } = await fx.pool.query<{ closed_by: string; closed_at: Date }>(
        `SELECT closed_by, closed_at FROM trip_schedules WHERE id = $1`,
        [recorded.id],
      );
      expect(rows[0]!.closed_by).toBe(fx.author);
      expect(rows[0]!.closed_at.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    });

    it('★ says how it got there in the audit — ONE row, null → finished, marked historical_entry', async () => {
      const recorded = await fx.trips.create({ entryMode: 'historical',  ...lastWeek, createdBy: fx.author });

      expect(await historyRows(recorded.id)).toEqual([
        { from_status: null, to_status: 'finished', reason: 'historical_entry' },
      ]);
    });

    it('exists with no crew at all — finishing never waited on an assignment', async () => {
      const recorded = await fx.trips.create({ entryMode: 'historical',  scheduledOn: day(-2), createdBy: fx.author });

      expect(recorded.status).toBe('finished');
      expect(recorded.pickupAt).toBeNull();
    });

    it('★ keeps its crew on record, one row per trip, and leaves NO active turn behind', async () => {
      const crew = [
        { vehicleId: await lorry('50H-40001'), driverUserId: fx.driver },
        { vehicleId: await lorry('50H-40002'), driverUserId: fx.driver },
      ];
      const recorded = await fx.trips.create({ entryMode: 'historical',  ...lastWeek, crew, createdBy: fx.author });

      const turns = await fx.pool.query<{ state: string; end_reason: string }>(
        `SELECT state, end_reason FROM trip_driver_assignments WHERE trip_id = $1`,
        [recorded.id],
      );
      expect(turns.rows).toEqual([
        { state: 'ended', end_reason: 'historical_entry' },
        { state: 'ended', end_reason: 'historical_entry' },
      ]);
      // No execution was invented: no event, no completion request.
      const invented = await fx.pool.query<{ n: string }>(
        `SELECT (SELECT count(*) FROM trip_execution_events WHERE trip_id = $1)
              + (SELECT count(*) FROM trip_completion_requests WHERE trip_id = $1) AS n`,
        [recorded.id],
      );
      expect(Number(invented.rows[0]!.n)).toBe(0);

      const page = await fx.board.page(boardQuery({ from: day(-40), to: day(40), lifecycle: 'history' }), true);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.assignments.map((turn) => turn.vehicle?.plate).sort()).toEqual([
        '50H-40001',
        '50H-40002',
      ]);
      expect(page.items[0]!.costSummary).toMatchObject({ total: '0.00', itemCount: 0 });
    });

    it('★ reads its crew back in EXACTLY the order it was entered — twelve pairs, every read, never by id', async () => {
      const driverOf: Record<string, string> = { A: fx.driver };
      for (const name of ['B', 'C']) {
        driverOf[name] = (
          await fx.pool.query<{ id: string }>(
            `INSERT INTO users (display_name, account_type) VALUES ($1, 'driver') RETURNING id`,
            [`Tài Xế ${name}`],
          )
        ).rows[0]!.id;
      }
      // B/B → A/A → C/C first, then a shuffle: neither plate order, driver
      // order nor its reverse explains it. A random-id order would match 1 in 12!.
      const entered = [
        ['51B-00002', 'B'], ['51A-00001', 'A'], ['51C-00003', 'C'], ['51L-00012', 'A'],
        ['51D-00004', 'B'], ['51K-00011', 'C'], ['51E-00005', 'A'], ['51J-00010', 'B'],
        ['51F-00006', 'C'], ['51I-00009', 'A'], ['51G-00007', 'B'], ['51H-00008', 'C'],
      ] as const;
      const crew = [];
      for (const [plate, driver] of entered) crew.push({ vehicleId: await lorry(plate), driverUserId: driverOf[driver]! });
      const recorded = await fx.trips.create({ entryMode: 'historical', ...lastWeek, crew, createdBy: fx.author });

      const read = async () =>
        (await fx.board.page(boardQuery({ from: day(-40), to: day(40), lifecycle: 'history' }), true)).items[0]!.assignments.map(
          (turn) => `${turn.vehicle?.plate}/${turn.driver.displayName}`,
        );
      const expected = entered.map(([plate, driver]) => `${plate}/Tài Xế ${driver}`);
      expect(await read()).toEqual(expected);
      expect(await read()).toEqual(expected);

      // The mechanism, stored: the trip's instant plus exactly 0…11 µs, in entry order.
      const { rows } = await fx.pool.query<{ plate: string; offset_us: number }>(
        `SELECT v.plate,
                round(extract(epoch FROM a.assigned_at - min(a.assigned_at) OVER ()) * 1000000)::int AS offset_us
           FROM trip_driver_assignments a JOIN trip_vehicles v ON v.id = a.vehicle_id
          WHERE a.trip_id = $1
          ORDER BY a.assigned_at, a.id`,
        [recorded.id],
      );
      expect(rows.map((row) => row.plate)).toEqual(entered.map(([plate]) => plate));
      expect(rows.map((row) => row.offset_us)).toEqual(entered.map((_, index) => index));
    });

    it('refuses the same lorry twice, or a non-driver on it — and writes nothing', async () => {
      const once = await lorry('51D-77777');
      const twice = [once, once].map((vehicleId) => ({ vehicleId, driverUserId: fx.driver }));

      await expect(
        fx.trips.create({ entryMode: 'historical',  ...lastWeek, crew: twice, createdBy: fx.author }),
      ).rejects.toMatchObject({ details: { crew: 'DUPLICATE_VEHICLE' } });
      await expect(
        fx.trips.create({ entryMode: 'historical',  ...lastWeek, crew: [{ vehicleId: once, driverUserId: fx.author }], createdBy: fx.author }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await storedTrips()).toBe(0);
    });

    it('★ holds the timeline a booking holds, and refuses a run dated after today', async () => {
      await expect(
        fx.trips.create({ entryMode: 'historical',  pickupAt: at(day(-7), '17:36'), deliveryAt: at(day(-7), '16:36'), createdBy: fx.author }),
      ).rejects.toMatchObject({ details: { deliveryAt: 'NOT_AFTER_PICKUP' } });
      await expect(
        fx.trips.create({ entryMode: 'historical',  scheduledOn: day(1), createdBy: fx.author }),
      ).rejects.toMatchObject({ details: { scheduledOn: 'FUTURE_DAY' } });
      expect(await storedTrips()).toBe(0);
    });

    it('★ refuses an exact time later than NOW — a recorded run has ended', async () => {
      // Picked up yesterday, "delivered" an hour from now: the delivery is refused.
      await expect(
        fx.trips.create({ entryMode: 'historical',
          pickupAt: at(day(-1), '10:00'),
          deliveryAt: new Date(Date.now() + 3_600_000),
          createdBy: fx.author,
        }),
      ).rejects.toMatchObject({ details: { deliveryAt: 'FUTURE_INSTANT' } });

      // A pickup a minute from now: its hour is refused — or, a minute before
      // midnight, its day. Either way nothing is recorded.
      const soon = new Date(Date.now() + 60_000);
      const refusal = businessToday(soon) === day(0) ? { pickupAt: 'FUTURE_INSTANT' } : { scheduledOn: 'FUTURE_DAY' };
      await expect(fx.trips.create({ entryMode: 'historical',  pickupAt: soon, createdBy: fx.author })).rejects.toMatchObject({
        details: refusal,
      });
      expect(await storedTrips()).toBe(0);
    });

    it('★ records exact times already past — today’s included — and none at all', async () => {
      const recorded = await fx.trips.create({ entryMode: 'historical',
        pickupAt: new Date(Date.now() - 2 * 3_600_000),
        deliveryAt: new Date(Date.now() - 3_600_000),
        createdBy: fx.author,
      });
      const hourless = await fx.trips.create({ entryMode: 'historical',  scheduledOn: day(0), createdBy: fx.author });

      expect([recorded.status, hourless.status]).toEqual(['finished', 'finished']);
      expect(hourless.pickupAt).toBeNull();
    });

    it('★ takes its costs afterwards through the ledger’s own backoffice path — all six heads', async () => {
      // `cost.create` (SUPERADMIN) — the same route the "Chi phí chuyến" dialog
      // calls. It reads no status: a figure arriving after closure is ordinary.
      const db = poolAsDatabase(fx.pool);
      const costs = new TripCostService(
        db,
        new TripScheduleRepository(db),
        new TripCostRepository(db),
        new OutsourceHireRepository(db),
        new TripCostTotalsRepository(db),
        new DriverAssignmentRepository(db),
        new TripVehicleRepository(db),
        new CompletionRequestRepository(db),
      );
      const recorded = await fx.trips.create({ entryMode: 'historical',  ...lastWeek, createdBy: fx.author });

      const heads = ['fuel', 'toll', 'warehouse', 'loading', 'overtime'] as const;
      for (const category of heads) {
        await costs.createCost({ tripId: recorded.id, category, amount: '100000', createdBy: fx.author });
      }
      await costs.createHire({ tripId: recorded.id, carrierName: 'Hai Thành', agreedAmount: '3000000', createdBy: fx.author });

      const page = await fx.board.page(boardQuery({ from: day(-40), to: day(40), lifecycle: 'history' }), true);
      expect(page.items[0]!.costSummary).toEqual({
        total: '3500000.00',
        itemCount: 6,
        hires: '3000000.00',
        byCategory: { fuel: '100000.00', toll: '100000.00', warehouse: '100000.00', loading: '100000.00', overtime: '100000.00' },
      });
      expect(page.items[0]!.status).toBe('finished');
    });

    it('stays correctable afterwards — a price added by accounting — and stays finished', async () => {
      const recorded = await fx.trips.create({ entryMode: 'historical',  ...lastWeek, createdBy: fx.author });

      await expect(
        fx.trips.update(recorded.id, { sellPrice: '3200000' }, fx.author),
      ).resolves.toMatchObject({ status: 'finished', sellPrice: '3200000.00' });
    });
  });
});
