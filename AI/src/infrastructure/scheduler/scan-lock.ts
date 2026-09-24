import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { AppConfig } from '../../config/app.config';
import { assertSchemaName } from '../../common/database/schema-name';

/**
 * One worker per (detector, phase), enforced by PostgreSQL.
 *
 * ★ NOT "WE ONLY RUN ONE CONTAINER". That is a deployment fact today and an
 * outage tomorrow — two replicas during a rolling deploy is the normal case,
 * not the exotic one. `pg_try_advisory_lock` makes the guarantee a property
 * of the database instead of the topology.
 *
 * ★ TRY, NOT WAIT. A tick that cannot get the lock has nothing to do: another
 * worker is already scanning exactly this detector and phase. Blocking would
 * queue ticks behind each other and eventually run a scan against facts from
 * a window that has moved on.
 *
 * ★ A DEDICATED CONNECTION, HELD FOR THE WHOLE SCAN, AND NEVER INSIDE A
 * TRANSACTION. A session lock lives as long as its session, so the client is
 * checked out of a pool of its own and released in `finally`. If unlocking
 * fails the client is DESTROYED rather than recycled — a pooled connection
 * that still holds the lock would block every later scan forever. If the
 * process dies, PostgreSQL closes the session and the lock goes with it.
 *
 * Two 32-bit keys rather than one 64-bit: the first names this application's
 * lock space, the second is derived from the detector code and phase, so two
 * detectors never wait on each other.
 */

/** Arbitrary but fixed — the AI engine's lock space, not the migration runner's. */
export const SCAN_LOCK_NAMESPACE = 771_053_318;

/** A stable signed 32-bit key for `<detectorCode>:<phase>`. */
export function scanLockKey(detectorCode: string, phase: string): number {
  const digest = createHash('sha256').update(`${detectorCode}:${phase}`, 'utf8').digest();
  // `readInt32BE` keeps it inside PostgreSQL's `int4`, which is what the
  // two-argument form of pg_try_advisory_lock takes.
  return digest.readInt32BE(0);
}

export interface LockHandle {
  release(): Promise<void>;
}

@Injectable()
export class ScanLock {
  private readonly logger = new Logger(ScanLock.name);
  private readonly pool: Pool;

  constructor(config: AppConfig) {
    const schema = assertSchemaName(config.dbSchema);
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      // Small and separate from the application pool: these connections are
      // held for the length of a scan, and must never compete with request
      // traffic for the same ten slots.
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // ★ NO `statement_timeout` HERE, deliberately: this session issues only
      // the two lock statements, and a scan that outlives 30s must not have
      // its unlock cut off.
      options: `-c search_path=${schema}`,
    });
    this.pool.on('error', (error) => this.logger.error(`Idle lock-client error: ${error.message}`));
  }

  /**
   * Takes the lock, or returns `null` when somebody else holds it. The caller
   * MUST release in a `finally`.
   */
  async acquire(detectorCode: string, phase: string): Promise<LockHandle | null> {
    const key = scanLockKey(detectorCode, phase);
    const client = await this.pool.connect();

    // ★ A CHECKED-OUT CLIENT NEEDS ITS OWN ERROR LISTENER. This connection is
    // held for the whole scan, and if the server drops it meanwhile — a
    // restart, an administrator's `pg_terminate_backend`, a network blip —
    // `pg` emits `error` on the CLIENT. With nobody listening that is an
    // unhandled 'error' event, which takes the process down and stops every
    // future scan. Found by the crash case in the integration suite.
    let broken = false;
    const onError = (error: Error): void => {
      broken = true;
      this.logger.warn(`The lock connection for ${detectorCode}/${phase} was lost: ${error.message}`);
    };
    client.on('error', onError);

    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [SCAN_LOCK_NAMESPACE, key],
      );
      locked = result.rows[0]?.locked === true;
    } catch (error) {
      client.removeListener('error', onError);
      client.release(true);
      throw error;
    }

    if (!locked) {
      client.removeListener('error', onError);
      client.release();
      return null;
    }

    return {
      release: async (): Promise<void> => {
        // `broken` when the connection already died: the session is gone, so
        // PostgreSQL has released the lock and there is nothing to unlock.
        let discard = broken;
        if (!broken) {
          try {
            await client.query('SELECT pg_advisory_unlock($1, $2)', [SCAN_LOCK_NAMESPACE, key]);
          } catch (error) {
            // Destroying the client ends the session, which is what actually
            // releases the lock when the unlock statement could not.
            discard = true;
            this.logger.error(
              `Failed to release the scan lock for ${detectorCode}/${phase}: ${(error as Error).message}`,
            );
          }
        }
        client.removeListener('error', onError);
        client.release(discard);
      },
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
