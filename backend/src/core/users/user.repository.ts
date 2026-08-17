import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../common/errors/domain.error';
import { DATABASE, type Database } from '../../common/types/database.port';
import { Identity, LOCAL_PROVIDER, User, UserStatus, normalizeSubject } from './user.entity';

/**
 * SQLSTATE 23505 — unique_violation.
 *
 * Read as a property rather than imported from `pg`: this file depends on the
 * `Database` port and must not learn which driver is behind it. 23505 is a
 * standard SQLSTATE class, not a PostgreSQL invention, so the check survives
 * the driver changing.
 */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

interface UserRow {
  id: string;
  display_name: string;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  subject: string;
  secret_hash: string | null;
  created_at: Date;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  displayName: row.display_name,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toIdentity = (row: IdentityRow): Identity => ({
  id: row.id,
  userId: row.user_id,
  provider: row.provider,
  subject: row.subject,
  secretHash: row.secret_hash,
  createdAt: row.created_at,
});

/**
 * SQL for users and their credentials. No business rules here — those live in
 * the service, so they can be read and tested without a database.
 *
 * Depends on the `Database` PORT, never on the driver: this file has no idea
 * PostgreSQL is behind it, and `core → infrastructure` stays forbidden with no
 * exception carved out for repositories. An exception here would be the first
 * hole, and holes widen.
 */
@Injectable()
export class UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  /**
   * Returns the credential and its owner in one round trip.
   *
   * One query rather than two on purpose: this runs on every login attempt,
   * including every failed one, and it is the query an attacker gets to
   * schedule.
   */
  async findIdentityWithUser(
    provider: string,
    subject: string,
  ): Promise<{ identity: Identity; user: User } | null> {
    const rows = await this.db.query<IdentityRow & { u_id: string } & Record<string, unknown>>(
      `SELECT i.*,
              u.id           AS u_id,
              u.display_name AS u_display_name,
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
      user: toUser({
        id: row['u_id'] as string,
        display_name: row['u_display_name'] as string,
        status: row['u_status'] as UserStatus,
        created_at: row['u_created_at'] as Date,
        updated_at: row['u_updated_at'] as Date,
      }),
    };
  }

  /**
   * Creates the user and their first credential atomically.
   *
   * A transaction because half of this is worse than none: a user with no way
   * to log in is invisible to the person who created it and blocks the subject
   * from being registered again.
   */
  async createWithLocalIdentity(input: {
    displayName: string;
    subject: string;
    secretHash: string;
  }): Promise<User> {
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx.query<UserRow>(
          'INSERT INTO users (display_name) VALUES ($1) RETURNING *',
          [input.displayName],
        );

        const user = inserted[0];
        if (!user) throw new Error('INSERT INTO users returned no row');

        await tx.query(
          'INSERT INTO identities (user_id, provider, subject, secret_hash) VALUES ($1, $2, $3, $4)',
          [user.id, LOCAL_PROVIDER, normalizeSubject(input.subject), input.secretHash],
        );

        return toUser(user);
      });
    } catch (error) {
      // The service checks for a duplicate first, but two callers can pass that
      // check at the same moment and only one can win the unique index. Without
      // this, the loser gets a raw driver error — a 500 where the honest answer
      // is the same conflict the pre-check reports.
      if (isUniqueViolation(error)) {
        throw new ConflictError('That identity is already registered.');
      }
      throw error;
    }
  }

  async subjectExists(provider: string, subject: string): Promise<boolean> {
    const rows = await this.db.query<{ one: number }>(
      'SELECT 1 AS one FROM identities WHERE provider = $1 AND subject = $2',
      [provider, normalizeSubject(subject)],
    );
    return rows.length > 0;
  }
}
