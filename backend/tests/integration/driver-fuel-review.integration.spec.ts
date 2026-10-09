import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  TEST_URL,
  applyAllMigrations,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { fuelSubmissionWriter, fuelWriter } from '../helpers/fuel-wiring';
import { UserRepository } from '@core/users/persistence/user.repository';
import { FilesystemObjectStorage } from '@infrastructure/object-storage/filesystem-object-storage';
import { businessToday } from '@common/pagination/date-range-page-query.dto';
import { DriverFuelService } from '../../src/capabilities/trip-schedule/application/driver-fuel.service';
import { FuelEvidenceService } from '../../src/capabilities/trip-schedule/application/fuel-evidence.service';
import { FuelMatchService } from '../../src/capabilities/trip-schedule/application/fuel-match.service';
import { FuelReviewService } from '../../src/capabilities/trip-schedule/application/fuel-review.service';
import { FuelTransactionService } from '../../src/capabilities/trip-schedule/application/fuel-transaction.service';
import { VehicleFuelService } from '../../src/capabilities/trip-schedule/application/vehicle-fuel.service';
import type { DriverReceipt } from '../../src/capabilities/trip-schedule/application/fuel-submission-writer';
import { FuelEvidenceRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-evidence.repository';
import { FuelMatchRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-match.repository';
import { FuelReviewRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-review.repository';
import { FuelTransactionRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction.repository';
import { FuelTransactionViewRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction-view.repository';
import { FleetOperationsRepository } from '../../src/capabilities/trip-schedule/persistence/fleet-operations.repository';
import { TripVehicleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { DriverAssignmentRepository } from '../../src/capabilities/trip-schedule/persistence/trip-execution.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { VehicleCostRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-cost.repository';
import { VehicleDailyFuelCheckRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-fuel-check.repository';

/**
 * ★ DRIVER-FIRST FUEL (0038) against a REAL PostgreSQL. A driver records the
 * fill they just bought on the lorry they are running — the money row, its
 * fuel transaction, their photos and its first review step land together or
 * not at all — and Accounting checks it, asks, refuses, approves and marks it
 * paid. Fixtures by SQL; behaviour through the services the routes call.
 */
const SCHEMA = 'driver_fuel_review_itest';

describeIntegration('Driver fuel submission and Accounting review against real PostgreSQL', () => {
  jest.setTimeout(60_000);

  let pool: Pool;
  let root: string;
  let fuel: VehicleFuelService;
  let mine: DriverFuelService;
  let review: FuelReviewService;
  let evidence: FuelEvidenceService;
  let ledger: VehicleCostRepository;
  let office: string;
  let accountant: string;
  let driverA: string;
  let driverB: string;
  const today = () => businessToday(new Date());

  const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];
  const one = async <T>(text: string, params: unknown[] = []) => (await sql<T>(text, params))[0] as T;
  const count = async (table: string, where = 'true', params: unknown[] = []) =>
    (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params)).n;
  const refusal = (work: () => Promise<unknown>) =>
    work().then(
      () => undefined,
      (error: { code?: string; details?: Record<string, string> }) => ({ code: error.code, details: error.details }),
    );
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(48)]);
  const stage = async (by: string, bytes = jpeg()) => (await evidence.stage({ buffer: bytes, originalname: 'IMG.JPG' }, by)).id;

  // ------------------------------------------------------------ fixtures ----
  let plates = 0;
  const flaggedLorry = async () =>
    (await one<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by, daily_fuel_check_required) VALUES ($1, $2, true) RETURNING id`,
      [`51F-${String(88000 + ++plates).padStart(5, '0').replace(/(\d{3})(\d{2})$/, '$1.$2')}`, office],
    )).id;
  /** A turn on a trip run TODAY — the driver's real, live context for that lorry. */
  const todaysTurn = async (vehicleId: string, driver: string) => {
    const tripId = (await one<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ($1, $2) RETURNING id`,
      [today(), office],
    )).id;
    return (await one<{ id: string }>(
      `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tripId, vehicleId, driver, office],
    )).id;
  };
  const fill = (amount = '772460', liters: string | null = '26') => ({ amount, liters, odometerKm: 182345, note: null });
  const receipt = (images: string[] = [], facts: DriverReceipt['facts'] = {}): DriverReceipt => ({
    facts,
    evidence: images.map((id) => ({ id, type: 'receipt' as const })),
  });
  let keys = 0;
  /** A fill as the phone sends it: by default with one fresh photo of the driver's own. */
  const record = async (turn: string, driver: string, over: { amount?: string; receipt?: DriverReceipt; key?: string } = {}) =>
    fuel.recordFill({
      assignmentId: turn,
      fill: fill(over.amount),
      clientRequestId: over.key ?? `fill-${++keys}`,
      recordedBy: driver,
      receipt: over.receipt ?? receipt([await stage(driver)]),
    });
  const fillOf = async (costId: string) =>
    one<{ id: string; driver_user_id: string; vehicle_cost_id: string }>(
      `SELECT id, driver_user_id, vehicle_cost_id FROM fuel_transactions WHERE vehicle_cost_id = $1`,
      [costId],
    );
  const statusOf = async (fuelTransactionId: string) =>
    (await review.detail(fuelTransactionId)).status;

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    const database = poolAsDatabase(pool);
    root = await mkdtemp(join(tmpdir(), 'driver-fuel-itest-'));
    const images = new FuelEvidenceRepository(database);
    const transactions = new FuelTransactionRepository();
    const reviews = new FuelReviewRepository(database);
    const writer = fuelWriter(database);
    evidence = new FuelEvidenceService(new FilesystemObjectStorage(root), images);
    fuel = new VehicleFuelService(
      database,
      new TripScheduleRepository(database),
      new DriverAssignmentRepository(database),
      new TripVehicleRepository(database),
      new VehicleDailyFuelCheckRepository(database),
      (ledger = new VehicleCostRepository(database)),
      new FleetOperationsRepository(database),
      fuelSubmissionWriter(database),
    );
    mine = new DriverFuelService(database, reviews, transactions, writer, images);
    const fills = new FuelTransactionService(database, transactions, new FuelTransactionViewRepository(database), images, writer);
    review = new FuelReviewService(
      database, reviews, transactions, fills, new FuelMatchService(database, new FuelMatchRepository(database), transactions), ledger,
    );
    const users = new UserRepository(database);
    office = (await users.insertUser({ displayName: 'Điều Độ' })).id;
    accountant = (await users.insertUser({ displayName: 'Kế Toán' })).id;
    driverA = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
    driverB = (await users.insertUser({ displayName: 'Tài Xế B', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await pool?.end();
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE fuel_review_events, fuel_match_acks, fuel_transaction_enrichments, fuel_transaction_evidence, fuel_transactions,
                vehicle_daily_fuel_checks, vehicle_costs, trip_driver_assignments, trip_schedules, trip_vehicles
                RESTART IDENTITY CASCADE`,
    );
  });

  describe('★ the driver records a fill — one cost, one fuel transaction, its photos, submitted', () => {
    it('1 · Driver A running lorry X: cost + fuel transaction + evidence + SUBMITTED, all at once', async () => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driverA);
      const [pump, qr] = [await stage(driverA), await stage(driverA)];
      const recorded = await fuel.recordFill({
        assignmentId: turn,
        fill: fill(),
        clientRequestId: 'k1',
        recordedBy: driverA,
        receipt: {
          facts: { vendorName: 'Petrolimex CH 12', vendorTaxCode: '0100109106', documentNumber: '0004567' },
          evidence: [{ id: pump, type: 'pump_meter' }, { id: qr, type: 'payment_qr' }],
        },
      });
      const ft = await fillOf(recorded.id);
      expect(ft.driver_user_id).toBe(driverA);
      expect(await sql(`SELECT evidence_type FROM fuel_transaction_evidence WHERE fuel_transaction_id = $1 ORDER BY evidence_type`, [ft.id]))
        .toEqual([{ evidence_type: 'payment_qr' }, { evidence_type: 'pump_meter' }]);
      expect(await sql(`SELECT seq, status, actor FROM fuel_review_events WHERE fuel_transaction_id = $1`, [ft.id]))
        .toEqual([{ seq: 1, status: 'submitted', actor: driverA }]);
      const [listed] = await mine.mine(driverA, {});
      expect(listed).toMatchObject({
        fuelTransactionId: ft.id, status: 'submitted', amount: '772460.00', liters: '26.00', evidenceCount: 2,
        vendor: { name: 'Petrolimex CH 12', taxCode: '0100109106' }, document: { series: null, number: '0004567' },
      });
      expect(listed).not.toHaveProperty('costId');
    });

    it('1b · the start-of-shift declaration with fuel is submitted the same way', async () => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driverA);
      const check = await fuel.declare({
        assignmentId: turn,
        declaration: { outcome: 'fuel_added', ...fill() },
        clientRequestId: 'start',
        declaredBy: driverA,
        receipt: receipt([await stage(driverA)]),
      });
      const ft = await fillOf(check.vehicleCostId as string);
      expect(await statusOf(ft.id)).toBe('submitted');
      // "No fuel at the start of the shift" has no money and nothing to review.
      const other = await flaggedLorry();
      await fuel.declare({ assignmentId: await todaysTurn(other, driverA), declaration: { outcome: 'no_fuel' }, clientRequestId: 'nf', declaredBy: driverA });
      expect(await count('fuel_review_events')).toBe(1);
    });

    it('2 · ★ a second legitimate fill the same day: a second cost and fuel transaction — never merged, only flagged', async () => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driverA);
      const first = await record(turn, driverA);
      const second = await record(turn, driverA);
      expect(first.id).not.toBe(second.id);
      expect(await count('fuel_transactions')).toBe(2);
      expect(await count('fuel_review_events', `status = 'submitted'`)).toBe(2);
      // Same lorry, day and amount: a warning for Accounting — not a refusal, not a merge.
      const detail = await review.detail((await fillOf(second.id)).id);
      expect(detail.warnings.map((w) => [w.backing.costId, w.level])).toEqual([[first.id, 'possible']]);
    });

    it('3 · Driver B later running the same lorry records their own fill', async () => {
      const lorry = await flaggedLorry();
      await record(await todaysTurn(lorry, driverA), driverA);
      const theirs = await record(await todaysTurn(lorry, driverB), driverB);
      expect((await fillOf(theirs.id)).driver_user_id).toBe(driverB);
      expect((await mine.mine(driverB, {})).map((s) => s.fuelTransactionId)).toEqual([(await fillOf(theirs.id)).id]);
    });

    it('4 · ★ a driver cannot record on a turn that is not theirs, or not today’s work — the lorry is never the body’s', async () => {
      const lorry = await flaggedLorry();
      const aTurn = await todaysTurn(lorry, driverA);
      expect((await refusal(() => record(aTurn, driverB)))?.code).toBe('FORBIDDEN');
      const tripTomorrow = (await one<{ id: string }>(
        `INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ($1::date + 2, $2) RETURNING id`,
        [today(), office],
      )).id;
      const later = (await one<{ id: string }>(
        `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tripTomorrow, lorry, driverA, office],
      )).id;
      expect((await refusal(() => record(later, driverA)))?.details).toEqual({ fuelTransaction: 'NOT_OPERATED_TODAY' });
      expect([await count('vehicle_costs'), await count('fuel_transactions'), await count('fuel_review_events')]).toEqual([0, 0, 0]);
    });

    it('5 · ★ a retry of the same request is one cost, one fuel transaction, one submission', async () => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driverA);
      const image = await stage(driverA);
      const [a, b] = await Promise.all([
        record(turn, driverA, { key: 'same', receipt: receipt([image]) }),
        record(turn, driverA, { key: 'same', receipt: receipt([image]) }),
      ]);
      const c = await record(turn, driverA, { key: 'same', receipt: receipt([image]) });
      expect(new Set([a.id, b.id, c.id]).size).toBe(1);
      expect([await count('vehicle_costs'), await count('fuel_transactions'), await count('fuel_review_events')]).toEqual([1, 1, 1]);
    });

    it('6 · the same photo sent again is the same staged image, and attaches once', async () => {
      const lorry = await flaggedLorry();
      const bytes = jpeg();
      const first = await stage(driverA, bytes);
      expect(await stage(driverA, bytes)).toBe(first);
      await record(await todaysTurn(lorry, driverA), driverA, { receipt: receipt([first]) });
      expect(await count('fuel_transaction_evidence')).toBe(1);
    });

    it('7 · ★ the same receipt photo or invoice on ANOTHER fill refuses the new fill — nothing is written', async () => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driverA);
      const bytes = jpeg();
      await record(turn, driverA, { receipt: receipt([await stage(driverA, bytes)], { vendorTaxCode: '0100109106', documentNumber: '0001' }) });
      const before = [await count('vehicle_costs'), await count('fuel_transactions'), await count('fuel_review_events')];
      const again = await stage(driverA, bytes);
      expect((await refusal(() => record(turn, driverA, { receipt: receipt([again]) })))?.details).toEqual({ evidence: 'ON_ANOTHER_FILL' });
      const fresh = await stage(driverA);
      expect((await refusal(() => record(turn, driverA, { receipt: receipt([fresh], { vendorTaxCode: '0100109106', documentNumber: '0001' }) })))?.details)
        .toEqual({ documentNumber: 'ON_ANOTHER_FILL' });
      expect([await count('vehicle_costs'), await count('fuel_transactions'), await count('fuel_review_events')]).toEqual(before);
    });

    it('14 · ★ the app dies after the upload: the driver gets every waiting photo back and is never locked out', async () => {
      const lost = [await stage(driverA), await stage(driverA)];
      // No discard, no fill: the phone is gone. A new session asks the server.
      expect(new Set((await evidence.staged(driverA)).map((image) => image.id))).toEqual(new Set(lost));
      expect(await evidence.staged(driverB)).toEqual([]);
      const lorry = await flaggedLorry();
      await record(await todaysTurn(lorry, driverA), driverA, { receipt: receipt([lost[0] as string]) });
      await evidence.discard(lost[1] as string, driverA);
      expect(await evidence.staged(driverA)).toEqual([]);
    });

    it('15 · ★ a stale second start-of-shift declaration with money is refused as NOT recorded — never a false “saved”', async () => {
      const lorry = await flaggedLorry();
      await fuel.declare({
        assignmentId: await todaysTurn(lorry, driverA), declaration: { outcome: 'fuel_added', ...fill() }, clientRequestId: 'a', declaredBy: driverA,
        receipt: receipt([await stage(driverA)]),
      });
      const turnB = await todaysTurn(lorry, driverB);
      const photoB = await stage(driverB);
      const stale = await refusal(() =>
        fuel.declare({
          assignmentId: turnB, declaration: { outcome: 'fuel_added', ...fill('500000') }, clientRequestId: 'b', declaredBy: driverB,
          receipt: receipt([photoB]),
        }),
      );
      expect(stale?.details).toEqual({ dailyFuelCheck: 'CHECK_ALREADY_ANSWERED' });
      expect([await count('vehicle_costs'), await count('fuel_review_events')]).toEqual([1, 1]);
    });
  });

  describe('★ Accounting checks it — each decision one audited step', () => {
    const submitted = async (driver = driverA, rcpt?: DriverReceipt) => {
      const lorry = await flaggedLorry();
      const cost = await record(await todaysTurn(lorry, driver), driver, { receipt: rcpt });
      return (await fillOf(cost.id)).id;
    };
    const steps = (id: string) =>
      sql<{ seq: number; status: string; note: string | null; actor: string }>(
        `SELECT seq, status, note, actor FROM fuel_review_events WHERE fuel_transaction_id = $1 ORDER BY seq`,
        [id],
      );

    it('8 · ★ APPROVE is a step with its actor and time', async () => {
      const id = await submitted();
      const decided = await review.act(id, 'approve', undefined, accountant);
      expect(decided.status).toBe('approved');
      const [, approved] = decided.history;
      expect(approved).toMatchObject({ status: 'approved', actor: { id: accountant, displayName: 'Kế Toán' } });
      expect(approved?.at).toBeInstanceOf(Date);
      expect(decided.fill).toMatchObject({ amount: '772460.00', backing: { ledger: 'vehicle' } });
    });

    it('9 · ★ NEEDS_INFO keeps its reason; the driver sees it, adds what was missing — never over a fact — and resubmits', async () => {
      const pump = await stage(driverA);
      const id = await submitted(driverA, receipt([pump], { vendorName: 'Cây xăng Phú Lâm' }));
      expect((await refusal(() => review.act(id, 'request-info', '  ', accountant)))?.details).toEqual({ note: 'REASON_REQUIRED' });
      await review.act(id, 'request-info', 'Thiếu ảnh hoá đơn', accountant);

      const asked = await mine.detail(driverA, id);
      expect(asked).toMatchObject({ status: 'needs_info', statusNote: 'Thiếu ảnh hoá đơn' });
      expect((await mine.mine(driverA, { statuses: ['needs_info'] })).map((s) => s.fuelTransactionId)).toEqual([id]);

      // A recorded fact is never overwritten — the station stays as typed.
      expect((await refusal(() => mine.resubmit(driverA, id, receipt([], { vendorName: 'Khác' }))))?.details)
        .toEqual({ vendorName: 'FACT_ALREADY_SET' });
      const invoice = await stage(driverA);
      const answered = await mine.resubmit(driverA, id, { ...receipt([invoice], { documentNumber: '0007' }), note: 'Đã bổ sung' });
      expect(answered).toMatchObject({ status: 'submitted', document: { series: null, number: '0007' } });
      expect(new Set(answered.evidence.map((image) => image.id))).toEqual(new Set([pump, invoice]));
      expect((await steps(id)).map((s) => [s.status, s.note])).toEqual([
        ['submitted', null], ['needs_info', 'Thiếu ảnh hoá đơn'], ['submitted', 'Đã bổ sung'],
      ]);
      // Not asked any more: a second resubmit is refused.
      expect((await refusal(() => mine.resubmit(driverA, id, receipt())))?.code).toBe('CONFLICT');
    });

    it('10 · ★ REJECTED is final: the driver cannot touch it again, nor can it be approved or paid', async () => {
      const id = await submitted();
      expect((await refusal(() => review.act(id, 'reject', undefined, accountant)))?.details).toEqual({ note: 'REASON_REQUIRED' });
      await review.act(id, 'reject', 'Trùng lần đổ khác', accountant);
      const late = await stage(driverA);
      expect((await refusal(() => mine.resubmit(driverA, id, receipt([late]))))?.code).toBe('CONFLICT');
      expect((await refusal(() => review.act(id, 'approve', undefined, accountant)))?.code).toBe('CONFLICT');
      expect((await refusal(() => review.act(id, 'mark-paid', undefined, accountant)))?.code).toBe('CONFLICT');
      expect(await count('fuel_transaction_evidence', 'fuel_transaction_id = $1', [id])).toBe(1);
    });

    it('11 · ★ APPROVED then PAID — two steps; paying again is the payment already recorded; never SUBMITTED → PAID', async () => {
      const id = await submitted();
      expect((await refusal(() => review.act(id, 'mark-paid', 'CK 123', accountant)))?.code).toBe('CONFLICT');
      await review.act(id, 'approve', undefined, accountant);
      const paid = await review.act(id, 'mark-paid', 'CK VCB 4589', accountant);
      expect(paid.status).toBe('paid');
      await review.act(id, 'mark-paid', 'again', accountant);
      expect((await steps(id)).map((s) => [s.status, s.note, s.actor])).toEqual([
        ['submitted', null, driverA], ['approved', null, accountant], ['paid', 'CK VCB 4589', accountant],
      ]);
      expect((await refusal(() => review.act(id, 'request-info', 'late', accountant)))?.code).toBe('CONFLICT');
    });

    it('12 · the database holds the machine on its own: no skipped step, no fork, no driver posing as another, no edit', async () => {
      const id = await submitted();
      const insert = (seq: number, status: string, actor: string, note: string | null = null) =>
        pool.query(`INSERT INTO fuel_review_events (fuel_transaction_id, seq, status, note, actor) VALUES ($1, $2, $3, $4, $5)`, [id, seq, status, note, actor]);
      const codeOf = (work: () => Promise<unknown>) => work().then(() => undefined, (error: { code?: string }) => error.code);
      expect(await codeOf(() => insert(2, 'paid', accountant))).toBe('23001');
      expect(await codeOf(() => insert(3, 'approved', accountant))).toBe('23001');
      expect(await codeOf(() => insert(2, 'rejected', accountant))).toBe('23514');
      await insert(2, 'needs_info', accountant, 'why');
      expect(await codeOf(() => insert(3, 'submitted', driverB))).toBe('23001'); // not the fill's own driver
      expect(await codeOf(() => insert(2, 'approved', accountant))).toBe('23001'); // not the next step
      // Two writers racing the same next step, neither seeing the other: the unique step stops the second.
      const held = await pool.connect();
      await held.query('BEGIN');
      await held.query(`INSERT INTO fuel_review_events (fuel_transaction_id, seq, status, actor) VALUES ($1, 3, 'submitted', $2)`, [id, driverA]);
      const racing = codeOf(() => insert(3, 'rejected', accountant, 'no'));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await held.query('COMMIT');
      held.release();
      expect(await racing).toBe('23505');
      expect(await codeOf(() => pool.query(`UPDATE fuel_review_events SET note = 'x' WHERE fuel_transaction_id = $1`, [id]))).toBe('23001');
      expect(await codeOf(() => pool.query(`DELETE FROM fuel_review_events WHERE fuel_transaction_id = $1`, [id]))).toBe('23001');
    });

    it('13 · ★ a driver reads only their own fills and photos', async () => {
      const image = await stage(driverA);
      const id = await submitted(driverA, receipt([image]));
      expect((await refusal(() => mine.detail(driverB, id)))?.code).toBe('NOT_FOUND');
      expect((await refusal(() => mine.resubmit(driverB, id, receipt())))?.code).toBe('NOT_FOUND');
      expect(await mine.mine(driverB, {})).toEqual([]);
      expect((await refusal(() => evidence.contentOfUploader(image, driverB)))?.code).toBe('NOT_FOUND');
      expect((await evidence.contentOfUploader(image, driverA)).mimeType).toBe('image/jpeg');
    });

    it('lists by state for Accounting, newest first, with the figures read from the money row', async () => {
      const [a, b] = [await submitted(), await submitted(driverB)];
      await review.act(a, 'approve', undefined, accountant);
      const waiting = await review.list('submitted', 1, 50);
      expect(waiting).toMatchObject({ total: 1, items: [{ fuelTransactionId: b, status: 'submitted', driver: { id: driverB } }] });
      expect((await review.list('approved', 1, 50)).items.map((item) => item.fuelTransactionId)).toEqual([a]);
      expect((await review.list(undefined, 1, 50)).total).toBe(2);
    });
  });
  describe('★ a refused fill is not money owed — rejecting withdraws its cost in the same transaction', () => {
    const fillOn = async (driver = driverA) => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driver);
      const cost = (await record(turn, driver)).id;
      return { lorry, turn, cost, id: (await fillOf(cost)).id };
    };
    const liveLedger = (lorry: string) => ledger.page(lorry, { from: today(), to: today(), category: null }, 50, 0);
    const voidOf = (costId: string) =>
      one<{ voided: boolean; voided_by: string | null; void_reason: string | null }>(
        `SELECT voided_at IS NOT NULL AS voided, voided_by, void_reason FROM vehicle_costs WHERE id = $1`,
        [costId],
      );
    const stepsOf = (id: string) =>
      sql<{ status: string; note: string | null; actor: string }>(
        `SELECT status, note, actor FROM fuel_review_events WHERE fuel_transaction_id = $1 ORDER BY seq`,
        [id],
      );
    /** The one invariant: the latest step is `rejected` exactly when the money row is withdrawn. */
    const consistent = async (fill: { cost: string; id: string }) => {
      const steps = await stepsOf(fill.id);
      return steps.at(-1)?.status === 'rejected' && steps.filter((step) => step.status === 'rejected').length === 1
        ? (await voidOf(fill.cost)).voided
        : !(await voidOf(fill.cost)).voided && !steps.some((step) => step.status === 'rejected');
    };

    it('R1 · ★ a rejected fill leaves the lorry’s live ledger and its total — the row, its fill, its photo and its review stay', async () => {
      const { lorry, cost, id } = await fillOn();
      expect(await liveLedger(lorry)).toMatchObject({ total: 1, totalAmount: '772460.00' });
      const decided = await review.act(id, 'reject', 'Ảnh không phải bơm của xe này', accountant);
      expect(await liveLedger(lorry)).toMatchObject({ total: 0, totalAmount: '0.00', items: [] });
      // Withdrawn, never deleted: the money row, its fuel transaction, its photo and both steps are all still there.
      expect([
        await count('vehicle_costs', 'id = $1', [cost]),
        await count('fuel_transactions', 'id = $1 AND voided_at IS NULL', [id]),
        await count('fuel_transaction_evidence', 'fuel_transaction_id = $1', [id]),
      ]).toEqual([1, 1, 1]);
      expect((await stepsOf(id)).map((step) => step.status)).toEqual(['submitted', 'rejected']);
      expect(decided).toMatchObject({ status: 'rejected', fill: { amount: '772460.00', backing: { costId: cost, voided: true } } });
      // The same refusal again is the refusal already made: no second step, the void untouched.
      const before = await one<{ voided_at: Date }>(`SELECT voided_at FROM vehicle_costs WHERE id = $1`, [cost]);
      await review.act(id, 'reject', 'lần nữa', accountant);
      expect((await stepsOf(id)).map((step) => step.status)).toEqual(['submitted', 'rejected']);
      expect(await one(`SELECT voided_at, void_reason FROM vehicle_costs WHERE id = $1`, [cost]))
        .toEqual({ voided_at: before.voided_at, void_reason: 'Ảnh không phải bơm của xe này' });
    });

    it('R2 · ★ reject, then the corrected fill — the same photo and invoice — counts ONCE: only the corrected one', async () => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driverA);
      const bytes = jpeg();
      const invoice = { vendorTaxCode: '0100109106', documentNumber: '0004567' };
      const wrong = await record(turn, driverA, { amount: '7724600', receipt: receipt([await stage(driverA, bytes)], invoice) });
      await review.act((await fillOf(wrong.id)).id, 'reject', 'Số tiền thừa một số 0', accountant);
      // The refused fill no longer holds its receipt: the corrected one may carry the very same photo and invoice.
      const corrected = await record(turn, driverA, { amount: '772460', receipt: receipt([await stage(driverA, bytes)], invoice) });
      const page = await liveLedger(lorry);
      expect(page).toMatchObject({ total: 1, totalAmount: '772460.00' });
      expect(page.items.map((item) => item.id)).toEqual([corrected.id]);
      expect(await statusOf((await fillOf(corrected.id)).id)).toBe('submitted');
      expect((await review.detail((await fillOf(corrected.id)).id)).warnings).toEqual([]);
    });

    it('R3 · ★ the reason and the one who refused are on BOTH the review step and the withdrawn cost — from SUBMITTED or NEEDS_INFO', async () => {
      const fresh = await fillOn();
      await review.act(fresh.id, 'reject', '  Không phải xe của công ty  ', accountant);
      const asked = await fillOn(driverB);
      await review.act(asked.id, 'request-info', 'Thiếu ảnh hoá đơn', accountant);
      await review.act(asked.id, 'reject', 'Không bổ sung được hoá đơn', office);
      for (const [fill, reason, by] of [
        [fresh, 'Không phải xe của công ty', accountant],
        [asked, 'Không bổ sung được hoá đơn', office],
      ] as const) {
        expect((await stepsOf(fill.id)).at(-1)).toEqual({ status: 'rejected', note: reason, actor: by });
        expect(await voidOf(fill.cost)).toEqual({ voided: true, voided_by: by, void_reason: reason });
      }
    });

    it('R4 · NEEDS_INFO does not withdraw the cost', async () => {
      const fill = await fillOn();
      await review.act(fill.id, 'request-info', 'Thiếu ảnh hoá đơn', accountant);
      expect(await voidOf(fill.cost)).toEqual({ voided: false, voided_by: null, void_reason: null });
      expect((await liveLedger(fill.lorry)).total).toBe(1);
    });

    it('R5 · APPROVED does not withdraw the cost', async () => {
      const fill = await fillOn();
      await review.act(fill.id, 'approve', undefined, accountant);
      expect(await voidOf(fill.cost)).toEqual({ voided: false, voided_by: null, void_reason: null });
      expect((await liveLedger(fill.lorry)).total).toBe(1);
    });

    it('R6 · PAID does not withdraw the cost', async () => {
      const fill = await fillOn();
      await review.act(fill.id, 'approve', undefined, accountant);
      await review.act(fill.id, 'mark-paid', 'CK VCB 4589', accountant);
      expect(await voidOf(fill.cost)).toEqual({ voided: false, voided_by: null, void_reason: null });
      expect((await liveLedger(fill.lorry)).total).toBe(1);
    });

    it('R7 · ★ racing decisions and retries never leave “rejected but counted” or “withdrawn but not rejected”', async () => {
      // Two refusals at once: one step, one void — the second is the refusal already made.
      const twice = await fillOn();
      const both = await Promise.allSettled([
        review.act(twice.id, 'reject', 'Lý do một', accountant),
        review.act(twice.id, 'reject', 'Lý do hai', office),
      ]);
      expect(both.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
      const [refusal1] = (await stepsOf(twice.id)).filter((step) => step.status === 'rejected');
      expect(await voidOf(twice.cost)).toEqual({ voided: true, voided_by: refusal1?.actor, void_reason: refusal1?.note });
      expect(await consistent(twice)).toBe(true);

      // Approve against reject, on several fills: exactly one wins each, the loser is a 409 — and the pair always agrees.
      const fills = await Promise.all([fillOn(), fillOn(), fillOn(), fillOn(driverB), fillOn(driverB)]);
      const raced = await Promise.all(
        fills.map((fill) =>
          Promise.allSettled([review.act(fill.id, 'approve', undefined, accountant), review.act(fill.id, 'reject', 'Trùng', office)]),
        ),
      );
      for (const [index, outcomes] of raced.entries()) {
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
        const lost = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        expect((lost?.reason as { code?: string }).code).toBe('CONFLICT');
        expect(await consistent(fills[index] as { cost: string; id: string })).toBe(true);
      }
    });

    it('R8 · ★ all or nothing: a void that fails takes the `rejected` step with it, a step that fails takes the void — and the retry lands once', async () => {
      const fill = await fillOn();
      await pool.query(`
        CREATE FUNCTION itest_refuse_void() RETURNS trigger AS $$
        BEGIN
          IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN RAISE EXCEPTION 'itest: the void fails'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER itest_refuse_void BEFORE UPDATE ON vehicle_costs FOR EACH ROW EXECUTE FUNCTION itest_refuse_void();
        CREATE FUNCTION itest_refuse_rejected() RETURNS trigger AS $$
        BEGIN
          IF NEW.status = 'rejected' AND NEW.note = 'step fails' THEN RAISE EXCEPTION 'itest: the step fails'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER itest_refuse_rejected BEFORE INSERT ON fuel_review_events FOR EACH ROW EXECUTE FUNCTION itest_refuse_rejected();`);
      try {
        await expect(review.act(fill.id, 'reject', 'Trùng', accountant)).rejects.toThrow(/the void fails/);
        expect((await stepsOf(fill.id)).map((step) => step.status)).toEqual(['submitted']);
        expect((await voidOf(fill.cost)).voided).toBe(false);
        await pool.query(`DROP TRIGGER itest_refuse_void ON vehicle_costs`);
        await expect(review.act(fill.id, 'reject', 'step fails', accountant)).rejects.toThrow(/the step fails/);
        expect((await stepsOf(fill.id)).map((step) => step.status)).toEqual(['submitted']);
        expect((await voidOf(fill.cost)).voided).toBe(false);
      } finally {
        await pool.query(`
          DROP TRIGGER IF EXISTS itest_refuse_void ON vehicle_costs;
          DROP TRIGGER IF EXISTS itest_refuse_rejected ON fuel_review_events;
          DROP FUNCTION IF EXISTS itest_refuse_void();
          DROP FUNCTION IF EXISTS itest_refuse_rejected();`);
      }
      await review.act(fill.id, 'reject', 'Trùng', accountant);
      expect((await stepsOf(fill.id)).map((step) => step.status)).toEqual(['submitted', 'rejected']);
      expect(await voidOf(fill.cost)).toEqual({ voided: true, voided_by: accountant, void_reason: 'Trùng' });
    });
  });

  describe('★ a driver’s fill carries at least one photo — the server’s rule, not the phone’s', () => {
    const written = async () => [await count('vehicle_daily_fuel_checks'), await count('vehicle_costs'), await count('fuel_transactions'), await count('fuel_review_events')];

    it('P1 · ★ a fill with no photo is refused 422 EVIDENCE_REQUIRED — nothing written', async () => {
      const turn = await todaysTurn(await flaggedLorry(), driverA);
      expect((await refusal(() => record(turn, driverA, { receipt: receipt([], { vendorName: 'Petrolimex' }) })))?.details)
        .toEqual({ evidence: 'EVIDENCE_REQUIRED' });
      expect(await written()).toEqual([0, 0, 0, 0]);
    });

    it('P2 · ★ a start-of-shift “fuel added” with no photo is refused 422 — the day stays open; “no fuel” needs none', async () => {
      const lorry = await flaggedLorry();
      const turn = await todaysTurn(lorry, driverA);
      const declare = (key: string, rcpt?: DriverReceipt) =>
        fuel.declare({ assignmentId: turn, declaration: { outcome: 'fuel_added', ...fill() }, clientRequestId: key, declaredBy: driverA, ...(rcpt ? { receipt: rcpt } : {}) });
      expect((await refusal(() => declare('bare')))?.details).toEqual({ evidence: 'EVIDENCE_REQUIRED' });
      expect((await refusal(() => declare('empty', receipt([]))))?.details).toEqual({ evidence: 'EVIDENCE_REQUIRED' });
      expect(await written()).toEqual([0, 0, 0, 0]);
      // The refused declaration did not take the lorry's day: the same driver answers it properly.
      const check = await declare('with-photo', receipt([await stage(driverA)]));
      expect(check.outcome).toBe('fuel_added');
      expect(await written()).toEqual([1, 1, 1, 1]);
      const other = await todaysTurn(await flaggedLorry(), driverA);
      await fuel.declare({ assignmentId: other, declaration: { outcome: 'no_fuel' }, clientRequestId: 'nf', declaredBy: driverA });
      expect(await written()).toEqual([2, 1, 1, 1]);
    });

    it('P3 · ★ only the driver’s OWN waiting photo counts — another driver’s is refused NOT_STAGED, nothing written', async () => {
      const turn = await todaysTurn(await flaggedLorry(), driverA);
      const theirs = await stage(driverB);
      expect((await refusal(() => record(turn, driverA, { receipt: receipt([theirs]) })))?.details).toEqual({ evidence: 'NOT_STAGED' });
      expect(await written()).toEqual([0, 0, 0, 0]);
      expect((await evidence.staged(driverB)).map((image) => image.id)).toEqual([theirs]);
      await record(turn, driverA, { receipt: receipt([await stage(driverA)]) });
      expect(await written()).toEqual([0, 1, 1, 1]);
    });

    it('P4 · ★ a retry by key is the stored fill — even one whose photos the phone no longer has', async () => {
      const turn = await todaysTurn(await flaggedLorry(), driverA);
      const first = await record(turn, driverA, { key: 'retry', receipt: receipt([await stage(driverA)]) });
      const again = await record(turn, driverA, { key: 'retry', receipt: receipt([]) });
      expect(again.id).toBe(first.id);
      expect(await written()).toEqual([0, 1, 1, 1]);
    });

    it('P5 · answering “Cần bổ sung” needs no new photo — the fill already has one', async () => {
      const turn = await todaysTurn(await flaggedLorry(), driverA);
      const id = (await fillOf((await record(turn, driverA)).id)).id;
      await review.act(id, 'request-info', 'Ghi số hoá đơn', accountant);
      const answered = await mine.resubmit(driverA, id, { ...receipt([], { documentNumber: '0009' }), note: 'Đã ghi' });
      expect(answered).toMatchObject({ status: 'submitted', document: { number: '0009' } });
      expect(answered.evidence).toHaveLength(1);
    });
  });
});
