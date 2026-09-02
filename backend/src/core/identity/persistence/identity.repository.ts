import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  Identity,
  LOCAL_PROVIDER,
  User,
  AccountType,
  UserStatus,
  normalizeSubject,
} from '../../users/domain/user.entity';

/**
 * SQLSTATE 23505 — unique_violation. Read as a property rather than imported
 * from `pg`: this file depends on the `Database` port and must not learn which
 * driver is behind it.
 */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  subject: string;
  secret_hash: string | null;
  must_change_secret: boolean;
  created_at: Date;
}

const toIdentity = (row: IdentityRow): Identity => ({
  id: row.id,
  userId: row.user_id,
  provider: row.provider,
  subject: row.subject,
  secretHash: row.secret_hash,
  mustChangeSecret: row.must_change_secret,
  createdAt: row.created_at,
});

/**
 * SQL for credentials — how somebody proves who they are.
 *
 * OWNS `identities`. `core/users` owns `users`, and the split is what keeps the
 * module graph acyclic: identity reads the person row in one login join, but
 * every WRITE to a table belongs to exactly one context.
 *
 * Opens no transaction. Provisioning creates a person, a credential and a
 * membership together, and only the application layer knows that.
 */
@Injectable()
export class IdentityRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The credential and its owner in ONE round trip.
   *
   * One query rather than two on purpose: this runs on every login attempt,
   * including every failed one, and it is the query an attacker gets to
   * schedule. Reading `users` here is a cross-context READ for a hot path;
   * writes to that table stay with `core/users`.
   */
  async findWithUserBySubject(
    provider: string,
    subject: string,
    executor: DatabaseQuery = this.db,
  ): Promise<{ identity: Identity; user: User } | null> {
    const rows = await executor.query<
      IdentityRow & Record<string, unknown>
    >(
      `SELECT i.*,
              u.id           AS u_id,
              u.display_name AS u_display_name,
              u.account_type AS u_account_type,
              u.status       AS u_status,
              u.created_at   AS u_created_at,
              u.updated_at   AS u_updated_at
         FROM identities i
         JOIN users u ON u.id = i.user_id
        WHERE i.provider = $1 AND i.subject = $2`,
      [provider, normalizeSubject(subject)],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      identity: toIdentity(row),
      user: {
        id: row['u_id'] as string,
        displayName: row['u_display_name'] as string,
        accountType: row['u_account_type'] as AccountType,
        status: row['u_status'] as UserStatus,
        createdAt: row['u_created_at'] as Date,
        updatedAt: row['u_updated_at'] as Date,
      },
    };
  }

  async findLocalForUser(
    userId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<Identity | null> {
    const rows = await executor.query<IdentityRow>(
      'SELECT * FROM identities WHERE user_id = $1 AND provider = $2',
      [userId, LOCAL_PROVIDER],
    );
    return rows[0] ? toIdentity(rows[0]) : null;
  }

  async subjectExists(
    provider: string,
    subject: string,
    executor: DatabaseQuery = this.db,
  ): Promise<boolean> {
    const rows = await executor.query<{ one: number }>(
      'SELECT 1 AS one FROM identities WHERE provider = $1 AND subject = $2',
      [provider, normalizeSubject(subject)],
    );
    return rows.length > 0;
  }

  async insertLocal(
    input: { userId: string; subject: string; secretHash: string; mustChangeSecret?: boolean },
    executor: DatabaseQuery = this.db,
  ): Promise<void> {
    try {
      await executor.query(
        `INSERT INTO identities (user_id, provider, subject, secret_hash, must_change_secret)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.userId,
          LOCAL_PROVIDER,
          normalizeSubject(input.subject),
          input.secretHash,
          input.mustChangeSecret ?? false,
        ],
      );
    } catch (error) {
      // The service checks for a duplicate first, but two callers can pass that
      // check in the same instant and only one can win the unique index. The
      // loser must get the same conflict, not a raw driver error as a 500.
      if (isUniqueViolation(error)) {
        throw new ConflictError('That identity is already registered.');
      }
      throw error;
    }
  }

  /**
   * Replaces a credential and clears the temporary flag in ONE statement.
   *
   * One statement rather than two so a crash cannot leave a changed password
   * still marked temporary — which would trap the owner on the change-password
   * screen holding a secret only they know.
   */
  async replaceLocalSecret(
    input: { userId: string; secretHash: string },
    executor: DatabaseQuery = this.db,
  ): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE identities
          SET secret_hash = $2, must_change_secret = false
        WHERE user_id = $1 AND provider = $3
        RETURNING id`,
      [input.userId, input.secretHash, LOCAL_PROVIDER],
    );
    return rows.length;
  }
}
