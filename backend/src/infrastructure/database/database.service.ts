import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { AppConfig } from '../../config/app.config';
import type { Database, DatabaseQuery } from '../../common/types/database.port';

/**
 * The single PostgreSQL connection pool for this deployment.
 *
 * One deployment, one database — there is no tenant routing here and no
 * per-request connection switching, because the database itself is the
 * isolation boundary.
 */
@Injectable()
export class DatabaseService implements Database, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private closed = false;

  constructor(config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      // Modest by design: a backoffice serves tens of concurrent users, not
      // thousands. Raise it when a measurement says to, not before.
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,

      /**
       * Server-side deadlines, applied when each connection starts.
       *
       * A pool of 10 is only a limit if connections come back. Without these,
       * one query that never finishes — a missing index meeting a big table, a
       * lock held by something else — keeps its connection forever, and ten of
       * those are a total outage with a healthy-looking process.
       *
       * `statement_timeout` bounds a single query. 30s is far above anything an
       * interactive backoffice screen should wait for, so it fires on genuine
       * pathology rather than on slow-but-working requests.
       *
       * `idle_in_transaction_session_timeout` bounds the worse case: a
       * transaction left open, which holds its locks as well as its connection.
       *
       * Migrations are NOT affected — `migrate.cli.ts` builds its own pool, so
       * a long DDL statement is never cut off by a limit chosen for request
       * traffic.
       */
      options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
    });

    // A pool error is emitted for idle clients dropped by the server. Without
    // a listener Node treats it as unhandled and takes the process down.
    this.pool.on('error', (error) => {
      this.logger.error(`Idle client error: ${error.message}`);
    });
  }

  /**
   * Reports reachability at boot but does NOT refuse to start.
   *
   * Deliberate: a database blip during a deploy would otherwise crash-loop the
   * service, and a crash-looping instance cannot tell anyone why. Booting
   * degraded means the health endpoint answers 503 — the load balancer keeps
   * this instance out of rotation, the operator sees the reason, and the
   * instance recovers on its own when the database returns.
   *
   * A misconfigured URL still surfaces loudly: this logs an error every boot,
   * and /health never goes green.
   */
  async onModuleInit(): Promise<void> {
    if (await this.isReachable()) {
      this.logger.log('PostgreSQL connection established');
      return;
    }

    this.logger.error(
      'PostgreSQL unreachable at boot — starting in a degraded state. ' +
        '/health will report 503 until the connection succeeds.',
    );
  }

  /**
   * Idempotent: `pg` throws "Called end on pool more than once" on a second
   * call, and a shutdown path that throws is one that hides why it ran. Two
   * signals arriving together, or a test closing an app twice, must not turn a
   * clean stop into an error.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await this.pool.end();
    this.logger.log('PostgreSQL pool closed');
  }

  async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
    const result = await this.pool.query<T & QueryResultRow>(text, params as unknown[]);
    return result.rows;
  }

  /**
   * Runs `work` inside a transaction, rolling back on any throw.
   *
   * Takes a callback rather than exposing begin/commit so a caller cannot leak
   * a client by forgetting to release it — the failure mode that silently
   * exhausts the pool under load.
   */
  async transaction<T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    // The callback receives the port, not the driver's client: core modules
    // stay free of `pg` even inside a transaction.
    const tx: DatabaseQuery = {
      query: async <R>(sql: string, params?: readonly unknown[]) => {
        const result = await client.query<R & QueryResultRow>(sql, params as unknown[]);
        return result.rows;
      },
    };

    // When ROLLBACK fails we no longer know what state the connection is in —
    // it may still have an open transaction. Returning it to the pool would
    // hand that transaction to whoever borrows it next.
    let discard = false;

    try {
      await client.query('BEGIN');
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // The ROLLBACK is guarded because it can fail on its own — a dropped
      // connection is the usual reason, and it is often the same reason the
      // work failed. Letting that second error escape would replace "unique
      // constraint violated" with "connection terminated" in the logs, hiding
      // the fact anyone actually needs.
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        discard = true;
        this.logger.error(`ROLLBACK failed: ${(rollbackError as Error).message}`);
      }
      throw error;
    } finally {
      // Truthy argument destroys the connection instead of recycling it. The
      // pool opens a fresh one on demand, so the cost is one reconnect against
      // the alternative: a poisoned connection circulating indefinitely.
      client.release(discard);
    }
  }

  /** True when the database answers. Used by the health endpoint. */
  async isReachable(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
