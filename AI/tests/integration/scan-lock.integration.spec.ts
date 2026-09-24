import { Pool } from 'pg';
import type { AppConfig } from '@config/app.config';
import { SCAN_LOCK_NAMESPACE, ScanLock, scanLockKey } from '@infrastructure/scheduler/scan-lock';
import { TEST_URL, describeIntegration, migrateTestSchema, openTestSchema } from '../helpers/integration-database';

/**
 * The advisory lock against a REAL PostgreSQL.
 *
 * ★ THIS IS THE ONE THING A UNIT TEST CANNOT PROVE. "Only one worker runs a
 * detector" is a claim about `pg_try_advisory_lock` across two sessions; a
 * fake would agree with whatever this code believed. Every case below opens
 * real connections.
 */
const SCHEMA = 'ai_itest_lock';

describeIntegration('ScanLock against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let locks: ScanLock[] = [];

  const newLock = (): ScanLock => {
    const lock = new ScanLock({ databaseUrl: TEST_URL as string, dbSchema: SCHEMA } as unknown as AppConfig);
    locks.push(lock);
    return lock;
  };

  const heldCount = async (detectorCode: string, phase: string): Promise<number> => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND classid = $1 AND objid = $2::bigint & 4294967295 AND granted`,
      [SCAN_LOCK_NAMESPACE, scanLockKey(detectorCode, phase)],
    );
    return rows[0]?.n ?? 0;
  };

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await migrateTestSchema(pool, SCHEMA);

    // ★ CLEAR ANY STALE HOLDER FIRST. A previous run that was killed mid-scan
    // leaves its session — and therefore its lock — behind, and every case
    // here would then fail for a reason that has nothing to do with the code.
    // Safe because `require-database.ts` has already refused to let this point
    // anywhere but a disposable local database.
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
        WHERE locktype = 'advisory' AND classid = $1 AND pid <> pg_backend_pid()`,
      [SCAN_LOCK_NAMESPACE],
    );
  });

  afterEach(async () => {
    await Promise.all(locks.map((lock) => lock.close()));
    locks = [];
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool.end();
  });

  it('gives the lock to one caller and refuses the second, then lets it in after release', async () => {
    const first = newLock();
    const second = newLock();

    const held = await first.acquire('D1', 'discovery');
    expect(held).not.toBeNull();

    // A DIFFERENT ScanLock — a different pool, which is what a second replica is.
    expect(await second.acquire('D1', 'discovery')).toBeNull();

    await held!.release();
    const afterRelease = await second.acquire('D1', 'discovery');
    expect(afterRelease).not.toBeNull();
    await afterRelease!.release();
  });

  it('★ two concurrent attempts: exactly one wins', async () => {
    const contenders = [newLock(), newLock(), newLock()];
    const handles = await Promise.all(contenders.map((lock) => lock.acquire('D1', 'discovery')));

    expect(handles.filter((handle) => handle !== null)).toHaveLength(1);
    for (const handle of handles) await handle?.release();
  });

  it('different detectors, and different phases of one detector, do not block each other', async () => {
    const lock = newLock();
    const d1Discovery = await lock.acquire('D1', 'discovery');
    const d1Resolution = await lock.acquire('D1', 'resolution');
    const d2Discovery = await lock.acquire('D2', 'discovery');

    expect(d1Discovery).not.toBeNull();
    expect(d1Resolution).not.toBeNull();
    expect(d2Discovery).not.toBeNull();

    for (const handle of [d1Discovery, d1Resolution, d2Discovery]) await handle?.release();
  });

  it('releases the lock after a SUCCESSFUL scan, so the next tick can run', async () => {
    const lock = newLock();
    const handle = await lock.acquire('D1', 'discovery');
    await handle!.release();

    expect(await heldCount('D1', 'discovery')).toBe(0);
    const again = await lock.acquire('D1', 'discovery');
    expect(again).not.toBeNull();
    await again!.release();
  });

  it('releases the lock after a FAILED scan — the caller releases in `finally`', async () => {
    const lock = newLock();
    const handle = await lock.acquire('D1', 'resolution');
    try {
      throw new Error('the scan blew up');
    } catch {
      await handle!.release();
    }

    expect(await heldCount('D1', 'resolution')).toBe(0);
    const again = await lock.acquire('D1', 'resolution');
    expect(again).not.toBeNull();
    await again!.release();
  });

  it('★ a worker that dies holding the lock releases it — the session ends with the connection', async () => {
    const dying = newLock();
    const handle = await dying.acquire('D1', 'discovery');
    expect(handle).not.toBeNull();
    expect(await heldCount('D1', 'discovery')).toBe(1);

    // The crash: PostgreSQL kills the session that holds the lock, which is
    // what happens to every connection of a container that goes away.
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
        WHERE locktype = 'advisory' AND classid = $1 AND granted AND pid <> pg_backend_pid()`,
      [SCAN_LOCK_NAMESPACE],
    );

    const survivor = newLock();
    const afterDeath = await survivor.acquire('D1', 'discovery');
    expect(afterDeath).not.toBeNull();
    await afterDeath!.release();

    // The dead worker's own release now fails and DESTROYS its client rather
    // than returning a broken connection to the pool — which is also what
    // lets `close()` finish instead of waiting for it forever.
    await handle!.release();
  });

  it('derives a stable key per (detector, phase), and different keys for different pairs', () => {
    expect(scanLockKey('D1', 'discovery')).toBe(scanLockKey('D1', 'discovery'));
    expect(scanLockKey('D1', 'discovery')).not.toBe(scanLockKey('D1', 'resolution'));
    expect(scanLockKey('D1', 'discovery')).not.toBe(scanLockKey('D2', 'discovery'));
    expect(Number.isSafeInteger(scanLockKey('D1', 'discovery'))).toBe(true);
  });

  it('holds no open transaction while the lock is held — a scan makes network calls under it', async () => {
    const lock = newLock();
    const handle = await lock.acquire('D1', 'discovery');

    // ★ SCOPED TO THE LOCK'S OWN SESSION, not to the database. Asking
    // `pg_stat_activity` for every backend would also see the other
    // integration specs running beside this one, which legitimately do hold
    // transactions open — a neighbour's correctness is not this test's
    // subject.
    const { rows } = await pool.query<{ state: string }>(
      `SELECT a.state FROM pg_locks l
         JOIN pg_stat_activity a USING (pid)
        WHERE l.locktype = 'advisory' AND l.classid = $1
          AND l.objid = $2::bigint & 4294967295 AND l.granted`,
      [SCAN_LOCK_NAMESPACE, scanLockKey('D1', 'discovery')],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).not.toBe('idle in transaction');

    await handle!.release();
  });
});
