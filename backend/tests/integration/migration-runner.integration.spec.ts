import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { MigrationRunner } from '@infrastructure/database/migration-runner';

/**
 * The migration runner against a REAL PostgreSQL.
 *
 * The unit spec next door drives a fake client, which proves the runner calls
 * BEGIN/COMMIT/ROLLBACK in the right order but cannot prove PostgreSQL honours
 * any of it. Three things are only true if a real server says so:
 *
 *   - DDL inside a transaction actually rolls back (it does in PostgreSQL, and
 *     does NOT in MySQL or Oracle — so this is a property of our database
 *     choice, not of our code, and deserves to be pinned)
 *   - `pg_advisory_lock` actually serialises two connections
 *   - a failed file leaves no trace in the ledger
 *
 * Skipped unless DATABASE_URL_TEST names a database this test may WIPE. It
 * drops and recreates `public` between cases, so never point it at anything
 * you care about.
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;

/**
 * Refuses to run against anything not obviously disposable.
 *
 * A destructive suite pointed at the wrong database destroys it silently and
 * completely, and the mistake that causes it is mundane — copying DATABASE_URL
 * instead of writing a separate one. Requiring the name to say `test` makes
 * that mistake loud instead.
 */
function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');

  if (!/test/i.test(name)) {
    throw new Error(
      `DATABASE_URL_TEST points at "${name}", which is not named as a test database. ` +
        'This suite DROPS SCHEMA public — point it at a disposable database whose name contains "test".',
    );
  }
}

describeIntegration('MigrationRunner against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let directory: string;

  beforeAll(() => {
    // This suite DROPS SCHEMA. The only thing standing between that and someone
    // pasting a development URL into DATABASE_URL_TEST is this check, so it runs
    // before the pool is even opened.
    assertLooksLikeATestDatabase(TEST_URL as string);

    pool = new Pool({ connectionString: TEST_URL, max: 4 });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // The temp directory FIRST. If the reset below throws, afterEach still has a
    // real path to clean up rather than the previous case's — or undefined.
    directory = await mkdtemp(join(tmpdir(), 'bo-migrations-'));

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const migration = (name: string, sql: string) => writeFile(join(directory, name), sql, 'utf8');

  const tableExists = async (name: string): Promise<boolean> => {
    const result = await pool.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [
      `public.${name}`,
    ]);
    return result.rows[0]?.ok === true;
  };

  const ledger = async (): Promise<string[]> => {
    const result = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    return result.rows.map((row) => row.version);
  };

  describe('applying', () => {
    it('applies files in filename order and records each one', async () => {
      await migration('0001_first.sql', 'CREATE TABLE bo_first (id INT PRIMARY KEY);');
      // Depends on the first having run: proves ORDER, not just "both ran".
      await migration('0002_second.sql', 'ALTER TABLE bo_first ADD COLUMN label TEXT;');

      const result = await new MigrationRunner(pool, directory).run();

      expect(result.applied).toEqual(['0001_first.sql', '0002_second.sql']);
      expect(await ledger()).toEqual(['0001_first.sql', '0002_second.sql']);
    });

    it('skips everything on a second run and changes nothing', async () => {
      await migration('0001_first.sql', 'CREATE TABLE bo_first (id INT PRIMARY KEY);');
      await new MigrationRunner(pool, directory).run();

      const second = await new MigrationRunner(pool, directory).run();

      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(['0001_first.sql']);
      // Re-running the CREATE would have thrown; a duplicate ledger row would
      // have violated the primary key. Neither happened.
      expect(await ledger()).toEqual(['0001_first.sql']);
    });

    it('applies a NEW file added later without touching the applied one', async () => {
      await migration('0001_first.sql', 'CREATE TABLE bo_first (id INT PRIMARY KEY);');
      await new MigrationRunner(pool, directory).run();

      await migration('0002_later.sql', 'CREATE TABLE bo_later (id INT PRIMARY KEY);');
      const result = await new MigrationRunner(pool, directory).run();

      expect(result.applied).toEqual(['0002_later.sql']);
      expect(result.skipped).toEqual(['0001_first.sql']);
    });
  });

  describe('failure', () => {
    it('rolls back the PARTIAL work of a failing file', async () => {
      await migration('0001_ok.sql', 'CREATE TABLE bo_ok (id INT PRIMARY KEY);');
      // First statement succeeds, second fails. If DDL were not transactional,
      // bo_doomed would survive — that is exactly what this asserts against.
      await migration(
        '0002_broken.sql',
        'CREATE TABLE bo_doomed (id INT PRIMARY KEY); SELECT this_function_does_not_exist();',
      );
      await migration('0003_never.sql', 'CREATE TABLE bo_never (id INT PRIMARY KEY);');

      await expect(new MigrationRunner(pool, directory).run()).rejects.toThrow(
        /0002_broken\.sql failed and was rolled back/,
      );

      expect(await tableExists('bo_ok')).toBe(true); // earlier file stays applied
      expect(await tableExists('bo_doomed')).toBe(false); // partial work undone
      expect(await tableExists('bo_never')).toBe(false); // stopped, did not skip ahead
      expect(await ledger()).toEqual(['0001_ok.sql']); // failure left no trace
    });

    it('retries the failed file once fixed, and continues past it', async () => {
      await migration('0001_ok.sql', 'CREATE TABLE bo_ok (id INT PRIMARY KEY);');
      await migration('0002_broken.sql', 'SELECT this_function_does_not_exist();');
      await migration('0003_after.sql', 'CREATE TABLE bo_after (id INT PRIMARY KEY);');

      await expect(new MigrationRunner(pool, directory).run()).rejects.toThrow();

      await migration('0002_broken.sql', 'CREATE TABLE bo_fixed (id INT PRIMARY KEY);');
      const result = await new MigrationRunner(pool, directory).run();

      expect(result.applied).toEqual(['0002_broken.sql', '0003_after.sql']);
      expect(await ledger()).toEqual(['0001_ok.sql', '0002_broken.sql', '0003_after.sql']);
    });

    it('releases the advisory lock even when a migration fails', async () => {
      await migration('0001_broken.sql', 'SELECT this_function_does_not_exist();');
      await expect(new MigrationRunner(pool, directory).run()).rejects.toThrow();

      // A leaked lock would make every later deployment hang forever, which is
      // a far worse outcome than the failed migration itself.
      const held = await pool.query<{ count: string }>(
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'",
      );
      expect(held.rows[0]?.count).toBe('0');
    });
  });

  /**
   * The real `migrations/` directory, not a fixture.
   *
   * Everything above proves the RUNNER behaves; this proves the schema this
   * foundation actually ships does. Text-matching the SQL cannot tell whether a
   * trigger fires.
   */
  describe('the shipped migrations', () => {
    const realMigrations = join(__dirname, '..', '..', 'migrations');

    beforeEach(async () => {
      await new MigrationRunner(pool, realMigrations).run();
    });

    it('keeps users.updated_at current on every UPDATE', async () => {
      const created = await pool.query<{ id: string }>(
        "INSERT INTO users (display_name) VALUES ('A Person') RETURNING id",
      );
      const { id } = created.rows[0]!;

      // ★ THE COMPARISON HAPPENS IN SQL, and it has to.
      //
      // `TIMESTAMPTZ` holds microseconds; a JavaScript `Date` holds whole
      // milliseconds and silently truncates the rest. Reading both values out
      // and comparing `getTime()` therefore asks a coarser question than the
      // invariant it is meant to protect: the INSERT and the UPDATE run in two
      // transactions microseconds apart, and whenever both land inside the same
      // millisecond the truncated values come back equal even though the column
      // moved exactly as it should. Measured over 200 runs of the old
      // assertion: the SQL invariant held 200/200 while `getTime()` reported
      // "not greater" once — a real trigger, a passing database, a red build.
      //
      // Keeping the comparison inside PostgreSQL removes the truncation instead
      // of waiting it out, so this needs no sleep and has no timing window.
      const check = await pool.query<{ moved_forward: boolean }>(
        `WITH previous AS (SELECT updated_at FROM users WHERE id = $1)
         UPDATE users SET display_name = 'Renamed'
         WHERE id = $1
         RETURNING users.updated_at > (SELECT updated_at FROM previous) AS moved_forward`,
        [id],
      );

      // Without the trigger this column keeps its INSERT value forever, and
      // anything built on "changed since" reads a wrong answer confidently.
      // Verified against a disabled trigger: the same statement returns false.
      expect(check.rows[0]!.moved_forward).toBe(true);
    });

    it('leaves created_at alone when a row changes', async () => {
      const created = await pool.query<{ id: string; created_at: Date }>(
        "INSERT INTO users (display_name) VALUES ('B Person') RETURNING id, created_at",
      );
      const { id, created_at: before } = created.rows[0]!;

      const after = await pool.query<{ created_at: Date }>(
        "UPDATE users SET display_name = 'Renamed' WHERE id = $1 RETURNING created_at",
        [id],
      );

      expect(after.rows[0]!.created_at.getTime()).toBe(before.getTime());
    });

    it('runs a second time without applying anything', async () => {
      // beforeEach already applied them; the trigger migration in particular
      // must survive being re-run, which DROP TRIGGER IF EXISTS is there for.
      const result = await new MigrationRunner(pool, realMigrations).run();

      expect(result.applied).toEqual([]);
      expect(result.skipped.length).toBeGreaterThan(0);
    });
  });

  describe('concurrency', () => {
    it('serialises two runners started at the same time', async () => {
      // pg_sleep keeps the first runner inside its transaction long enough
      // that the second is guaranteed to arrive while the lock is held.
      await migration(
        '0001_slow.sql',
        'SELECT pg_sleep(1); CREATE TABLE bo_once (id INT PRIMARY KEY);',
      );

      const [a, b] = await Promise.all([
        new MigrationRunner(pool, directory).run(),
        new MigrationRunner(pool, directory).run(),
      ]);

      // Exactly one applied it; the other waited, then saw it was done.
      const applied = [...a.applied, ...b.applied];
      const skipped = [...a.skipped, ...b.skipped];
      expect(applied).toEqual(['0001_slow.sql']);
      expect(skipped).toEqual(['0001_slow.sql']);

      // One table, one ledger row — no duplicate schema change.
      expect(await tableExists('bo_once')).toBe(true);
      expect(await ledger()).toEqual(['0001_slow.sql']);
    });

    it('makes the second runner WAIT rather than fail fast', async () => {
      await migration(
        '0001_slow.sql',
        'SELECT pg_sleep(1); CREATE TABLE bo_once (id INT PRIMARY KEY);',
      );

      const started = Date.now();
      await Promise.all([
        new MigrationRunner(pool, directory).run(),
        new MigrationRunner(pool, directory).run(),
      ]);

      // Both finished, and the pair took at least the sleep — proof the second
      // blocked on the lock instead of racing through on a stale ledger read.
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
    });
  });
});
