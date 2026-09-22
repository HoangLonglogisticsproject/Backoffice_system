import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { assertSchemaName, quotedSchema } from '../../common/database/schema-name';

/**
 * Applies `migrations/*.sql` in filename order, exactly once each, INSIDE the
 * AI schema.
 *
 * The backend's runner, re-implemented here rather than imported: the two
 * applications share a doctrine (ordered, exactly once, atomic per file,
 * checksummed, forward-only, serialised by an advisory lock) and nothing else.
 * Importing across `backend/src` would make this service's deploy depend on
 * the backend's source tree, which is the coupling ADR-0007 forbids.
 *
 * What differs from the backend's:
 *
 *   schema      every file runs with `search_path` set to the AI schema, so
 *               migrations name tables unqualified and land in `ai.*`; the
 *               ledger `schema_migrations` lands there too, so the backend's
 *               `public.schema_migrations` is never touched
 *   lock key    a DIFFERENT constant, so an AI migration and a backend
 *               migration running in the same deploy do not wait on each other
 */

/** Arbitrary but fixed, and not the backend's 4_113_559_201. */
export const AI_MIGRATION_LOCK_KEY = 2_071_946_113;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export class MigrationRunner {
  private readonly logger = new Logger(MigrationRunner.name);
  private readonly schema: string;

  constructor(
    private readonly pool: Pool,
    private readonly directory: string,
    schema: string,
  ) {
    // Refused HERE, at construction, so a bad name never reaches a statement.
    this.schema = assertSchemaName(schema);
  }

  async run(): Promise<MigrationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [AI_MIGRATION_LOCK_KEY]);
      await this.ensureSchema(client);
      await client.query(`SET search_path TO ${quotedSchema(this.schema)}`);
      await this.ensureLedger(client);

      const files = await this.migrationFiles();
      const already = await this.appliedVersions(client);

      const applied: string[] = [];
      const skipped: string[] = [];

      for (const file of files) {
        const sql = await readFile(join(this.directory, file), 'utf8');
        const checksum = sha256(sql);

        if (already.has(file)) {
          await this.verifyUnchanged(client, file, checksum, already.get(file) ?? null);
          skipped.push(file);
          continue;
        }

        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
            file,
            checksum,
          ]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(
            `Migration ${file} failed and was rolled back: ${(error as Error).message}`,
          );
        }

        applied.push(file);
        this.logger.log(`Applied ${file}`);
      }

      if (applied.length === 0) {
        this.logger.log(`Schema up to date (${skipped.length} migration(s) already applied)`);
      }

      return { applied, skipped };
    } finally {
      // Unlock and release are separate because the unlock can fail; a held
      // lock on a recycled connection would block every later run forever.
      // Destroying the client ends the session, which releases the lock.
      let discard = false;
      try {
        await client.query('RESET search_path');
        await client.query('SELECT pg_advisory_unlock($1)', [AI_MIGRATION_LOCK_KEY]);
      } catch (error) {
        discard = true;
        this.logger.error(`Failed to release the migration lock: ${(error as Error).message}`);
      } finally {
        client.release(discard);
      }
    }
  }

  /**
   * Creates the schema ONLY when it is absent.
   *
   * ★ NOT `CREATE SCHEMA IF NOT EXISTS`. PostgreSQL checks the CREATE privilege
   * on the database BEFORE it checks for existence, so `IF NOT EXISTS` issued
   * by `ai_migrator` — who owns the schema but may not create schemas — would
   * fail even though there is nothing to create. Asking the catalogue first
   * means a provisioned deployment never issues the CREATE at all; only a
   * developer's superuser database, or a test schema, ever does.
   */
  private async ensureSchema(client: PoolClient): Promise<void> {
    const exists = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [
      this.schema,
    ]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE SCHEMA ${quotedSchema(this.schema)}`);
      this.logger.warn(
        `Created schema ${this.schema} — in production it is provisioned by scripts/provision-ai-roles.sql, owned by ai_migrator`,
      );
    }
  }

  /** The ledger is created by the runner because a migration cannot record itself first. */
  private async ensureLedger(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT        PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        checksum    TEXT        NOT NULL
      )
    `);
  }

  private async appliedVersions(client: PoolClient): Promise<Map<string, string | null>> {
    const result = await client.query<{ version: string; checksum: string | null }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    return new Map(result.rows.map((row) => [row.version, row.checksum]));
  }

  /** An applied migration whose file has since changed is a silent divergence — refuse. */
  private async verifyUnchanged(
    client: PoolClient,
    file: string,
    checksum: string,
    recorded: string | null,
  ): Promise<void> {
    if (recorded === null) {
      await client.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [
        file,
        checksum,
      ]);
      this.logger.warn(`Recorded a checksum for the previously applied ${file}`);
      return;
    }

    if (recorded !== checksum) {
      throw new Error(
        `Migration ${file} was modified after it was applied ` +
          `(recorded ${recorded.slice(0, 12)}…, file is ${checksum.slice(0, 12)}…). ` +
          'Migrations are forward-only: restore the file and add a new migration instead.',
      );
    }
  }

  private async migrationFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.directory);
      return entries.filter((name) => name.endsWith('.sql')).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
