import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Pool } from 'pg';
import {
  TEST_URL,
  applyAllMigrations,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { UserRepository } from '@core/users/persistence/user.repository';
import { FilesystemObjectStorage } from '@infrastructure/object-storage/filesystem-object-storage';
import { businessToday } from '@common/pagination/date-range-page-query.dto';
import { VehicleFuelService } from '../../src/capabilities/trip-schedule/application/vehicle-fuel.service';
import { FleetOperationsRepository } from '../../src/capabilities/trip-schedule/persistence/fleet-operations.repository';
import { TripVehicleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { DriverAssignmentRepository } from '../../src/capabilities/trip-schedule/persistence/trip-execution.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { VehicleCostRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-cost.repository';
import { VehicleDailyFuelCheckRepository } from '../../src/capabilities/trip-schedule/persistence/vehicle-fuel-check.repository';
import { FuelDuplicateGuard } from '../../src/capabilities/trip-schedule/application/fuel-duplicate-guard';
import { FuelEvidenceService } from '../../src/capabilities/trip-schedule/application/fuel-evidence.service';
import { FuelTransactionService } from '../../src/capabilities/trip-schedule/application/fuel-transaction.service';
import { FuelTransactionWriter } from '../../src/capabilities/trip-schedule/application/fuel-transaction-writer';
import { FuelEvidenceRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-evidence.repository';
import { FuelMatchRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-match.repository';
import { FuelTransactionRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction.repository';
import { FuelTransactionViewRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction-view.repository';

/**
 * Fuel transactions (0037) against a REAL PostgreSQL.
 *
 * The promises are made by the database — one backing, a pinned lorry and
 * day, facts added once, images unique per fill, nothing deleted — so a
 * server has to agree. Fixtures go in by SQL; the behaviour runs through the
 * services exactly as the routes call them.
 */
const SCHEMA = 'fuel_transaction_itest';
const RESTRICT = '23001';
const CHECK = '23514';
const FOREIGN_KEY = '23503';
const UNIQUE = '23505';
const DAY = '2026-10-06';
const AT = new Date('2026-10-06T03:43:00Z'); // 10:43 in Hồ Chí Minh, on DAY

describeIntegration('Fuel transactions against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let root: string;
  let fuel: FuelTransactionService;
  let evidence: FuelEvidenceService;
  let driverFuel: VehicleFuelService;
  let office: string;
  let otherOffice: string;
  let driverA: string;
  let driverB: string;

  const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];
  const codeOf = (work: () => Promise<unknown>): Promise<string | undefined> =>
    work().then(
      () => undefined,
      (error: { code?: string }) => error.code,
    );
  const refusal = (work: () => Promise<unknown>) =>
    work().then(
      () => undefined,
      (error: { code?: string; details?: Record<string, string> }) => ({ code: error.code, details: error.details }),
    );
  const drain = async (stream: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  };
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(48)]);
  const one = async <T>(text: string, params: unknown[] = []) => (await sql<T>(text, params))[0] as T;

  // ------------------------------------------------------------ fixtures ----
  let plates = 0;
  const lorry = async () =>
    (await one<{ id: string }>(`INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`, [
      `51D-${String(66000 + ++plates).padStart(5, '0').replace(/(\d{3})(\d{2})$/, '$1.$2')}`,
      office,
    ])).id;
  const trip = async (legacyLorry: string | null = null) =>
    (await one<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, created_by, vehicle_id) VALUES ($1, $2, $3) RETURNING id`,
      [DAY, office, legacyLorry],
    )).id;
  const turn = async (tripId: string, vehicleId: string, driver: string) =>
    (await one<{ id: string }>(
      `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tripId, vehicleId, driver, office],
    )).id;
  /** A driver's portal fill on the lorry ledger, as 0034's service writes it. */
  const portalFill = async (vehicleId: string, driver = driverA) => {
    const tripId = await trip();
    const assignment = await turn(tripId, vehicleId, driver);
    return (await one<{ id: string }>(
      `INSERT INTO vehicle_costs (vehicle_id, business_date, category, amount, liters, source, source_trip_id, source_assignment_id, created_by)
       VALUES ($1, $2, 'fuel', 772460, 26, 'driver_portal', $3, $4, $5) RETURNING id`,
      [vehicleId, DAY, tripId, assignment, driver],
    )).id;
  };
  /** A backoffice trip fuel line — no lorry snapshot, as `cost.create` writes it. */
  const officeTripFuel = async (tripId: string, category = 'fuel') =>
    (await one<{ id: string }>(
      `INSERT INTO trip_costs (trip_id, category, amount, created_by) VALUES ($1, $2, 772460, $3) RETURNING id`,
      [tripId, category, office],
    )).id;
  /** A driver-declared trip fuel line — the turn's lorry snapshotted, still editable. */
  const driverTripFuel = async (tripId: string, assignment: string, vehicleId: string, driver: string) =>
    (await one<{ id: string }>(
      `INSERT INTO trip_costs (trip_id, category, amount, created_by, state, source, driver_assignment_id, vehicle_id)
       VALUES ($1, 'fuel', 500000, $2, 'editable', 'driver_portal', $3, $4) RETURNING id`,
      [tripId, driver, assignment, vehicleId],
    )).id;
  const rowOf = (table: 'vehicle_costs' | 'trip_costs', id: string) =>
    one<{ row: unknown }>(`SELECT row_to_json(t) AS row FROM ${table} t WHERE id = $1`, [id]);
  const stage = async (by = office, bytes = jpeg()) => (await evidence.stage({ buffer: bytes, originalname: 'IMG.JPG' }, by)).id;

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    const database = poolAsDatabase(pool);
    root = await mkdtemp(join(tmpdir(), 'fuel-evidence-itest-'));
    const images = new FuelEvidenceRepository(database);
    const transactions = new FuelTransactionRepository();
    fuel = new FuelTransactionService(
      database,
      transactions,
      new FuelTransactionViewRepository(database),
      images,
      new FuelTransactionWriter(transactions, images),
      new FuelDuplicateGuard(new FuelMatchRepository(database)),
    );
    evidence = new FuelEvidenceService(new FilesystemObjectStorage(root), images);
    driverFuel = new VehicleFuelService(
      database,
      new TripScheduleRepository(database),
      new DriverAssignmentRepository(database),
      new TripVehicleRepository(database),
      new VehicleDailyFuelCheckRepository(database),
      new VehicleCostRepository(database),
      new FleetOperationsRepository(database),
    );
    const users = new UserRepository(database);
    office = (await users.insertUser({ displayName: 'Kế Toán' })).id;
    otherOffice = (await users.insertUser({ displayName: 'Kế Toán 2' })).id;
    driverA = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
    driverB = (await users.insertUser({ displayName: 'Tài Xế B', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await pool?.end();
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE fuel_match_acks, fuel_transaction_enrichments, fuel_transaction_evidence, fuel_transactions,
                vehicle_daily_fuel_checks, vehicle_costs, trip_cost_edits, trip_costs, trip_driver_assignments,
                trip_schedules, trip_vehicles RESTART IDENTITY CASCADE`,
    );
  });

  describe('★ a lorry-ledger fill', () => {
    it('wraps a portal fill: its amount and liters stay the cost’s, its driver is the one who recorded it', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      const before = await rowOf('vehicle_costs', cost);

      const view = await fuel.recordOnVehicleCost(
        vehicle,
        cost,
        { facts: { vendorName: 'Cây xăng X', occurredAt: AT }, evidence: [{ id: await stage(), type: 'receipt' }] },
        office,
      );

      expect(view.fuelTransactionId).toEqual(expect.any(String));
      expect(view).toMatchObject({
        backing: { ledger: 'vehicle', costId: cost, source: 'driver_portal', voided: false },
        businessDate: DAY,
        amount: '772460.00',
        liters: '26.00',
        unitPrice: '29710.00',
        occurredAt: AT,
        driver: { id: driverA },
        vendor: { name: 'Cây xăng X', taxCode: null },
        flags: [],
      });
      expect(view.evidence).toHaveLength(1);
      expect(await rowOf('vehicle_costs', cost)).toEqual(before);
    });

    it('reads an unwrapped fill as the cost as it stands', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      const view = await fuel.viewOfVehicleCost(vehicle, cost);
      expect(view).toMatchObject({ fuelTransactionId: null, amount: '772460.00', driver: { id: driverA }, evidence: [] });
    });

    it('★ refuses a driver other than the one the cost’s provenance names', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      expect(await refusal(() => fuel.recordOnVehicleCost(vehicle, cost, { facts: { driverUserId: driverB }, evidence: [] }, office))).toEqual({
        code: 'VALIDATION_FAILED',
        details: { driverUserId: 'FACT_ALREADY_SET' },
      });
    });

    it('★ queues a second writer on the cost row, so it finds the first one’s fill instead of colliding', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      // The first writer, held open by hand: it holds the cost and has wrapped it, uncommitted.
      const held = await pool.connect();
      await held.query('BEGIN');
      await held.query(`SELECT 1 FROM vehicle_costs WHERE id = $1 FOR NO KEY UPDATE`, [cost]);
      await held.query(
        `INSERT INTO fuel_transactions (vehicle_id, business_date, vehicle_cost_id, vendor_name, created_by) VALUES ($1, $2, $3, 'Cây xăng X', $4)`,
        [vehicle, DAY, cost, office],
      );

      let settled = false;
      const second = fuel.recordOnVehicleCost(vehicle, cost, { facts: { vendorTaxCode: '0100109106' }, evidence: [] }, otherOffice);
      void second.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await held.query('COMMIT');
      held.release();
      expect((await second).vendor).toEqual({ name: 'Cây xăng X', taxCode: '0100109106' });
      expect(await sql(`SELECT 1 FROM fuel_transactions WHERE vehicle_cost_id = $1`, [cost])).toHaveLength(1);
    });

    it('takes no transaction on a voided cost', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      await sql(`UPDATE vehicle_costs SET voided_at = now(), voided_by = $2 WHERE id = $1`, [cost, office]);
      expect(await codeOf(() => fuel.recordOnVehicleCost(vehicle, cost, { facts: { vendorName: 'X' }, evidence: [] }, office))).toBe(
        'CONFLICT',
      );
    });
  });

  describe('★ facts, field by field, append-only', () => {
    let vehicle: string;
    let cost: string;
    const record = (facts: object, by = office) => fuel.recordOnVehicleCost(vehicle, cost, { facts, evidence: [] }, by);

    beforeEach(async () => {
      vehicle = await lorry();
      cost = await portalFill(vehicle);
    });

    it('takes facts over several commands, each from whoever knew it', async () => {
      await record({ vendorName: 'Cây xăng X' });
      await record({ vendorTaxCode: '0100 109 106', occurredAt: AT }, otherOffice);
      const view = await record({ documentSeries: '1c24taa', documentNumber: '0001234' });

      expect(view).toMatchObject({
        vendor: { name: 'Cây xăng X', taxCode: '0100109106' },
        document: { series: '1C24TAA', number: '0001234' },
        occurredAt: AT,
      });
      const log = await sql<{ field: string; recorded_by: string }>(
        `SELECT field, recorded_by FROM fuel_transaction_enrichments ORDER BY field`,
      );
      expect(log).toEqual([
        { field: 'document_number', recorded_by: office },
        { field: 'document_series', recorded_by: office },
        { field: 'driver_user_id', recorded_by: office },
        { field: 'occurred_at', recorded_by: otherOffice },
        { field: 'vendor_name', recorded_by: office },
        { field: 'vendor_tax_code', recorded_by: otherOffice },
      ]);
    });

    it('treats the same value sent again — however it is spaced — as a replay', async () => {
      await record({ vendorName: 'Cây xăng X', vendorTaxCode: '0100109106' });
      const logged = (await sql(`SELECT 1 FROM fuel_transaction_enrichments`)).length;
      await record({ vendorName: '  Cây  xăng X ', vendorTaxCode: '0100.109.106' });
      expect(await sql(`SELECT 1 FROM fuel_transaction_enrichments`)).toHaveLength(logged);
    });

    it('★ refuses a different value for a stored fact, by name, and leaves the row as it was', async () => {
      await record({ vendorTaxCode: '0100109106' });
      expect(await refusal(() => record({ vendorTaxCode: '0300588569', documentNumber: '77' }))).toEqual({
        code: 'VALIDATION_FAILED',
        details: { vendorTaxCode: 'FACT_ALREADY_SET' },
      });
      const [row] = await sql(`SELECT vendor_tax_code, document_number FROM fuel_transactions`);
      expect(row).toEqual({ vendor_tax_code: '0100109106', document_number: null });
    });

    it('★ the database refuses an overwrite too, and allows a fact into an empty column', async () => {
      await record({ vendorName: 'Cây xăng X' });
      expect(await codeOf(() => sql(`UPDATE fuel_transactions SET vendor_name = 'Khác'`))).toBe(RESTRICT);
      expect(await codeOf(() => sql(`UPDATE fuel_transactions SET document_number = 'A1'`))).toBeUndefined();
      expect(await codeOf(() => sql(`UPDATE fuel_transactions SET document_number = 'A2'`))).toBe(RESTRICT);
    });

    it('refuses a time off the fill’s day, a future time, and a non-driver as the driver', async () => {
      expect((await refusal(() => record({ occurredAt: new Date('2026-10-05T03:00:00Z') })))?.details).toEqual({
        occurredAt: 'NOT_ON_BUSINESS_DATE',
      });
      expect((await refusal(() => record({ occurredAt: new Date(Date.now() + 86_400_000) })))?.details).toEqual({
        occurredAt: 'IN_THE_FUTURE',
      });
      const officeCost = await one<{ id: string }>(
        `INSERT INTO vehicle_costs (vehicle_id, business_date, category, amount, source, created_by)
         VALUES ($1, $2, 'fuel', 100000, 'backoffice', $3) RETURNING id`,
        [vehicle, DAY, office],
      );
      expect(
        (await refusal(() => fuel.recordOnVehicleCost(vehicle, officeCost.id, { facts: { driverUserId: office }, evidence: [] }, office)))
          ?.details,
      ).toEqual({ driverUserId: 'NOT_A_DRIVER' });
    });

    it('keeps the lorry, the day, the backing and the author fixed', async () => {
      await record({ vendorName: 'X' });
      const other = await lorry();
      for (const change of [`vehicle_id = '${other}'`, `business_date = '2026-10-01'`, `created_by = '${otherOffice}'`]) {
        expect(await codeOf(() => sql(`UPDATE fuel_transactions SET ${change}`))).toBe(RESTRICT);
      }
    });
  });

  describe('★ a trip-ledger fill — the lorry is the office’s explicit choice', () => {
    it('wraps a NULL-lorry line on a multi-lorry trip for exactly ONE of its lorries', async () => {
      const [first, second, stranger] = [await lorry(), await lorry(), await lorry()];
      const tripId = await trip();
      await turn(tripId, first, driverA);
      await turn(tripId, second, driverB);
      const cost = await officeTripFuel(tripId);
      const before = await rowOf('trip_costs', cost);
      const command = (vehicleId: string) => ({ vehicleId, businessDate: DAY, facts: { liters: '26.00' }, evidence: [] });

      expect((await refusal(() => fuel.recordOnTripCost(tripId, cost, command(stranger), office)))?.details).toEqual({
        vehicleId: 'NOT_ON_TRIP',
      });
      const view = await fuel.recordOnTripCost(tripId, cost, command(first), office);
      expect(view).toMatchObject({
        backing: { ledger: 'trip', costId: cost, source: 'backoffice' },
        vehicle: { id: first },
        businessDate: DAY,
        amount: '772460.00',
        liters: '26.00',
        unitPrice: '29710.00',
        driver: null,
        flags: [],
      });
      // The second lorry may not claim the same line — through the service or the database.
      expect((await refusal(() => fuel.recordOnTripCost(tripId, cost, command(second), office)))?.details).toEqual({
        vehicleId: 'FIXED',
      });
      expect(
        await codeOf(() =>
          sql(`INSERT INTO fuel_transactions (vehicle_id, business_date, trip_cost_id, created_by) VALUES ($1, $2, $3, $4)`, [
            second,
            DAY,
            cost,
            office,
          ]),
        ),
      ).toBe(UNIQUE);
      expect(await rowOf('trip_costs', cost)).toEqual(before);
    });

    it('refuses a lorry other than the one a driver line names, and takes the declaring driver as provenance', async () => {
      const [mine, other] = [await lorry(), await lorry()];
      const tripId = await trip();
      const assignment = await turn(tripId, mine, driverB);
      const cost = await driverTripFuel(tripId, assignment, mine, driverB);

      expect(
        (await refusal(() => fuel.recordOnTripCost(tripId, cost, { vehicleId: other, businessDate: DAY, facts: {}, evidence: [] }, office)))
          ?.details,
      ).toEqual({ vehicleId: 'NOT_THE_COSTS_LORRY' });
      const view = await fuel.recordOnTripCost(tripId, cost, { vehicleId: mine, businessDate: DAY, facts: {}, evidence: [] }, office);
      expect(view.driver).toEqual({ id: driverB, displayName: 'Tài Xế B' });
    });

    it('takes the office’s choice on a trip that records no lorry — and flags it', async () => {
      const vehicle = await lorry();
      const tripId = await trip();
      const cost = await officeTripFuel(tripId);
      const view = await fuel.recordOnTripCost(tripId, cost, { vehicleId: vehicle, businessDate: DAY, facts: {}, evidence: [] }, office);
      expect(view.flags).toEqual(['vehicleConfirmedOnlyByEvidence']);
    });

    it('accepts the legacy lorry of a pre-0027 trip', async () => {
      const vehicle = await lorry();
      const tripId = await trip(vehicle);
      const cost = await officeTripFuel(tripId);
      const view = await fuel.recordOnTripCost(tripId, cost, { vehicleId: vehicle, businessDate: DAY, facts: {}, evidence: [] }, office);
      expect(view.vehicle?.id).toBe(vehicle);
    });

    it('needs the lorry and the day the first time, and fixes them after', async () => {
      const [vehicle, other] = [await lorry(), await lorry()];
      const tripId = await trip(vehicle);
      const cost = await officeTripFuel(tripId);
      const record = (command: object) => fuel.recordOnTripCost(tripId, cost, { facts: {}, evidence: [], ...command }, office);
      expect((await refusal(() => record({ facts: { vendorName: 'X' } })))?.details).toEqual({
        vehicleId: 'REQUIRED',
        businessDate: 'REQUIRED',
      });
      await record({ vehicleId: vehicle, businessDate: DAY });
      // Re-sending the same is fine; changing is not — in the service and in the database.
      await record({ vehicleId: vehicle, businessDate: DAY, facts: { vendorName: 'X' } });
      expect((await refusal(() => record({ vehicleId: other })))?.details).toEqual({ vehicleId: 'FIXED' });
      expect((await refusal(() => record({ businessDate: '2026-10-05' })))?.details).toEqual({ businessDate: 'FIXED' });
      expect(await codeOf(() => sql(`UPDATE fuel_transactions SET business_date = '2026-10-05'`))).toBe(RESTRICT);
    });

    it('wraps only a live fuel line', async () => {
      const vehicle = await lorry();
      const tripId = await trip(vehicle);
      const toll = await officeTripFuel(tripId, 'toll');
      const command = { vehicleId: vehicle, businessDate: DAY, facts: {}, evidence: [] };
      expect(await codeOf(() => fuel.recordOnTripCost(tripId, toll, command, office))).toBe('CONFLICT');
      expect(await codeOf(() => fuel.viewOfTripCost(tripId, toll))).toBe('NOT_FOUND');
      const voided = await officeTripFuel(tripId);
      await sql(`UPDATE trip_costs SET voided_at = now(), voided_by = $2 WHERE id = $1`, [voided, office]);
      expect(await codeOf(() => fuel.recordOnTripCost(tripId, voided, command, office))).toBe('CONFLICT');
      expect(
        await codeOf(() =>
          sql(`INSERT INTO fuel_transactions (vehicle_id, business_date, trip_cost_id, created_by) VALUES ($1, $2, $3, $4)`, [
            vehicle,
            DAY,
            voided,
            office,
          ]),
        ),
      ).toBe(RESTRICT);
    });

    it('★ flags — never blocks — a driver re-heading or re-pricing a wrapped editable line', async () => {
      const vehicle = await lorry();
      const tripId = await trip();
      const assignment = await turn(tripId, vehicle, driverA);
      const cost = await driverTripFuel(tripId, assignment, vehicle, driverA);
      await fuel.recordOnTripCost(tripId, cost, { vehicleId: vehicle, businessDate: DAY, facts: {}, evidence: [{ id: await stage() }] }, office);

      // The driver's own edit path is untouched: the row still takes it.
      await sql(`UPDATE trip_costs SET amount = 510000, category = 'toll' WHERE id = $1`, [cost]);
      // A minute after the image, by the evidence's own clock — never two clocks compared.
      await sql(
        `INSERT INTO trip_cost_edits (cost_id, field, old_value, new_value, edited_by, edited_at)
         SELECT $1, 'amount', '500000', '510000', $2, attached_at + interval '1 minute' FROM fuel_transaction_evidence`,
        [cost, driverA],
      );
      const view = await fuel.viewOfTripCost(tripId, cost);
      expect(view.amount).toBe('510000.00');
      expect(view.flags.sort()).toEqual(['editedAfterEvidence', 'noLongerFuel']);
    });
  });

  describe('★ a trip fill’s readings — added once each, never rewritten, never cleared', () => {
    let vehicle: string;
    let tripId: string;
    let cost: string;
    const record = (facts: object, by = office) =>
      fuel.recordOnTripCost(tripId, cost, { vehicleId: vehicle, businessDate: DAY, facts, evidence: [] }, by);
    const readingLog = () =>
      sql<{ field: string; value: string; recorded_by: string; recorded_at: Date }>(
        `SELECT field, value, recorded_by, recorded_at FROM fuel_transaction_enrichments
          WHERE field IN ('liters', 'odometer_km') ORDER BY field`,
      );
    const stored = () =>
      one<{ liters: string | null; odometer_km: number | null }>(`SELECT liters::text AS liters, odometer_km FROM fuel_transactions`);

    beforeEach(async () => {
      vehicle = await lorry();
      tripId = await trip(vehicle);
      cost = await officeTripFuel(tripId);
    });

    it('★ opens without readings and takes them later — each logged once, by whoever supplied it', async () => {
      expect(await record({ vendorName: 'X' })).toMatchObject({ liters: null, odometerKm: null, unitPrice: null });
      await record({ liters: '26' }, otherOffice);
      expect(await record({ odometerKm: 182345 })).toMatchObject({ liters: '26.00', odometerKm: 182345, unitPrice: '29710.00' });
      const log = await readingLog();
      expect(log.map(({ field, value, recorded_by }) => ({ field, value, recorded_by }))).toEqual([
        { field: 'liters', value: '26.00', recorded_by: otherOffice },
        { field: 'odometer_km', value: '182345', recorded_by: office },
      ]);
      expect(log.every((row) => row.recorded_at instanceof Date)).toBe(true);
    });

    it('attributes the readings an opener brings to the opener', async () => {
      await record({ liters: '26.00', odometerKm: 1200 }, otherOffice);
      expect((await readingLog()).map((row) => row.recorded_by)).toEqual([otherOffice, otherOffice]);
    });

    it('★ replays the same reading — however it is written — with no new audit row', async () => {
      await record({ liters: '26', odometerKm: 1200 });
      await record({ liters: '26.00', odometerKm: 1200 });
      await record({ liters: '026.0' }, otherOffice);
      expect(await readingLog()).toHaveLength(2);
    });

    it('★ refuses a different liters or odometer — the stored value stands', async () => {
      await record({ liters: '26.00', odometerKm: 1200 });
      expect((await refusal(() => record({ liters: '27.00' })))?.details).toEqual({ liters: 'FACT_ALREADY_SET' });
      expect((await refusal(() => record({ odometerKm: 1201 })))?.details).toEqual({ odometerKm: 'FACT_ALREADY_SET' });
      expect(await stored()).toEqual({ liters: '26.00', odometer_km: 1200 });
      expect(await readingLog()).toHaveLength(2);
    });

    it('★ two writers filling an empty reading with the same value both succeed — one audit row each field', async () => {
      await record({ vendorName: 'X' });
      await Promise.all([record({ liters: '26.00', odometerKm: 9 }, office), record({ liters: '26', odometerKm: 9 }, otherOffice)]);
      expect(await stored()).toEqual({ liters: '26.00', odometer_km: 9 });
      expect(await readingLog()).toHaveLength(2);
    });

    it('★ two writers racing different values leave exactly one value, and the audit names the one who won', async () => {
      await record({ vendorName: 'X' });
      const outcomes = await Promise.allSettled([record({ liters: '26.00' }, office), record({ liters: '27.00' }, otherOffice)]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const lost = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
      expect((lost.reason as { details?: unknown }).details).toEqual({ liters: 'FACT_ALREADY_SET' });
      const { liters } = await stored();
      const log = await readingLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ field: 'liters', value: liters, recorded_by: liters === '26.00' ? office : otherOffice });
    });

    /** A competing writer, held open by hand: it holds the trip line and has filled the reading, uncommitted. */
    const holdLiters = async (liters: string, by: string) => {
      const held = await pool.connect();
      await held.query('BEGIN');
      await held.query(`SELECT 1 FROM trip_costs WHERE id = $1 FOR NO KEY UPDATE`, [cost]);
      const filled = await held.query<{ id: string }>(
        `UPDATE fuel_transactions SET liters = $1 WHERE trip_cost_id = $2 RETURNING id`,
        [liters, cost],
      );
      await held.query(
        `INSERT INTO fuel_transaction_enrichments (fuel_transaction_id, field, value, recorded_by) VALUES ($1, 'liters', $2, $3)`,
        [filled.rows[0]?.id, liters, by],
      );
      return held;
    };
    const stillWaiting = async (work: Promise<unknown>) => {
      let settled = false;
      work.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      return !settled;
    };

    it('★ a writer arriving mid-fill waits, then replays the same reading — the first writer stays the audited one', async () => {
      await record({ vendorName: 'X' });
      const held = await holdLiters('26.00', otherOffice);
      const second = record({ liters: '26' }, office);
      expect(await stillWaiting(second)).toBe(true);
      await held.query('COMMIT');
      held.release();
      await expect(second).resolves.toMatchObject({ liters: '26.00' });
      expect((await readingLog()).map((row) => row.recorded_by)).toEqual([otherOffice]);
    });

    it('★ a writer arriving mid-fill with a different reading waits, then is refused — one value, one audit row', async () => {
      await record({ vendorName: 'X' });
      const held = await holdLiters('26.00', otherOffice);
      const second = record({ liters: '27.00' }, office);
      expect(await stillWaiting(second)).toBe(true);
      await held.query('COMMIT');
      held.release();
      expect((await refusal(() => second))?.details).toEqual({ liters: 'FACT_ALREADY_SET' });
      expect(await stored()).toEqual({ liters: '26.00', odometer_km: null });
      expect((await readingLog()).map((row) => row.recorded_by)).toEqual([otherOffice]);
    });

    it('★ refuses readings on a lorry-ledger fill — the vehicle cost owns them', async () => {
      const fill = await portalFill(vehicle);
      expect(
        (await refusal(() => fuel.recordOnVehicleCost(vehicle, fill, { facts: { liters: '26' }, evidence: [] }, office)))?.details,
      ).toEqual({ liters: 'ON_THE_COST' });
    });

    describe('the database, with no service in front', () => {
      it('★ takes a reading into an empty trip fill, and never into a vehicle-backed one', async () => {
        await record({ vendorName: 'X' });
        expect(
          await codeOf(() => sql(`UPDATE fuel_transactions SET liters = 26, odometer_km = 1200 WHERE trip_cost_id = $1`, [cost])),
        ).toBeUndefined();
        const fill = await portalFill(vehicle);
        await fuel.recordOnVehicleCost(vehicle, fill, { facts: { vendorName: 'X' }, evidence: [] }, office);
        expect(await codeOf(() => sql(`UPDATE fuel_transactions SET liters = 26 WHERE vehicle_cost_id = $1`, [fill]))).toBe(CHECK);
        expect(await codeOf(() => sql(`UPDATE fuel_transactions SET odometer_km = 1 WHERE vehicle_cost_id = $1`, [fill]))).toBe(CHECK);
      });

      it('★ refuses an overwritten or a cleared reading', async () => {
        await record({ liters: '26.00', odometerKm: 1200 });
        for (const change of ['liters = 27', 'liters = NULL', 'odometer_km = 1201', 'odometer_km = NULL']) {
          expect(await codeOf(() => sql(`UPDATE fuel_transactions SET ${change}`))).toBe(RESTRICT);
        }
        expect(await stored()).toEqual({ liters: '26.00', odometer_km: 1200 });
      });

      it('★ keeps a void its own act — voiding and enriching in one statement is refused', async () => {
        await record({ vendorName: 'X' });
        const voidWith = (extra: string) =>
          codeOf(() => sql(`UPDATE fuel_transactions SET voided_at = now(), voided_by = $1, void_reason = 'nhầm'${extra}`, [office]));
        expect(await voidWith(', liters = 26')).toBe(RESTRICT);
        expect(await voidWith(', odometer_km = 1')).toBe(RESTRICT);
        expect(await voidWith(", document_number = 'A1'")).toBe(RESTRICT);
        expect(await voidWith('')).toBeUndefined();
        // Voided once, it takes nothing more — not a reading, not a second void.
        expect(await codeOf(() => sql(`UPDATE fuel_transactions SET liters = 26`))).toBe(RESTRICT);
        expect(await voidWith('')).toBe(RESTRICT);
      });
    });
  });

  describe('★ several fills on one lorry in one business day — each its own cost and its own fuel transaction', () => {
    /** A lorry whose fuel is declared on it daily, and a turn on a trip run TODAY — the driver's real path. */
    const flaggedLorry = async () => {
      const id = await lorry();
      await sql(`UPDATE trip_vehicles SET daily_fuel_check_required = true WHERE id = $1`, [id]);
      return id;
    };
    const todaysTurn = async (vehicleId: string, driver: string) => {
      const tripId = (await one<{ id: string }>(
        `INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ($1, $2) RETURNING id`,
        [businessToday(new Date()), office],
      )).id;
      return turn(tripId, vehicleId, driver);
    };
    const fill = (amount: string, liters: string | null) => ({ amount, liters, odometerKm: null, note: null });
    const costsOf = (vehicleId: string) =>
      sql<{ id: string; amount: string; liters: string | null; business_date: string; created_by: string }>(
        `SELECT id, amount::text, liters::text, business_date::text, created_by FROM vehicle_costs
          WHERE vehicle_id = $1 ORDER BY created_at, id`,
        [vehicleId],
      );

    it('★ keeps every same-day fill: three events, three costs, three fuel transactions — none reused, none overwritten', async () => {
      const vehicle = await flaggedLorry();
      const turnA = await todaysTurn(vehicle, driverA);
      // Event A — the start-of-shift declaration, with its fill.
      await driverFuel.declare({
        assignmentId: turnA,
        declaration: { outcome: 'fuel_added', ...fill('772460', '26') },
        clientRequestId: 'event-a',
        declaredBy: driverA,
      });
      // Event B — later the same day, the same driver: a fill after the check.
      await driverFuel.recordFill({ assignmentId: turnA, fill: fill('500000', '17'), clientRequestId: 'event-b', recordedBy: driverA });
      // Event C — another driver, on another trip of the same lorry, the same day.
      const turnC = await todaysTurn(vehicle, driverB);
      await driverFuel.recordFill({ assignmentId: turnC, fill: fill('300000', '10.5'), clientRequestId: 'event-c', recordedBy: driverB });

      const costs = await costsOf(vehicle);
      expect(costs.map((cost) => [cost.amount, cost.liters, cost.created_by])).toEqual([
        ['772460.00', '26.00', driverA],
        ['500000.00', '17.00', driverA],
        ['300000.00', '10.50', driverB],
      ]);
      expect(new Set(costs.map((cost) => cost.id)).size).toBe(3);
      expect(new Set(costs.map((cost) => cost.business_date))).toEqual(new Set([businessToday(new Date())]));
      // The daily check is status: ONE row for the day, whatever the ledger holds.
      expect(await sql(`SELECT outcome FROM vehicle_daily_fuel_checks WHERE vehicle_id = $1`, [vehicle])).toEqual([
        { outcome: 'fuel_added' },
      ]);

      // Each event's own evidence and facts, wrapped on its own cost.
      const vendors = ['Cây xăng A', 'Cây xăng B', 'Cây xăng C'];
      const views = [];
      for (const [i, cost] of costs.entries()) {
        views.push(
          await fuel.recordOnVehicleCost(vehicle, cost.id, { facts: { vendorName: vendors[i] }, evidence: [{ id: await stage() }] }, office),
        );
      }
      expect(new Set(views.map((view) => view.fuelTransactionId)).size).toBe(3);
      views.forEach((view, i) => {
        expect(view).toMatchObject({
          backing: { ledger: 'vehicle', costId: costs[i]?.id },
          vehicle: { id: vehicle },
          businessDate: costs[i]?.business_date,
          amount: costs[i]?.amount,
          liters: costs[i]?.liters,
          vendor: { name: vendors[i] },
          driver: { id: costs[i]?.created_by },
        });
        expect(view.evidence).toHaveLength(1);
      });

      // After commit, all three are there, each on its own cost — the first untouched by the later two.
      const stored = await sql<{ vehicle_id: string; business_date: string; vehicle_cost_id: string; vendor_name: string }>(
        `SELECT vehicle_id, business_date::text, vehicle_cost_id, vendor_name FROM fuel_transactions ORDER BY vendor_name`,
      );
      expect(stored).toEqual(
        costs.map((cost, i) => ({ vehicle_id: vehicle, business_date: cost.business_date, vehicle_cost_id: cost.id, vendor_name: vendors[i] })),
      );
      expect((await fuel.viewOfVehicleCost(vehicle, costs[0]?.id as string)).vendor).toEqual({ name: 'Cây xăng A', taxCode: null });
    });

    it('records a second driver’s same-day fuel as a fill — a second START-OF-SHIFT declaration only reads the check that stands', async () => {
      const vehicle = await flaggedLorry();
      const turnA = await todaysTurn(vehicle, driverA);
      const turnB = await todaysTurn(vehicle, driverB);
      await driverFuel.declare({
        assignmentId: turnA,
        declaration: { outcome: 'fuel_added', ...fill('772460', '26') },
        clientRequestId: 'a',
        declaredBy: driverA,
      });
      // The day's obligation is met: this declaration reads A's check and writes no cost (0034's rule, pinned by
      // vehicle-daily-fuel 8b). The handset does not offer it once the day is answered.
      const standing = await driverFuel.declare({
        assignmentId: turnB,
        declaration: { outcome: 'fuel_added', ...fill('500000', '17') },
        clientRequestId: 'b',
        declaredBy: driverB,
      });
      expect(standing.sourceAssignmentId).toBe(turnA);
      expect(await costsOf(vehicle)).toHaveLength(1);
      // What the handset offers instead — a fill — is its own cost.
      await driverFuel.recordFill({ assignmentId: turnB, fill: fill('500000', '17'), clientRequestId: 'b-fill', recordedBy: driverB });
      expect((await costsOf(vehicle)).map((cost) => cost.created_by)).toEqual([driverA, driverB]);
    });
  });

  describe('★ evidence', () => {
    it('stages a retry as the same row, and stores identical bytes once whoever sends them', async () => {
      const bytes = jpeg();
      const first = await stage(office, bytes);
      expect(await stage(office, bytes)).toBe(first);
      const second = await stage(otherOffice, bytes);
      expect(second).not.toBe(first);
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect((await readdir(join(root, 'fuel-evidence'))).filter((name) => name === sha)).toHaveLength(1);
      expect(await sql(`SELECT DISTINCT storage_key FROM fuel_transaction_evidence`)).toEqual([{ storage_key: `fuel-evidence/${sha}` }]);
    });

    it('refuses HEIC with a message that helps, and anything that is not an image', async () => {
      const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), randomBytes(8)]);
      expect((await refusal(() => evidence.stage({ buffer: heic }, office)))?.details).toEqual({ file: 'HEIC_NOT_SUPPORTED' });
      expect((await refusal(() => evidence.stage({ buffer: Buffer.from('%PDF-1.7') }, office)))?.details).toEqual({
        file: 'UNSUPPORTED_IMAGE_FORMAT',
      });
    });

    it('★ refuses the same image twice on one fill, replays an attach, and takes it on another fill once acknowledged', async () => {
      const vehicle = await lorry();
      const [costA, costB] = [await portalFill(vehicle), await portalFill(vehicle)];
      const bytes = jpeg();
      const image = await stage(office, bytes);
      const attach = (cost: string, id: string, by = office) =>
        fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: [{ id }] }, by);

      await attach(costA, image);
      expect((await attach(costA, image)).evidence).toHaveLength(1); // the replay
      const again = await stage(office, bytes);
      expect((await refusal(() => attach(costA, again)))?.details).toEqual({ evidence: 'ALREADY_ON_TRANSACTION' });
      expect((await refusal(() => attach(costB, again)))?.details).toEqual({ evidence: 'ON_ANOTHER_FILL' });
      const onA = (await fuel.viewOfVehicleCost(vehicle, costA)).fuelTransactionId as string;
      const onB = await fuel.recordOnVehicleCost(vehicle, costB, { facts: {}, evidence: [{ id: again }], acknowledgedMatches: [onA] }, office);
      expect(onB.evidence).toHaveLength(1);
    });

    it('attaches only the caller’s own staged images, at most ten to a fill', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      const someoneElses = await stage(otherOffice);
      expect(
        (await refusal(() => fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: [{ id: someoneElses }] }, office)))?.details,
      ).toEqual({ evidence: 'NOT_STAGED' });
      const ten = await Promise.all(Array.from({ length: 10 }, () => stage()));
      await fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: ten.map((id) => ({ id })) }, office);
      expect(
        (await refusal(() => fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: [{ id: someoneElses }] }, otherOffice)))
          ?.details,
      ).toEqual({ evidence: 'TOO_MANY_IMAGES' });
    });

    it('discards only a waiting image of one’s own; serves attached ones, retired ones too', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      const bytes = jpeg();
      const image = await stage(office, bytes);
      expect(await codeOf(() => evidence.content(image, otherOffice))).toBe('NOT_FOUND');
      expect(await codeOf(() => evidence.discard(image, otherOffice))).toBe('NOT_FOUND');

      await fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: [{ id: image, type: 'timemark', capturedAt: AT }] }, office);
      expect(await codeOf(() => evidence.discard(image, office))).toBe('NOT_FOUND');
      expect(Buffer.compare(await drain((await evidence.content(image, otherOffice)).stream), bytes)).toBe(0);

      const retired = await evidence.retire(image, 'ảnh nhầm xe', office);
      expect(retired).toMatchObject({ retireReason: 'ảnh nhầm xe', evidenceType: 'timemark', capturedAt: AT });
      expect(await codeOf(() => evidence.retire(image, 'lần nữa', office))).toBe('CONFLICT');
      expect((await evidence.content(image, otherOffice)).byteSize).toBe(bytes.length);
    });

    it('keeps a file fixed and an attached image in place — the database refuses otherwise', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      const image = await stage();
      await fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: [{ id: image }] }, office);
      for (const change of [`byte_size = 1`, `evidence_type = 'receipt'`, `fuel_transaction_id = NULL, attached_at = NULL, attached_by = NULL`]) {
        expect(await codeOf(() => sql(`UPDATE fuel_transaction_evidence SET ${change} WHERE id = $1`, [image]))).toBeDefined();
      }
    });
  });

  describe('the schema’s own promises', () => {
    it('refuses DELETE on every fuel table', async () => {
      const vehicle = await lorry();
      const cost = await portalFill(vehicle);
      await fuel.recordOnVehicleCost(vehicle, cost, { facts: { vendorName: 'X' }, evidence: [{ id: await stage() }] }, office);
      for (const table of ['fuel_transactions', 'fuel_transaction_enrichments', 'fuel_transaction_evidence']) {
        expect(await codeOf(() => sql(`DELETE FROM ${table}`))).toBe(RESTRICT);
      }
    });

    it('holds exactly one backing, readings on the cost, and the cost’s own lorry and day', async () => {
      const vehicle = await lorry();
      const other = await lorry();
      const cost = await portalFill(vehicle);
      const tripId = await trip(vehicle);
      const line = await officeTripFuel(tripId);
      const insert = (columns: string, values: unknown[]) =>
        codeOf(() => sql(`INSERT INTO fuel_transactions (vehicle_id, business_date, created_by, ${columns}) VALUES ($1, $2, $3, $4${values.length > 1 ? ', $5' : ''})`, [vehicle, DAY, office, ...values]));

      expect(await insert('vehicle_cost_id, trip_cost_id', [cost, line])).toBe(CHECK);
      expect(await codeOf(() => sql(`INSERT INTO fuel_transactions (vehicle_id, business_date, created_by) VALUES ($1, $2, $3)`, [vehicle, DAY, office]))).toBe(CHECK);
      expect(await insert('vehicle_cost_id, liters', [cost, 10])).toBe(CHECK);
      expect(
        await codeOf(() =>
          sql(`INSERT INTO fuel_transactions (vehicle_id, business_date, created_by, vehicle_cost_id) VALUES ($1, $2, $3, $4)`, [other, DAY, office, cost]),
        ),
      ).toBe(FOREIGN_KEY);
    });

    it('★ holds the lorry and driver rules on its own — no service in front', async () => {
      const [first, second, stranger] = [await lorry(), await lorry(), await lorry()];
      const tripId = await trip();
      const assignment = await turn(tripId, first, driverA);
      await turn(tripId, second, driverB);
      const nullLine = await officeTripFuel(tripId);
      const driverLine = await driverTripFuel(tripId, assignment, first, driverA);
      const wrap = (vehicleId: string, cost: string, driver: string | null = null) =>
        codeOf(() =>
          sql(`INSERT INTO fuel_transactions (vehicle_id, business_date, trip_cost_id, driver_user_id, created_by) VALUES ($1, $2, $3, $4, $5)`, [
            vehicleId,
            DAY,
            cost,
            driver,
            office,
          ]),
        );

      expect(await wrap(stranger, nullLine)).toBe(RESTRICT); // not on the trip
      expect(await wrap(second, driverLine)).toBe(RESTRICT); // not the line's lorry
      expect(await wrap(first, driverLine, driverB)).toBe(RESTRICT); // not the declaring driver
      expect(await wrap(first, driverLine, office)).toBe(RESTRICT); // not a driver account
      expect(await wrap(second, nullLine)).toBeUndefined();

      const fill = await portalFill(first, driverA);
      await fuel.recordOnVehicleCost(first, fill, { facts: { vendorName: 'X' }, evidence: [] }, office);
      expect(await codeOf(() => sql(`UPDATE fuel_transactions SET driver_user_id = $1 WHERE vehicle_cost_id = $2`, [driverB, fill]))).toBe(
        RESTRICT,
      );
    });

    it('lets a duplicate acknowledgement name exactly one match', async () => {
      const vehicle = await lorry();
      const [costA, costB] = [await portalFill(vehicle), await portalFill(vehicle)];
      const subject = (await fuel.recordOnVehicleCost(vehicle, costA, { facts: { vendorName: 'X' }, evidence: [] }, office)).fuelTransactionId;
      const ack = (columns: string, values: unknown[]) =>
        codeOf(() =>
          sql(
            `INSERT INTO fuel_match_acks (subject_fuel_transaction_id, level, basis, acknowledged_by${columns}) VALUES ($1, 'possible', 'fingerprint', $2${values.map((_, i) => `, $${i + 3}`).join('')})`,
            [subject, office, ...values],
          ),
        );
      expect(await ack('', [])).toBe(CHECK);
      expect(await ack(', matched_vehicle_cost_id, matched_fuel_transaction_id', [costB, subject])).toBe(CHECK);
      expect(await ack(', matched_vehicle_cost_id', [costB])).toBeUndefined();
      expect(await codeOf(() => sql(`UPDATE fuel_match_acks SET level = 'high'`))).toBe(RESTRICT);
    });
  });
});
