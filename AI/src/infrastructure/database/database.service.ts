import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { AppConfig } from '../../config/app.config';
import type { Database, DatabaseQuery } from '../../common/types/database.port';
import { assertSchemaName } from '../../common/database/schema-name';

/**
 * The single PostgreSQL pool for this service — the backend's adapter, with
 * one addition: every connection starts with `search_path` set to the AI
 * schema, so no query in this codebase ever names a schema and no query can
 * reach `public.*` by accident. (Reaching it on purpose is refused by the
 * grants — see scripts/provision-ai-roles.sql.)
 */
@Injectable()
export class DatabaseService implements Database, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private closed = false;

  constructor(config: AppConfig) {
    // Validated by the env schema already; asserted again here because this
    // is the line that splices it into a connection option.
    const schema = assertSchemaName(config.dbSchema);

    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      options: `-c search_path=${schema} -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000`,
    });

    this.pool.on('error', (error) => {
      this.logger.error(`Idle client error: ${error.message}`);
    });
  }

  /** Reports reachability at boot but does NOT refuse to start — /health says 503 instead. */
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

  async transaction<T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    const tx: DatabaseQuery = {
      query: async <R>(sql: string, params?: readonly unknown[]) => {
        const result = await client.query<R & QueryResultRow>(sql, params as unknown[]);
        return result.rows;
      },
    };

    let discard = false;

    try {
      await client.query('BEGIN');
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        discard = true;
        this.logger.error(`ROLLBACK failed: ${(rollbackError as Error).message}`);
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
