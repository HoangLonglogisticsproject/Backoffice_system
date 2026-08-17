import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

/**
 * Applies `migrations/*.sql` in filename order, exactly once each.
 *
 * Hand-written rather than a migration library, and that is a deliberate
 * trade. What this needs to be is *reviewable*: a reader should be able to see
 * the whole apply algorithm in one screen and trust it. Eighty lines of
 * explicit SQL do that; a library's conventions do not, and it would be the
 * only dependency in this layer.
 *
 * Three guarantees:
 *
 *   ordered      filenames sort lexicographically, so `0001_` … `0002_` …
 *   exactly once applied versions are recorded and skipped
 *   atomic       each file runs inside a transaction; a failure rolls back
 *                that file and stops, leaving earlier ones applied
 *
 * Concurrency is handled with a session advisory lock, so two instances
 * starting at the same time cannot both apply the same file — a real failure
 * mode when a deployment scales to two replicas.
 */

/** Arbitrary but fixed: identifies *this* runner's lock, not any other. */
const ADVISORY_LOCK_KEY = 4_113_559_201;

/** Detects an edited migration, not an attacker — a plain digest is enough. */
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export class MigrationRunner {
  private readonly logger = new Logger(MigrationRunner.name);

  constructor(
    private readonly pool: Pool,
    private readonly directory: string,
  ) {}

  async run(): Promise<MigrationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
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
          // Stop at the first failure. Continuing would apply migrations out of
          // order against a schema that is no longer what they expect.
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
      // Unlock and release are separated because the unlock can fail, and if it
      // did, the lock is still held by THIS session. Returning that connection
      // to the pool would leave the lock held for as long as the connection
      // lives, and every later migration run would block on it forever.
      // Destroying the client ends the session, which PostgreSQL releases the
      // advisory lock with.
      let discard = false;
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch (error) {
        discard = true;
        this.logger.error(`Failed to release the migration lock: ${(error as Error).message}`);
      } finally {
        client.release(discard);
      }
    }
  }

  /**
   * The ledger is created by the runner rather than by a migration, because a
   * migration cannot record itself before the table it records into exists.
   */
  private async ensureLedger(client: { query: Pool['query'] }): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT        PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Added after the table already existed in the wild, so it arrives as an
    // ALTER rather than as part of the CREATE. Nullable on purpose: rows
    // recorded before checksums existed have nothing to put here.
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
  }

  private async appliedVersions(
    client: { query: Pool['query'] },
  ): Promise<Map<string, string | null>> {
    const result = await client.query<{ version: string; checksum: string | null }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    return new Map(result.rows.map((row) => [row.version, row.checksum]));
  }

  /**
   * An applied migration whose file has since changed is a silent divergence:
   * the runner skips it, so the database keeps the OLD schema while everyone
   * reading the repository sees the new text. Every later migration is then
   * written against a schema that does not exist on that server.
   *
   * Editing an applied migration is never the fix — this schema is
   * forward-only. Write a new file.
   */
  private async verifyUnchanged(
    client: { query: Pool['query'] },
    file: string,
    checksum: string,
    recorded: string | null,
  ): Promise<void> {
    if (recorded === null) {
      // Applied before this check existed. The current text is the only
      // evidence available, so record it — that makes the NEXT edit detectable,
      // which is the whole point.
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
      // No directory yet is a legitimate state: a foundation with no schema.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
