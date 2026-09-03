import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { AccountStatus } from '../../../common/types/user-summary';
import { localPartOfEmail } from '../../../core/users/domain/email';
import { LOCAL_PROVIDER } from '../../../core/users/domain/user.entity';
import type { DriverAccount } from '../domain/driver-account';

interface DriverRow {
  id: string;
  display_name: string;
  status: AccountStatus;
  created_at: Date;
  subject: string | null;
}

const toDriver = (row: DriverRow): DriverAccount => ({
  id: row.id,
  displayName: row.display_name,
  username: row.subject ? localPartOfEmail(row.subject) : null,
  accountType: 'driver',
  status: row.status,
  createdAt: row.created_at,
});

/**
 * ★ THE SELECT LIST IS THE CONTRACT. Six columns are named and `*` is never
 * used: a column added to `users` or `identities` later — a hash, a flag, a
 * token — cannot arrive here by accident. The join reaches `identities` for
 * the sign-in address only, and that is the only column it takes from it.
 */
const DRIVER_COLUMNS = `u.id, u.display_name, u.status, u.created_at, i.subject`;

/**
 * Reads for Driver Management. Every query says `account_type = 'driver'`
 * itself, so no caller can widen it to an employee by leaving a filter off.
 * Writes go through the core account lifecycle; there are none here.
 */
@Injectable()
export class DriverAccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Every driver account, disabled ones included, by name. Bounded by the size
   * of the fleet's crew — the same reason the eligible-driver list is not
   * paginated — and the administrator's screen needs the retired ones too.
   */
  async listDrivers(executor: DatabaseQuery = this.db): Promise<DriverAccount[]> {
    const rows = await executor.query<DriverRow>(
      `SELECT ${DRIVER_COLUMNS}
         FROM users u
         LEFT JOIN identities i ON i.user_id = u.id AND i.provider = $1
        WHERE u.account_type = 'driver'
        ORDER BY u.display_name ASC, u.id ASC`,
      [LOCAL_PROVIDER],
    );
    return rows.map(toDriver);
  }

  /** One driver, or nothing — an employee's id answers nothing here, by the predicate. */
  async findDriver(id: string, executor: DatabaseQuery = this.db): Promise<DriverAccount | null> {
    const rows = await executor.query<DriverRow>(
      `SELECT ${DRIVER_COLUMNS}
         FROM users u
         LEFT JOIN identities i ON i.user_id = u.id AND i.provider = $1
        WHERE u.id = $2 AND u.account_type = 'driver'`,
      [LOCAL_PROVIDER, id],
    );
    return rows[0] ? toDriver(rows[0]) : null;
  }
}
