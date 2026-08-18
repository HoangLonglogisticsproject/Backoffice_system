import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { User, UserStatus } from '../domain/user.entity';

interface UserRow {
  id: string;
  display_name: string;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  displayName: row.display_name,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * SQL for the person record, and nothing else.
 *
 * CREDENTIALS ARE NOT HERE. `identities` belongs to `core/identity`, which owns
 * proving who somebody is; this owns the row everything else points at. The two
 * lived in one class until the module graph showed why they should not:
 * identity needed users, users needed identity, and the cycle only disappeared
 * once each context owned its own table.
 *
 * Depends on the `Database` PORT, never on the driver, and opens no transaction
 * — that boundary belongs to the application layer.
 */
@Injectable()
export class UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<User | null> {
    const rows = await executor.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  /**
   * Inserts the person. Their credential is a separate insert, in another
   * context's repository, and both belong to ONE transaction the caller owns:
   * half an account — somebody who cannot log in — is invisible to whoever
   * created it and blocks the address from being registered again.
   */
  async insertUser(
    input: { displayName: string },
    executor: DatabaseQuery = this.db,
  ): Promise<User> {
    const rows = await executor.query<UserRow>(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING *',
      [input.displayName],
    );

    const user = rows[0];
    if (!user) throw new Error('INSERT INTO users returned no row');

    return toUser(user);
  }

  /**
   * Flips account status, only from the status the caller expected.
   *
   * `expectedCurrent` makes a second concurrent disable affect zero rows, which
   * is what lets the service answer "already disabled" instead of reporting a
   * success it did not cause.
   */
  async setStatus(
    input: { userId: string; status: UserStatus; expectedCurrent: UserStatus },
    executor: DatabaseQuery = this.db,
  ): Promise<User | null> {
    const rows = await executor.query<UserRow>(
      'UPDATE users SET status = $2 WHERE id = $1 AND status = $3 RETURNING *',
      [input.userId, input.status, input.expectedCurrent],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }
}
