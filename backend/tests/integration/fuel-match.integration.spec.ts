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
import { UserRepository } from '@core/users/persistence/user.repository';
import { FilesystemObjectStorage } from '@infrastructure/object-storage/filesystem-object-storage';
import { FuelDuplicateGuard } from '../../src/capabilities/trip-schedule/application/fuel-duplicate-guard';
import { FuelEvidenceService } from '../../src/capabilities/trip-schedule/application/fuel-evidence.service';
import { FuelMatchService, type FuelMatchQuery } from '../../src/capabilities/trip-schedule/application/fuel-match.service';
import { FuelTransactionService } from '../../src/capabilities/trip-schedule/application/fuel-transaction.service';
import { FuelTransactionWriter } from '../../src/capabilities/trip-schedule/application/fuel-transaction-writer';
import { FuelEvidenceRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-evidence.repository';
import { FuelMatchRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-match.repository';
import { FuelTransactionRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction.repository';
import { FuelTransactionViewRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction-view.repository';

/**
 * PR-2 against a REAL PostgreSQL: Accounting holds a receipt, finds the cost
 * that already records it on EITHER ledger, and attaches to that cost — never
 * creating one, never picking one for the person. Fixtures go in by SQL; the
 * search and the attach run through the services exactly as the routes call
 * them.
 */
const SCHEMA = 'fuel_match_itest';
const DAY = '2026-10-06';

describeIntegration('Fuel receipt → existing cost, across both ledgers, against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let root: string;
  let fuel: FuelTransactionService;
  let search: FuelMatchService;
  let evidence: FuelEvidenceService;
  let office: string;
  let otherOffice: string;
  let driver: string;

  const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];
  const one = async <T>(text: string, params: unknown[] = []) => (await sql<T>(text, params))[0] as T;
  const refusal = (work: () => Promise<unknown>) =>
    work().then(
      () => undefined,
      (error: { code?: string; details?: Record<string, string> }) => ({ code: error.code, details: error.details }),
    );
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(48)]);
  const stage = async (by = office, bytes = jpeg()) => (await evidence.stage({ buffer: bytes, originalname: 'IMG.JPG' }, by)).id;
  const count = async (table: string) => (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`)).n;
  const ledgers = async () => ({ vehicle: await count('vehicle_costs'), trip: await count('trip_costs') });

  // ------------------------------------------------------------ fixtures ----
  let plates = 0;
  const lorry = async () =>
    (await one<{ id: string }>(`INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`, [
      `51C-${String(77000 + ++plates).padStart(5, '0').replace(/(\d{3})(\d{2})$/, '$1.$2')}`,
      office,
    ])).id;
  const trip = async (legacyLorry: string | null = null, day = DAY) =>
    (await one<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, created_by, vehicle_id) VALUES ($1, $2, $3) RETURNING id`,
      [day, office, legacyLorry],
    )).id;
  const turn = async (tripId: string, vehicleId: string) =>
    (await one<{ id: string }>(
      `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tripId, vehicleId, driver, office],
    )).id;
  /** A driver's fill on the lorry ledger, as 0034 writes it — from a turn on a trip of its own. */
  const lorryCost = async (vehicleId: string, amount = '772460', day = DAY, liters: string | null = '26') => {
    const tripId = await trip(null, day);
    const assignment = await turn(tripId, vehicleId);
    return (await one<{ id: string }>(
      `INSERT INTO vehicle_costs (vehicle_id, business_date, category, amount, liters, source, source_trip_id, source_assignment_id, created_by)
       VALUES ($1, $2, 'fuel', $3, $4, 'driver_portal', $5, $6, $7) RETURNING id`,
      [vehicleId, day, amount, liters, tripId, assignment, driver],
    )).id;
  };
  /** A trip fuel line; `lorry` is the driver line's snapshot, NULL for an office line. */
  const tripLine = async (tripId: string, amount = '772460', snapshot: string | null = null) =>
    (await one<{ id: string }>(
      `INSERT INTO trip_costs (trip_id, category, amount, created_by, vehicle_id) VALUES ($1, 'fuel', $2, $3, $4) RETURNING id`,
      [tripId, amount, office, snapshot],
    )).id;
  const receipt = (over: Partial<FuelMatchQuery> = {}): FuelMatchQuery => ({ businessDate: DAY, amount: '772460', evidence: [], ...over });
  const costsOf = (result: { matches: { backing: { costId: string } }[] }) => result.matches.map((m) => m.backing.costId);

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    const database = poolAsDatabase(pool);
    root = await mkdtemp(join(tmpdir(), 'fuel-match-itest-'));
    const images = new FuelEvidenceRepository(database);
    const transactions = new FuelTransactionRepository();
    const matches = new FuelMatchRepository(database);
    fuel = new FuelTransactionService(
      database,
      transactions,
      new FuelTransactionViewRepository(database),
      images,
      new FuelTransactionWriter(transactions, images),
      new FuelDuplicateGuard(matches),
    );
    search = new FuelMatchService(database, matches, transactions);
    evidence = new FuelEvidenceService(new FilesystemObjectStorage(root), images);
    const users = new UserRepository(database);
    office = (await users.insertUser({ displayName: 'Kế Toán' })).id;
    otherOffice = (await users.insertUser({ displayName: 'Kế Toán 2' })).id;
    driver = (await users.insertUser({ displayName: 'Tài Xế', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await pool?.end();
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE fuel_match_acks, fuel_transaction_enrichments, fuel_transaction_evidence, fuel_transactions,
                vehicle_costs, trip_cost_edits, trip_costs, trip_driver_assignments, trip_schedules, trip_vehicles
                RESTART IDENTITY CASCADE`,
    );
  });

  describe('★ finding the cost a receipt already is', () => {
    it('1 · finds a lorry-ledger cost', async () => {
      const vehicle = await lorry();
      const cost = await lorryCost(vehicle);
      const result = await search.find(vehicle, receipt({ liters: '26' }), office);
      expect(result.outcome).toBe('single');
      expect(result.matches[0]).toMatchObject({
        backing: { ledger: 'vehicle', costId: cost }, fuelTransactionId: null, level: 'possible', amount: '772460.00',
      });
    });

    it('2 · finds a trip-ledger line — one naming the lorry, and an office line on a trip that records it', async () => {
      const vehicle = await lorry();
      const driverLine = await tripLine(await trip(), '772460', vehicle);
      const onTrip = await trip();
      await turn(onTrip, vehicle);
      const officeLine = await tripLine(onTrip, '500000');
      const result = await search.find(vehicle, receipt(), office);
      expect(result).toMatchObject({ outcome: 'single', matches: [{ backing: { ledger: 'trip', costId: driverLine } }] });
      expect(result.dayRows.map((row) => row.backing.costId)).toEqual([officeLine]);
      expect(result.dayRows[0]?.trip?.id).toBe(onTrip);
    });

    it('3 · answers none — and shows the lorry’s other fuel that day, writing nothing', async () => {
      const vehicle = await lorry();
      const other = await lorryCost(vehicle, '500000');
      const result = await search.find(vehicle, receipt(), office);
      expect(result).toMatchObject({ outcome: 'none', matches: [] });
      expect(result.dayRows.map((row) => row.backing.costId)).toEqual([other]);
      expect(await count('fuel_transactions')).toBe(0);
    });

    it('4 · answers ambiguous for the same amount on both ledgers — two candidates, neither chosen', async () => {
      const vehicle = await lorry();
      const lorryLine = await lorryCost(vehicle, '772460', DAY, null);
      const tripCost = await tripLine(await trip(), '772460', vehicle);
      const result = await search.find(vehicle, receipt(), office);
      expect(result.outcome).toBe('ambiguous');
      expect(result.matches.map((m) => [m.backing.ledger, m.backing.costId]).sort()).toEqual(
        [['trip', tripCost], ['vehicle', lorryLine]].sort(),
      );
      expect(await count('fuel_transactions')).toBe(0);
    });

    it('★ keeps a line on a trip that records NO lorry out of the day — unless its amount is the receipt’s', async () => {
      const vehicle = await lorry();
      const nowhere = await trip();
      await tripLine(nowhere, '500000');
      expect(await search.find(vehicle, receipt(), office)).toMatchObject({ outcome: 'none', dayRows: [] });
      const same = await tripLine(nowhere, '772460');
      expect(costsOf(await search.find(vehicle, receipt(), office))).toEqual([same]);
    });

    it('never offers another lorry’s line: a snapshot of it, a trip recording only it, or a fill wrapped for it', async () => {
      const [vehicle, other] = [await lorry(), await lorry()];
      await tripLine(await trip(), '772460', other);
      await tripLine(await trip(other), '772460');
      const shared = await trip();
      await Promise.all([turn(shared, vehicle), turn(shared, other)]);
      const line = await tripLine(shared, '772460');
      await fuel.recordOnTripCost(shared, line, { facts: { vendorName: 'X' }, evidence: [], vehicleId: other, businessDate: DAY }, office);
      expect(await search.find(vehicle, receipt(), office)).toMatchObject({ outcome: 'none', matches: [], dayRows: [] });
    });

    it('★ finds a receipt already on a fill of ANOTHER lorry by its image, and by its document', async () => {
      const [vehicle, other] = [await lorry(), await lorry()];
      const elsewhere = await lorryCost(other, '999000');
      const bytes = jpeg();
      await fuel.recordOnVehicleCost(other, elsewhere, {
        facts: { vendorTaxCode: '0100109106', documentNumber: '0001234' }, evidence: [{ id: await stage(office, bytes) }],
      }, office);
      const byImage = await search.find(vehicle, receipt({ evidence: [await stage(otherOffice, bytes)] }), otherOffice);
      expect(byImage.matches[0]).toMatchObject({ level: 'exact', backing: { costId: elsewhere }, vehicle: { id: other } });
      const byDocument = await search.find(vehicle, receipt({ vendorTaxCode: '0100109106', documentNumber: '1234' }), office);
      expect(byDocument.matches).toEqual([]);
      const exactDocument = await search.find(vehicle, receipt({ vendorTaxCode: '0100 109 106', documentNumber: '0001234' }), office);
      expect(exactDocument.matches[0]).toMatchObject({ level: 'high', backing: { costId: elsewhere } });
    });

    it('never offers a withdrawn cost, or a trip line re-headed away from fuel', async () => {
      const vehicle = await lorry();
      const voided = await lorryCost(vehicle);
      await sql(`UPDATE vehicle_costs SET voided_at = now(), voided_by = $2 WHERE id = $1`, [voided, office]);
      const onTrip = await trip(vehicle);
      const withdrawn = await tripLine(onTrip);
      await sql(`UPDATE trip_costs SET voided_at = now(), voided_by = $2 WHERE id = $1`, [withdrawn, office]);
      // A driver's line, still editable — the only kind a category can move on.
      const toll = (await one<{ id: string }>(
        `INSERT INTO trip_costs (trip_id, category, amount, created_by, state, source, driver_assignment_id, vehicle_id)
         VALUES ($1, 'fuel', 772460, $2, 'editable', 'driver_portal', $3, $4) RETURNING id`,
        [onTrip, driver, await turn(onTrip, vehicle), vehicle],
      )).id;
      await sql(`UPDATE trip_costs SET category = 'toll' WHERE id = $1`, [toll]);
      expect(await search.find(vehicle, receipt(), office)).toMatchObject({ outcome: 'none', matches: [], dayRows: [] });
    });

    it('compares only images the caller uploaded', async () => {
      const vehicle = await lorry();
      const theirs = await stage(otherOffice);
      expect((await refusal(() => search.find(vehicle, receipt({ evidence: [theirs] }), office)))?.details).toEqual({
        evidence: 'NOT_STAGED',
      });
    });
  });

  describe('★ attaching to the one cost a person picked', () => {
    it('5 · attaches to a lorry-ledger cost: a vehicle-backed fill, the cost untouched', async () => {
      const vehicle = await lorry();
      const cost = await lorryCost(vehicle);
      const before = await ledgers();
      const image = await stage();
      const [picked] = (await search.find(vehicle, receipt({ evidence: [image] }), office)).matches;
      const view = await fuel.recordOnVehicleCost(vehicle, picked?.backing.costId as string, {
        facts: { vendorName: 'Cây xăng Phú Lâm' }, evidence: [{ id: image }],
      }, office);
      expect(view).toMatchObject({ backing: { ledger: 'vehicle', costId: cost }, amount: '772460.00', liters: '26.00' });
      expect(await one(`SELECT vehicle_cost_id, trip_cost_id, liters FROM fuel_transactions`)).toEqual({
        vehicle_cost_id: cost, trip_cost_id: null, liters: null,
      });
      expect(await ledgers()).toEqual(before);
      const again = await search.find(vehicle, receipt({ evidence: [image] }), office);
      expect(again.matches[0]).toMatchObject({ level: 'exact', fuelTransactionId: view.fuelTransactionId, evidenceCount: 1 });
    });

    it('6 · attaches to a trip line: a trip-backed fill for the searched lorry and day — no lorry cost appears', async () => {
      const vehicle = await lorry();
      const onTrip = await trip(null, '2026-10-05');
      await turn(onTrip, vehicle);
      const line = await tripLine(onTrip);
      const before = await ledgers();
      const line0 = await one(`SELECT row_to_json(t) AS row FROM trip_costs t WHERE id = $1`, [line]);
      const [picked] = (await search.find(vehicle, receipt(), office)).matches;
      expect(picked).toMatchObject({ backing: { ledger: 'trip', costId: line }, trip: { id: onTrip } });
      const view = await fuel.recordOnTripCost(onTrip, line, {
        facts: { liters: '26' }, evidence: [{ id: await stage() }], vehicleId: vehicle, businessDate: DAY,
      }, office);
      expect(view).toMatchObject({ backing: { ledger: 'trip', costId: line }, vehicle: { id: vehicle }, businessDate: DAY, liters: '26.00' });
      expect(await ledgers()).toEqual(before);
      expect(await one(`SELECT row_to_json(t) AS row FROM trip_costs t WHERE id = $1`, [line])).toEqual(line0);
    });

    it('7 · ★ a repeated attach returns the same fill — no second fill, no second image, no second audit row', async () => {
      const vehicle = await lorry();
      const cost = await lorryCost(vehicle);
      const image = await stage();
      const command = { facts: { vendorTaxCode: '0100109106', documentNumber: '0001234' }, evidence: [{ id: image }] };
      const first = await fuel.recordOnVehicleCost(vehicle, cost, command, office);
      const second = await fuel.recordOnVehicleCost(vehicle, cost, command, office);
      expect(second.fuelTransactionId).toBe(first.fuelTransactionId);
      expect(second.evidence.map((e) => e.id)).toEqual([image]);
      expect(await count('fuel_transactions')).toBe(1);
      expect(await count('fuel_transaction_enrichments')).toBe(3); // driver (provenance), tax code, number
      expect(await count('fuel_match_acks')).toBe(0);
    });

    it('8 · ★ a cost already wrapped shows its fill, and attaching more adds to THAT fill', async () => {
      const vehicle = await lorry();
      const onTrip = await trip(vehicle);
      const line = await tripLine(onTrip);
      const wrapped = await fuel.recordOnTripCost(onTrip, line, { facts: {}, evidence: [{ id: await stage() }], vehicleId: vehicle, businessDate: DAY }, office);
      const [candidate] = (await search.find(vehicle, receipt(), office)).matches;
      expect(candidate).toMatchObject({ fuelTransactionId: wrapped.fuelTransactionId, evidenceCount: 1 });
      const added = await fuel.recordOnTripCost(onTrip, line, { facts: { vendorName: 'Petrolimex 12' }, evidence: [{ id: await stage(otherOffice) }] }, otherOffice);
      expect(added.fuelTransactionId).toBe(wrapped.fuelTransactionId);
      expect(added.evidence).toHaveLength(2);
      expect(await count('fuel_transactions')).toBe(1);
    });

    it('10 · ★ two same-day, same-amount costs on one lorry stay two — each its own fill', async () => {
      const vehicle = await lorry();
      const [first, second] = [await lorryCost(vehicle), await lorryCost(vehicle)];
      const result = await search.find(vehicle, receipt(), office);
      expect(result.outcome).toBe('ambiguous');
      expect(costsOf(result).sort()).toEqual([first, second].sort());
      const [imageA, imageB] = [await stage(), await stage()];
      const a = await fuel.recordOnVehicleCost(vehicle, first, { facts: {}, evidence: [{ id: imageA }] }, office);
      const b = await fuel.recordOnVehicleCost(vehicle, second, { facts: {}, evidence: [{ id: imageB }] }, office);
      expect(a.fuelTransactionId).not.toBe(b.fuelTransactionId);
      const afterwards = await search.find(vehicle, receipt({ evidence: [imageA] }), office);
      expect(afterwards.matches.map((m) => [m.backing.costId, m.level])).toEqual([[first, 'exact'], [second, 'possible']]);
    });

    it('11 · ★ the search writes nothing, and a cost is attached only through its OWN ledger’s route', async () => {
      const vehicle = await lorry();
      const lorryLine = await lorryCost(vehicle);
      const onTrip = await trip(vehicle);
      const tripCost = await tripLine(onTrip);
      const image = await stage();
      await search.find(vehicle, receipt({ evidence: [image], vendorTaxCode: '0100109106', documentNumber: '1' }), office);
      expect([await count('fuel_transactions'), await count('fuel_match_acks'), await count('fuel_transaction_enrichments')]).toEqual([0, 0, 0]);
      expect(await one(`SELECT attached_at FROM fuel_transaction_evidence WHERE id = $1`, [image])).toEqual({ attached_at: null });
      expect((await refusal(() => fuel.recordOnVehicleCost(vehicle, tripCost, { facts: {}, evidence: [{ id: image }] }, office)))?.code).toBe('NOT_FOUND');
      expect((await refusal(() => fuel.recordOnTripCost(onTrip, lorryLine, { facts: {}, evidence: [{ id: image }], vehicleId: vehicle, businessDate: DAY }, office)))?.code).toBe('NOT_FOUND');
      expect(await count('fuel_transactions')).toBe(0);
    });

    it('12 · ★ creates no cost — not for a receipt with no match, not for a cost that does not exist', async () => {
      const vehicle = await lorry();
      const before = await ledgers();
      expect((await search.find(vehicle, receipt(), office)).outcome).toBe('none');
      const missing = '00000000-0000-4000-8000-000000000000';
      expect((await refusal(() => fuel.recordOnVehicleCost(vehicle, missing, { facts: { vendorName: 'X' }, evidence: [] }, office)))?.code).toBe('NOT_FOUND');
      const onTrip = await trip(vehicle);
      expect((await refusal(() => fuel.recordOnTripCost(onTrip, missing, { facts: {}, evidence: [], vehicleId: vehicle, businessDate: DAY }, office)))?.code).toBe('NOT_FOUND');
      expect(await ledgers()).toEqual(before);
      expect(await count('fuel_transactions')).toBe(0);
    });
  });

  describe('★ one receipt on two fills is a decision — acknowledged, kept, and race-safe', () => {
    it('refuses a document already on another fill until that fill is acknowledged — then keeps the acknowledgement', async () => {
      const vehicle = await lorry();
      const [first, second] = [await lorryCost(vehicle), await lorryCost(vehicle)];
      const document = { vendorTaxCode: '0100109106', documentNumber: '0001234' };
      const onFirst = await fuel.recordOnVehicleCost(vehicle, first, { facts: document, evidence: [] }, office);
      expect((await refusal(() => fuel.recordOnVehicleCost(vehicle, second, { facts: document, evidence: [] }, otherOffice)))?.details).toEqual({
        documentNumber: 'ON_ANOTHER_FILL',
      });
      expect(await count('fuel_transactions')).toBe(1); // the refusal left nothing behind
      const onSecond = await fuel.recordOnVehicleCost(vehicle, second, {
        facts: document, evidence: [], acknowledgedMatches: [onFirst.fuelTransactionId as string],
      }, otherOffice);
      expect(await sql(`SELECT subject_fuel_transaction_id AS s, matched_fuel_transaction_id AS m, level, basis, evidence_id, acknowledged_by FROM fuel_match_acks`)).toEqual([
        { s: onSecond.fuelTransactionId, m: onFirst.fuelTransactionId, level: 'high', basis: 'document_identity', evidence_id: null, acknowledged_by: otherOffice },
      ]);
      // A replay adds nothing, so it asks for nothing and records nothing again.
      await fuel.recordOnVehicleCost(vehicle, second, { facts: document, evidence: [] }, otherOffice);
      expect(await count('fuel_match_acks')).toBe(1);
    });

    it('records an image acknowledgement against the image that was attached', async () => {
      const vehicle = await lorry();
      const [first, second] = [await lorryCost(vehicle), await lorryCost(vehicle)];
      const bytes = jpeg();
      const onFirst = await fuel.recordOnVehicleCost(vehicle, first, { facts: {}, evidence: [{ id: await stage(office, bytes) }] }, office);
      const again = await stage(otherOffice, bytes);
      await fuel.recordOnVehicleCost(vehicle, second, { facts: {}, evidence: [{ id: again }], acknowledgedMatches: [onFirst.fuelTransactionId as string] }, otherOffice);
      expect(await sql(`SELECT level, basis, evidence_id FROM fuel_match_acks`)).toEqual([{ level: 'exact', basis: 'evidence_hash', evidence_id: again }]);
    });

    it('9 · ★ two accountants wrapping one cost at once leave ONE fill, both images, one audit row per fact — on each ledger', async () => {
      const vehicle = await lorry();
      const cost = await lorryCost(vehicle);
      const onTrip = await trip(vehicle);
      const line = await tripLine(onTrip);
      const [a1, b1, a2, b2] = [await stage(office), await stage(otherOffice), await stage(office), await stage(otherOffice)];
      const facts = { vendorName: 'Cây xăng Phú Lâm' };
      await Promise.all([
        fuel.recordOnVehicleCost(vehicle, cost, { facts, evidence: [{ id: a1 }] }, office),
        fuel.recordOnVehicleCost(vehicle, cost, { facts, evidence: [{ id: b1 }] }, otherOffice),
        fuel.recordOnTripCost(onTrip, line, { facts, evidence: [{ id: a2 }], vehicleId: vehicle, businessDate: DAY }, office),
        fuel.recordOnTripCost(onTrip, line, { facts, evidence: [{ id: b2 }], vehicleId: vehicle, businessDate: DAY }, otherOffice),
      ]);
      expect(await sql(`SELECT (vehicle_cost_id IS NOT NULL) AS lorry, COUNT(*)::int AS n FROM fuel_transactions GROUP BY 1 ORDER BY 1`)).toEqual([
        { lorry: false, n: 1 }, { lorry: true, n: 1 },
      ]);
      expect(await one(`SELECT COUNT(*)::int AS n FROM fuel_transaction_evidence WHERE attached_at IS NOT NULL`)).toEqual({ n: 4 });
      expect(await sql(`SELECT field, COUNT(*)::int AS n FROM fuel_transaction_enrichments WHERE field = 'vendor_name' GROUP BY field`)).toEqual([
        { field: 'vendor_name', n: 2 },
      ]);
    });

    it('★ a writer putting the same image on another fill waits for the first — then is asked to acknowledge it', async () => {
      const vehicle = await lorry();
      const [first, second] = [await lorryCost(vehicle), await lorryCost(vehicle)];
      const bytes = jpeg();
      const mine = await stage(office, bytes);
      const sha = (await one<{ sha256: string }>(`SELECT sha256 FROM fuel_transaction_evidence WHERE id = $1`, [mine])).sha256;
      // The first writer, held open by hand: it holds the image's lock and has attached it, uncommitted.
      const held = await pool.connect();
      await held.query('BEGIN');
      await held.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`fuel-receipt:image:${sha}`]);
      const ft = (await held.query<{ id: string }>(
        `INSERT INTO fuel_transactions (vehicle_id, business_date, vehicle_cost_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [vehicle, DAY, first, office],
      )).rows[0]?.id;
      await held.query(`UPDATE fuel_transaction_evidence SET fuel_transaction_id = $1, attached_by = $2, attached_at = now() WHERE id = $3`, [ft, office, mine]);

      let settled = false;
      const theirs = fuel.recordOnVehicleCost(vehicle, second, { facts: {}, evidence: [{ id: await stage(otherOffice, bytes) }] }, otherOffice);
      void theirs.then(() => (settled = true), () => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await held.query('COMMIT');
      held.release();
      expect((await refusal(() => theirs))?.details).toEqual({ evidence: 'ON_ANOTHER_FILL' });
      expect(await one(`SELECT COUNT(*)::int AS n FROM fuel_transactions WHERE vehicle_cost_id = $1`, [second])).toEqual({ n: 0 });
    });

    it('two accountants putting one image on two fills at once: exactly one is asked to acknowledge', async () => {
      const vehicle = await lorry();
      const [first, second] = [await lorryCost(vehicle), await lorryCost(vehicle)];
      const bytes = jpeg();
      const [mine, theirs] = [await stage(office, bytes), await stage(otherOffice, bytes)];
      const results = await Promise.allSettled([
        fuel.recordOnVehicleCost(vehicle, first, { facts: {}, evidence: [{ id: mine }] }, office),
        fuel.recordOnVehicleCost(vehicle, second, { facts: {}, evidence: [{ id: theirs }] }, otherOffice),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ details: { evidence: 'ON_ANOTHER_FILL' } });
      expect(await count('fuel_transactions')).toBe(1);
    });
  });
});
