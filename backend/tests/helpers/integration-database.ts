import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Database, DatabaseQuery } from '@common/types/database.port';
import type { PasswordHasher } from '@core/identity/domain/password-hasher.port';

/**
 * The bootstrap every integration spec needs, written once.
 *
 * ★ THIS IS NOT A TEST ABSTRACTION — IT IS INFRASTRUCTURE. Nothing here decides
 * anything about a case: no fixtures, no builders, no shared expectations. It
 * opens a schema, applies the migrations and adapts a `Pool` to the `Database`
 * port. Every spec still reads top to bottom on its own, which is the property
 * worth protecting when factoring test code.
 *
 * ★ WHY IT EXISTS. The same ~60 lines had been copied into each integration
 * spec — the guard clause, the hasher, the schema reset, the BEGIN/COMMIT/
 * ROLLBACK adapter. Copies drift: one spec loads migrations from disk and
 * another keeps a hand-written list that silently goes stale, which has already
 * happened in this repository. One definition cannot drift from itself.
 *
 * ⚠ It deliberately does NOT wrap `beforeAll`/`afterAll`. A helper that owns
 * the lifecycle owns the ordering too, and ordering is exactly what an
 * integration spec needs to keep in its own hands.
 */

/** Absent means "no database" — the suite skips rather than failing loudly. */
export const TEST_URL = process.env['DATABASE_URL_TEST'];

/** `describe` when a database is configured, `describe.skip` when not. */
export const describeIntegration = TEST_URL ? describe : describe.skip;

/**
 * ★ THE NAME IS THE SAFETY CATCH. These specs TRUNCATE and DROP SCHEMA. A URL
 * that does not say "test" is refused before a single statement runs, because
 * the cost of being wrong once is somebody's real data.
 */
export function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(`DATABASE_URL_TEST points at "${name}", which is not named as a test database.`);
  }
}

const digest = (plain: string): string => createHash('sha256').update(plain, 'utf8').digest('hex');

/**
 * A hasher that is fast and reversible-looking, and is neither of the things
 * scrypt is for.
 *
 * ★ ONLY EVER FOR TESTS. Real provisioning costs ~100 ms per hash by design;
 * paying that in every fixture would make the suite unusable and prove nothing
 * — what these specs assert is that a hash was STORED rather than a plaintext,
 * which this shows just as well.
 */
export const fakeHasher: PasswordHasher = {
  hash: async (plain: string) => digest(plain),
  verify: async (plain: string, hash: string) => hash === digest(plain),
  fakeVerify: async () => undefined,
};

/**
 * A private schema for one spec file, dropped and recreated first.
 *
 * Per-schema rather than per-database so specs can run against one server
 * without seeing each other's rows.
 */
export async function openTestSchema(url: string, schema: string): Promise<Pool> {
  const setup = new Pool({ connectionString: url, max: 1 });
  try {
    await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
  } finally {
    await setup.end();
  }

  return new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
}

/**
 * Every migration on disk, in filename order.
 *
 * ★ READ, NOT LISTED. A hand-kept list silently tests a stale schema the day
 * somebody adds a migration and forgets one file — which is exactly what
 * happened here between 0008 and 0010, and again at 0018.
 */
export async function applyAllMigrations(pool: Pool): Promise<void> {
  const directory = join(__dirname, '..', '..', 'migrations');
  const files = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    await pool.query(await readFile(join(directory, file), 'utf8'));
  }
}

/**
 * A `pg` pool behind the `Database` port the services expect.
 *
 * ★ REAL TRANSACTIONS, ON ONE CLIENT. `transaction` checks out a single
 * connection and issues BEGIN/COMMIT/ROLLBACK on it — anything else would run
 * the statements on different connections, where `FOR UPDATE` locks nothing and
 * the concurrency cases would pass while proving the opposite of what they say.
 */
export function poolAsDatabase(pool: Pool): Database {
  return {
    query: async <T>(text: string, params?: readonly unknown[]): Promise<T[]> =>
      (await pool.query(text, params as unknown[])).rows as T[],

    transaction: async <T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async <R>(text: string, params?: readonly unknown[]): Promise<R[]> =>
            (await client.query(text, params as unknown[])).rows as R[],
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
