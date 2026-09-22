import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AI_MIGRATION_LOCK_KEY, MigrationRunner } from '@infrastructure/database/migration-runner';
import { MIGRATIONS_DIR, TEST_URL, describeIntegration } from '../helpers/integration-database';

/**
 * The AI migration runner against a REAL PostgreSQL, inside a throwaway
 * schema. What only a real server can settle: DDL rolls back, the ledger is
 * in the AI schema and not in public, the advisory lock serialises, and the
 * real 0001 applies cleanly and then reports nothing pending.
 */
const SCHEMA = 'ai_itest_runner';

/** The backend's constant, copied as DATA so the two keys are pinned apart without an import. */
const BACKEND_MIGRATION_LOCK_KEY = 4_113_559_201;

describeIntegration('AI MigrationRunner against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let directory: string;

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_URL, max: 4 });
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-migrations-'));
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const migration = (name: string, sql: string) => writeFile(join(directory, name), sql, 'utf8');

  const tableExists = async (name: string): Promise<boolean> => {
    const result = await pool.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [
      `${SCHEMA}.${name}`,
    ]);
    return result.rows[0]?.ok === true;
  };

  const ledger = async (): Promise<string[]> => {
    const result = await pool.query<{ version: string }>(
      `SELECT version FROM "${SCHEMA}".schema_migrations ORDER BY version`,
    );
    return result.rows.map((row) => row.version);
  };

  it('uses a lock key that is not the backend runner\'s', () => {
    expect(AI_MIGRATION_LOCK_KEY).not.toBe(BACKEND_MIGRATION_LOCK_KEY);
  });

  it('refuses a schema name that is not a plain identifier, before touching the database', () => {
    expect(() => new MigrationRunner(pool, directory, 'ai; DROP SCHEMA public')).toThrow(/Refusing schema name/);
    expect(() => new MigrationRunner(pool, directory, 'Ai')).toThrow(/Refusing schema name/);
    expect(() => new MigrationRunner(pool, directory, 'ai,public')).toThrow(/Refusing schema name/);
    expect(() => new MigrationRunner(pool, directory, '"ai"')).toThrow(/Refusing schema name/);
  });

  it('creates the schema when absent, applies files in order, and records them IN that schema', async () => {
    await migration('0001_first.sql', 'CREATE TABLE ai_first (id INT PRIMARY KEY);');
    await migration('0002_second.sql', 'ALTER TABLE ai_first ADD COLUMN label TEXT;');

    const result = await new MigrationRunner(pool, directory, SCHEMA).run();

    expect(result.applied).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(await tableExists('ai_first')).toBe(true);
    expect(await ledger()).toEqual(['0001_first.sql', '0002_second.sql']);

    // The ledger lives in the AI schema, never in public.
    const inPublic = await pool.query<{ ok: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok",
    );
    // public may or may not hold the backend's ledger on this server; what
    // must be true is that OUR run did not create rows there.
    if (inPublic.rows[0]?.ok) {
      const stray = await pool.query(
        "SELECT 1 FROM public.schema_migrations WHERE version IN ('0001_first.sql', '0002_second.sql')",
      );
      expect(stray.rowCount).toBe(0);
    }
  });

  it('skips everything on a second run and changes nothing', async () => {
    await migration('0001_first.sql', 'CREATE TABLE ai_first (id INT PRIMARY KEY);');
    await new MigrationRunner(pool, directory, SCHEMA).run();

    const second = await new MigrationRunner(pool, directory, SCHEMA).run();

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001_first.sql']);
    expect(await ledger()).toEqual(['0001_first.sql']);
  });

  it('rolls back a failing file and records nothing for it', async () => {
    await migration('0001_first.sql', 'CREATE TABLE ai_first (id INT PRIMARY KEY);');
    await migration('0002_bad.sql', 'CREATE TABLE ai_second (id INT); THIS IS NOT SQL;');

    await expect(new MigrationRunner(pool, directory, SCHEMA).run()).rejects.toThrow(/0002_bad\.sql failed/);

    expect(await tableExists('ai_first')).toBe(true);
    expect(await tableExists('ai_second')).toBe(false);
    expect(await ledger()).toEqual(['0001_first.sql']);
  });

  it('refuses an applied file whose text has changed', async () => {
    await migration('0001_first.sql', 'CREATE TABLE ai_first (id INT PRIMARY KEY);');
    await new MigrationRunner(pool, directory, SCHEMA).run();

    await migration('0001_first.sql', 'CREATE TABLE ai_first (id INT PRIMARY KEY, edited TEXT);');

    await expect(new MigrationRunner(pool, directory, SCHEMA).run()).rejects.toThrow(/modified after it was applied/);
  });

  it('serialises two concurrent runs: both finish, the ledger has one row', async () => {
    await migration('0001_first.sql', 'CREATE TABLE ai_first (id INT PRIMARY KEY);');

    const results = await Promise.all([
      new MigrationRunner(pool, directory, SCHEMA).run(),
      new MigrationRunner(pool, directory, SCHEMA).run(),
    ]);

    const applied = results.flatMap((r) => r.applied);
    expect(applied).toEqual(['0001_first.sql']);
    expect(await ledger()).toEqual(['0001_first.sql']);
  });

  it('leaves the borrowed connection without a stale search_path', async () => {
    await migration('0001_first.sql', 'CREATE TABLE ai_first (id INT PRIMARY KEY);');
    const single = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await new MigrationRunner(single, directory, SCHEMA).run();
      const after = await single.query<{ search_path: string }>('SHOW search_path');
      expect(after.rows[0]?.search_path).not.toContain(SCHEMA);
    } finally {
      await single.end();
    }
  });

  describe('the real migrations', () => {
    it('apply cleanly, create the three tables, and then report nothing pending', async () => {
      const first = await new MigrationRunner(pool, MIGRATIONS_DIR, SCHEMA).run();
      expect(first.applied).toContain('0001_alerts.sql');

      for (const table of ['alerts', 'alert_transition_history', 'scan_runs', 'schema_migrations']) {
        expect(await tableExists(table)).toBe(true);
      }

      const second = await new MigrationRunner(pool, MIGRATIONS_DIR, SCHEMA).run();
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(first.applied);
    });

    it('create no foreign key that leaves the AI schema', async () => {
      await new MigrationRunner(pool, MIGRATIONS_DIR, SCHEMA).run();

      const foreign = await pool.query<{ conname: string; target: string }>(
        `SELECT c.conname, confrelid::regclass::text AS target
           FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.contype = 'f' AND n.nspname = $1
            AND (SELECT nspname FROM pg_namespace WHERE oid = (SELECT relnamespace FROM pg_class WHERE oid = c.confrelid)) <> $1`,
        [SCHEMA],
      );
      expect(foreign.rows).toEqual([]);
    });
  });
});
