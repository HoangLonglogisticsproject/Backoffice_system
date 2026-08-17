import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationRunner } from './migration-runner';

/**
 * The runner is the only piece of the foundation that can corrupt a database,
 * so its invariants are tested rather than assumed.
 *
 * A fake client is enough here and is the right tool: what these tests assert
 * is the *sequence of statements* the runner issues — BEGIN before the file,
 * COMMIT after the ledger insert, ROLLBACK instead of COMMIT on failure. A real
 * PostgreSQL would confirm the same sequence more slowly and would make the
 * suite unrunnable on a machine without Docker.
 *
 * What a fake cannot prove is that `pg_advisory_lock` actually serialises two
 * processes. That is a property of PostgreSQL, not of this code; the test below
 * asserts only what this code is responsible for — taking the lock before
 * reading and releasing it however the run ends.
 */

/** The digest the runner records, recomputed here so tests can pin it. */
const checksumOf = (sql: string): string =>
  createHash('sha256').update(sql, 'utf8').digest('hex');

/**
 * Records every statement, and can be told to fail on one of them.
 *
 * `applied` maps a version to the checksum stored against it — `null` stands
 * for a row written before checksums existed.
 */
function fakeDatabase(
  options: { applied?: Record<string, string | null>; failOn?: string } = {},
) {
  const statements: string[] = [];
  const applied = options.applied ?? {};

  const client = {
    query: jest.fn(async (text: string, _params?: unknown[]) => {
      statements.push(text);

      if (options.failOn && text.includes(options.failOn)) {
        throw new Error('syntax error at or near "OOPS"');
      }
      if (text.includes('SELECT version, checksum FROM schema_migrations')) {
        return {
          rows: Object.entries(applied).map(([version, checksum]) => ({ version, checksum })),
        };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  return {
    statements,
    client,
    pool: { connect: jest.fn(async () => client) } as never,
    /** Statements with whitespace collapsed, for readable assertions. */
    trace: () => statements.map((s) => s.trim().replace(/\s+/g, ' ')),
  };
}

async function migrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bo-migrations-'));
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(dir, name), sql, 'utf8');
  }
  return dir;
}

describe('MigrationRunner', () => {
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const withFiles = async (files: Record<string, string>) => {
    const dir = await migrationsDir(files);
    dirs.push(dir);
    return dir;
  };

  // --- A. success ----------------------------------------------------------
  describe('applying a new migration', () => {
    it('wraps the file and its ledger entry in one transaction', async () => {
      const db = fakeDatabase();
      const dir = await withFiles({ '0001_create_thing.sql': 'CREATE TABLE thing ();' });

      const result = await new MigrationRunner(db.pool, dir).run();

      expect(result.applied).toEqual(['0001_create_thing.sql']);
      expect(result.skipped).toEqual([]);

      const trace = db.trace();
      const begin = trace.indexOf('BEGIN');
      const sql = trace.findIndex((s) => s.includes('CREATE TABLE thing'));
      const ledger = trace.findIndex((s) => s.includes('INSERT INTO schema_migrations'));
      const commit = trace.indexOf('COMMIT');

      // The ledger insert must be inside the same transaction as the file:
      // outside it, a crash between the two leaves a migration applied but
      // unrecorded, and the next run applies it twice.
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(begin).toBeLessThan(sql);
      expect(sql).toBeLessThan(ledger);
      expect(ledger).toBeLessThan(commit);
      expect(trace).not.toContain('ROLLBACK');
    });
  });

  // --- B. already applied --------------------------------------------------
  describe('a migration already in the ledger', () => {
    const SQL = 'CREATE TABLE thing ();';

    it('is skipped without executing or recording it again', async () => {
      const db = fakeDatabase({ applied: { '0001_create_thing.sql': checksumOf(SQL) } });
      const dir = await withFiles({ '0001_create_thing.sql': SQL });

      const result = await new MigrationRunner(db.pool, dir).run();

      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual(['0001_create_thing.sql']);

      const trace = db.trace();
      expect(trace.some((s) => s.includes('CREATE TABLE thing'))).toBe(false);
      expect(trace.some((s) => s.includes('INSERT INTO schema_migrations'))).toBe(false);
      expect(trace).not.toContain('BEGIN');
    });

    it('REFUSES to run when an applied file has been edited since', async () => {
      // The dangerous case, and it is silent without this check: the runner
      // skips the file, so the database keeps the old schema while everyone
      // reading the repository sees the new text.
      const db = fakeDatabase({ applied: { '0001_create_thing.sql': checksumOf(SQL) } });
      const dir = await withFiles({
        '0001_create_thing.sql': 'CREATE TABLE thing (id INT);',
      });

      await expect(new MigrationRunner(db.pool, dir).run()).rejects.toThrow(
        /was modified after it was applied/,
      );
    });

    it('backfills a checksum for a row recorded before checksums existed', async () => {
      const db = fakeDatabase({ applied: { '0001_create_thing.sql': null } });
      const dir = await withFiles({ '0001_create_thing.sql': SQL });

      const result = await new MigrationRunner(db.pool, dir).run();

      // Nothing re-runs, and the row gains a checksum — which is what makes the
      // NEXT edit detectable.
      expect(result.skipped).toEqual(['0001_create_thing.sql']);
      expect(db.trace().some((s) => s.includes('UPDATE schema_migrations SET checksum'))).toBe(
        true,
      );
    });
  });

  // --- C. failure ----------------------------------------------------------
  describe('a migration that fails', () => {
    it('rolls back, records nothing, and stops at the failure', async () => {
      const db = fakeDatabase({ failOn: 'OOPS' });
      const dir = await withFiles({
        '0001_ok.sql': 'CREATE TABLE ok ();',
        '0002_broken.sql': 'OOPS not sql;',
        '0003_never_reached.sql': 'CREATE TABLE later ();',
      });

      await expect(new MigrationRunner(db.pool, dir).run()).rejects.toThrow(/0002_broken\.sql/);

      const trace = db.trace();
      expect(trace).toContain('ROLLBACK');

      // The first file committed; the broken one recorded nothing.
      const ledgerWrites = trace.filter((s) => s.includes('INSERT INTO schema_migrations'));
      expect(ledgerWrites).toHaveLength(1);

      // Stopping matters: continuing would run 0003 against a schema that is
      // not the one it was written for.
      expect(trace.some((s) => s.includes('CREATE TABLE later'))).toBe(false);
    });

    it('releases the client and the advisory lock even when it throws', async () => {
      const db = fakeDatabase({ failOn: 'OOPS' });
      const dir = await withFiles({ '0001_broken.sql': 'OOPS;' });

      await expect(new MigrationRunner(db.pool, dir).run()).rejects.toThrow();

      expect(db.trace().at(-1)).toContain('pg_advisory_unlock');
      expect(db.client.release).toHaveBeenCalled();
    });
  });

  // --- D. ordering ---------------------------------------------------------
  describe('ordering', () => {
    it('applies files in lexical order regardless of directory order', async () => {
      const db = fakeDatabase();
      const dir = await withFiles({
        '0003_third.sql': 'SELECT 3;',
        '0001_first.sql': 'SELECT 1;',
        '0002_second.sql': 'SELECT 2;',
      });

      const result = await new MigrationRunner(db.pool, dir).run();

      expect(result.applied).toEqual(['0001_first.sql', '0002_second.sql', '0003_third.sql']);
    });

    it('ignores files that are not .sql', async () => {
      const db = fakeDatabase();
      const dir = await withFiles({
        '0001_real.sql': 'SELECT 1;',
        'README.md': '# not a migration',
        'notes.txt': 'scratch',
      });

      const result = await new MigrationRunner(db.pool, dir).run();

      expect(result.applied).toEqual(['0001_real.sql']);
    });
  });

  // --- E. concurrency ------------------------------------------------------
  describe('concurrency', () => {
    it('takes the advisory lock before reading the ledger and releases it after', async () => {
      const db = fakeDatabase();
      const dir = await withFiles({ '0001_thing.sql': 'SELECT 1;' });

      await new MigrationRunner(db.pool, dir).run();

      const trace = db.trace();
      const lock = trace.findIndex((s) => s.includes('pg_advisory_lock'));
      const ledgerRead = trace.findIndex((s) => s.includes('SELECT version, checksum FROM schema_migrations'));

      // Reading the ledger before locking is the race: two replicas would both
      // see the migration as unapplied and both would apply it.
      expect(lock).toBe(0);
      expect(lock).toBeLessThan(ledgerRead);
      expect(trace.at(-1)).toContain('pg_advisory_unlock');
    });

    it('creates the ledger table before reading it', async () => {
      const db = fakeDatabase();
      const dir = await withFiles({});

      await new MigrationRunner(db.pool, dir).run();

      const trace = db.trace();
      const create = trace.findIndex((s) => s.includes('CREATE TABLE IF NOT EXISTS schema_migrations'));
      const read = trace.findIndex((s) => s.includes('SELECT version, checksum FROM schema_migrations'));

      expect(create).toBeGreaterThanOrEqual(0);
      expect(create).toBeLessThan(read);
    });
  });

  // --- a foundation with no schema yet is a legitimate state ---------------
  it('treats a missing migrations directory as "nothing to apply"', async () => {
    const db = fakeDatabase();

    await expect(
      new MigrationRunner(db.pool, join(tmpdir(), 'bo-does-not-exist-' + Date.now())).run(),
    ).resolves.toEqual({ applied: [], skipped: [] });

    expect(db.client.release).toHaveBeenCalled();
  });
});
