import { randomBytes } from 'node:crypto';
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
import { fuelWriter } from '../helpers/fuel-wiring';
import { UserRepository } from '@core/users/persistence/user.repository';
import { FilesystemObjectStorage } from '@infrastructure/object-storage/filesystem-object-storage';
import { FuelEvidenceService } from '../../src/capabilities/trip-schedule/application/fuel-evidence.service';
import { FuelTransactionService } from '../../src/capabilities/trip-schedule/application/fuel-transaction.service';
import { MAX_STAGED_PER_UPLOADER } from '../../src/capabilities/trip-schedule/domain/fuel-evidence';
import { FuelEvidenceRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-evidence.repository';
import { FuelTransactionRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction.repository';
import { FuelTransactionViewRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction-view.repository';

/**
 * ★ A STAGED IMAGE OUTLIVES THE BROWSER THAT SENT IT. Uploads wait on the
 * server until attached or discarded, and at most MAX_STAGED_PER_UPLOADER may
 * wait per person. A tab closed, a crash, a lost network: the browser never
 * says "discard" — so the SERVER must be able to hand every waiting image back,
 * or the cap becomes a lockout. Against a real PostgreSQL and a real store.
 */
const SCHEMA = 'fuel_evidence_staging_itest';
const DAY = '2026-10-06';

describeIntegration('Staged fuel evidence — abandoned, recovered, never a lockout', () => {
  jest.setTimeout(60_000);

  let pool: Pool;
  let root: string;
  let evidence: FuelEvidenceService;
  let fuel: FuelTransactionService;
  let office: string;
  let otherOffice: string;
  let driver: string;

  const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];
  const one = async <T>(text: string, params: unknown[] = []) => (await sql<T>(text, params))[0] as T;
  const codeOf = (work: () => Promise<unknown>) =>
    work().then(
      () => undefined,
      (error: { code?: string; details?: Record<string, string> }) => error.details?.['file'] ?? error.code,
    );
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(48)]);
  const stage = async (by = office, bytes = jpeg()) => (await evidence.stage({ buffer: bytes, originalname: 'IMG.JPG' }, by)).id;
  const drain = async (stream: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  };
  const waitingIds = async (by = office) => (await evidence.staged(by)).map((image) => image.id);
  /** A browser that uploads and then disappears: no discard is ever sent. */
  const abandonSession = async (images: number) => {
    const ids: string[] = [];
    for (let i = 0; i < images; i++) ids.push(await stage());
    return ids;
  };
  const fillToAttachTo = async () => {
    const vehicle = (await one<{ id: string }>(`INSERT INTO trip_vehicles (plate, created_by) VALUES ('51C-111.11', $1) RETURNING id`, [office])).id;
    const trip = (await one<{ id: string }>(`INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ($1, $2) RETURNING id`, [DAY, office])).id;
    const turn = (await one<{ id: string }>(
      `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [trip, vehicle, driver, office],
    )).id;
    const cost = (await one<{ id: string }>(
      `INSERT INTO vehicle_costs (vehicle_id, business_date, category, amount, liters, source, source_trip_id, source_assignment_id, created_by)
       VALUES ($1, $2, 'fuel', 772460, 26, 'driver_portal', $3, $4, $5) RETURNING id`,
      [vehicle, DAY, trip, turn, driver],
    )).id;
    return { vehicle, cost };
  };

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    const database = poolAsDatabase(pool);
    root = await mkdtemp(join(tmpdir(), 'fuel-staging-itest-'));
    const images = new FuelEvidenceRepository(database);
    const transactions = new FuelTransactionRepository();
    evidence = new FuelEvidenceService(new FilesystemObjectStorage(root), images);
    fuel = new FuelTransactionService(
      database,
      transactions,
      new FuelTransactionViewRepository(database),
      images,
      fuelWriter(database),
    );
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
                vehicle_costs, trip_driver_assignments, trip_schedules, trip_vehicles RESTART IDENTITY CASCADE`,
    );
  });

  it('★ abandoned sessions up to the cap: the returning uploader is handed every waiting image back, and frees the cap', async () => {
    // Three sessions, each closed without a single discard — 30 images waiting.
    const abandoned = [...(await abandonSession(12)), ...(await abandonSession(12)), ...(await abandonSession(6))];
    expect(abandoned).toHaveLength(MAX_STAGED_PER_UPLOADER);
    const theirs = await stage(otherOffice);
    expect(await codeOf(() => stage())).toBe('TOO_MANY_STAGED');

    // The user returns with a fresh browser that remembers nothing: the server hands back exactly theirs.
    const recovered = await waitingIds();
    expect(new Set(recovered)).toEqual(new Set(abandoned));
    expect(recovered).not.toContain(theirs);
    expect(recovered[0]).toBe(abandoned.at(-1)); // newest first
    // Each one is still the uploader's to see …
    expect((await drain((await evidence.content(recovered[0] as string, office)).stream)).length).toBeGreaterThan(0);
    // … and to discard: one freed slot is one new upload.
    await evidence.discard(recovered[0] as string, office);
    expect(await codeOf(() => stage())).toBeUndefined();
    for (const id of await waitingIds()) await evidence.discard(id, office);
    expect(await waitingIds()).toEqual([]);
    // Another accountant's waiting image was never theirs to see or drop.
    expect(await waitingIds(otherOffice)).toEqual([theirs]);
    expect(await codeOf(() => evidence.discard(theirs, office))).toBe('NOT_FOUND');
  });

  it('★ never lists, discards or moves an attached image — recovery touches waiting images only', async () => {
    const { vehicle, cost } = await fillToAttachTo();
    const attached = await stage();
    await fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: [{ id: attached }] }, office);
    const before = await one(`SELECT row_to_json(e) AS row FROM fuel_transaction_evidence e WHERE id = $1`, [attached]);
    const waiting = await stage();

    expect(await waitingIds()).toEqual([waiting]);
    expect(await codeOf(() => evidence.discard(attached, office))).toBe('NOT_FOUND');
    for (const id of await waitingIds()) await evidence.discard(id, office);
    expect(await one(`SELECT row_to_json(e) AS row FROM fuel_transaction_evidence e WHERE id = $1`, [attached])).toEqual(before);
    expect((await fuel.viewOfVehicleCost(vehicle, cost)).evidence.map((image) => image.id)).toEqual([attached]);
  });

  it('keeps a discarded image a record: off the list, not discarded twice, not readable, not editable', async () => {
    const id = await stage();
    await evidence.discard(id, office);
    expect(await waitingIds()).toEqual([]);
    expect(await codeOf(() => evidence.discard(id, office))).toBe('NOT_FOUND');
    expect(await codeOf(() => evidence.content(id, office))).toBe('NOT_FOUND');
    expect(await codeOf(() => pool.query(`UPDATE fuel_transaction_evidence SET discarded_at = NULL, discarded_by = NULL WHERE id = $1`, [id])))
      .toBe('23001');
  });

  it('keeps a repeated upload the same row — even at the cap — and a discarded one starts afresh', async () => {
    const bytes = jpeg();
    const first = await stage(office, bytes);
    await abandonSession(MAX_STAGED_PER_UPLOADER - 1);
    // At the cap, the same bytes again are the image already waiting — not a refusal, not a second row.
    expect(await stage(office, bytes)).toBe(first);
    expect(await waitingIds()).toHaveLength(MAX_STAGED_PER_UPLOADER);
    await evidence.discard(first, office);
    const again = await stage(office, bytes);
    expect(again).not.toBe(first);
    expect(await sql(`SELECT id FROM fuel_transaction_evidence WHERE sha256 = (SELECT sha256 FROM fuel_transaction_evidence WHERE id = $1)`, [first]))
      .toHaveLength(2); // the discarded record stays, beside the new waiting row
  });

  it('★ concurrent uploads stay one row per image, and all of them are recoverable', async () => {
    const bytes = jpeg();
    const sameTwice = await Promise.all(Array.from({ length: 5 }, () => stage(office, bytes)));
    expect(new Set(sameTwice).size).toBe(1);
    const distinct = await Promise.all(Array.from({ length: 5 }, () => stage()));
    expect(new Set(distinct).size).toBe(5);
    expect(new Set(await waitingIds())).toEqual(new Set([...sameTwice.slice(0, 1), ...distinct]));
  });

  it('discarding a waiting image never removes the stored file another row still uses', async () => {
    const { vehicle, cost } = await fillToAttachTo();
    const bytes = jpeg();
    const attached = await stage(otherOffice, bytes);
    await fuel.recordOnVehicleCost(vehicle, cost, { facts: {}, evidence: [{ id: attached }] }, otherOffice);
    const mine = await stage(office, bytes); // the same bytes, waiting for somebody else
    const files = await readdir(join(root, 'fuel-evidence'));
    await evidence.discard(mine, office);
    expect(await readdir(join(root, 'fuel-evidence'))).toEqual(files);
    expect(await drain((await evidence.content(attached, otherOffice)).stream)).toEqual(bytes);
  });
});
