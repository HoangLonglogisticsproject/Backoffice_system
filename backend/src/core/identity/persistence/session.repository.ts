import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { UserStatus } from '../../users/domain/user.entity';

/**
 * The row `resolve` needs: the session, plus enough of its owner to decide
 * whether the session is still usable. One query rather than two because this
 * runs on every authenticated request.
 */
export interface SessionOwnerRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  u_display_name: string;
  u_status: UserStatus;
}

/**
 * SQL for sessions. No decisions — whether an expired session counts as valid
 * is the service's call, and keeping that out of here is what lets the rule be
 * read without a database in front of you.
 *
 * Every method takes an optional executor and NONE opens a transaction:
 * revoking somebody's sessions is never a standalone act. It happens while
 * their roles are being revoked, or while global authority is handed over, and
 * all of it has to commit together. `Database.transaction()` hands its callback
 * a different connection, so a caller inside a transaction passes it here —
 * otherwise this statement runs on the pool and commits on its own, a partial
 * commit that stays invisible until the surrounding transaction is the one that
 * fails.
 */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insert(
    input: { userId: string; tokenHash: string; expiresAt: Date },
    executor: DatabaseQuery = this.db,
  ): Promise<void> {
    await executor.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [input.userId, input.tokenHash, input.expiresAt],
    );
  }

  /** The session and its owner, by token hash. Null when no such session exists. */
  async findByTokenHash(
    tokenHash: string,
    executor: DatabaseQuery = this.db,
  ): Promise<SessionOwnerRow | null> {
    const rows = await executor.query<SessionOwnerRow>(
      `SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
              u.display_name AS u_display_name,
              u.status       AS u_status
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Idempotent: revoking an unknown or already-revoked token affects no row. */
  async revokeByTokenHash(
    tokenHash: string,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<void> {
    await executor.query(
      'UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash, now],
    );
  }

  async revokeAllForUser(
    userId: string,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<void> {
    await executor.query(
      'UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [userId, now],
    );
  }
}
