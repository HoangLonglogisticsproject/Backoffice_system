import { join } from 'node:path';
import { Pool } from 'pg';
import { assertSchemaName } from '@common/database/schema-name';
import type { Database, DatabaseQuery } from '@common/types/database.port';
import type { AlertSignal } from '@core/alert/domain/alert';
import { MigrationRunner } from '@infrastructure/database/migration-runner';

/**
 * The bootstrap every integration spec needs, written once. Infrastructure,
 * not a test abstraction: it opens a schema, runs the real migrations through
 * the real runner, and adapts a `Pool` to the `Database` port.
 */

export const TEST_URL = process.env['DATABASE_URL_TEST'];

export const describeIntegration = TEST_URL ? describe : describe.skip;

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * A private schema for one spec file, dropped and recreated first, with the
 * pool's `search_path` pointed at it — exactly how the runtime pool is built.
 * The name goes through the same validator the runtime uses, so a spec cannot
 * accidentally become the injection it is guarding against.
 */
export async function openTestSchema(url: string, schema: string): Promise<Pool> {
  const name = assertSchemaName(schema);

  const setup = new Pool({ connectionString: url, max: 1 });
  try {
    await setup.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  } finally {
    await setup.end();
  }

  return new Pool({ connectionString: url, max: 8, options: `-c search_path=${name}` });
}

/** The real runner, the real files, into the spec's schema. */
export async function migrateTestSchema(pool: Pool, schema: string): Promise<void> {
  await new MigrationRunner(pool, MIGRATIONS_DIR, schema).run();
}

/** Real transactions on one client, so `FOR UPDATE` actually locks. */
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

/** The same server, a different principal. */
export function urlAs(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

/** A well-formed signal. Every field can be overridden; the subject id defaults to a fresh UUID. */
export function signal(overrides: Partial<AlertSignal> = {}): AlertSignal {
  return {
    detectorCode: 'TEST_DETECTOR',
    detectorVersion: 1,
    sourceType: 'rule',
    subjectType: 'trip',
    subjectId: crypto.randomUUID(),
    tripId: null,
    severity: 'warning',
    title: 'A test condition',
    summary: 'Seen by the test detector.',
    evidence: { observed: true },
    ...overrides,
  };
}
