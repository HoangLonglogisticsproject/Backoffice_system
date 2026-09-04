import { Inject, Injectable } from '@nestjs/common';
import type { Cursor, CursorAnchored } from '../../../common/pagination/cursor';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { AccountStatus } from '../../../common/types/user-summary';
import { localPartOfEmail } from '../../../core/users/domain/email';
import type { DriverAccountRow } from '../domain/driver-account';

/**
 * SQL for the driver roster. Opens no transaction; decides nothing.
 *
 * ★ IT READS `users` AND `identities`, WHICH ARE CORE TABLES, and that is not a
 * boundary being crossed sideways. The same file's neighbour already joins
 * `users` twice to name a requester and a decider; what a capability may not do
 * is own core's writes, and nothing here writes anything.
 */

interface DriverAccountJoinedRow {
  user_id: string;
  display_name: string;
  account_status: AccountStatus;
  created_at: Date;
  /**
   * ★ TEXT AT FULL PRECISION, AND `toPage` DEPENDS ON IT. `created_at` is
   * `timestamptz` with sub-millisecond digits on every real row; turning it into
   * a JavaScript `Date` to build a cursor truncates to milliseconds, and a page
   * boundary that lands inside the truncated tie returns rows twice and loses
   * others. The exact bytes PostgreSQL sorted by are the bytes that travel.
   */
  cursor_at: string;
  /** `identities.subject` — the email. `null` only if no local identity exists. */
  subject: string | null;
}

/**
 * The projection.
 *
 * LEFT JOIN on `identities`, not INNER: an account with no local credential is
 * not something provisioning can produce, but an INNER JOIN would silently drop
 * such a row from the roster — which is the one place somebody would go to find
 * out that it is broken.
 *
 * `provider = 'local'` is in the JOIN condition rather than the WHERE for the
 * same reason: in the WHERE it would turn the outer join back into an inner one
 * the moment a federated provider is added.
 */
const DRIVER_ACCOUNT_SELECT = `
  SELECT u.id             AS user_id,
         u.display_name   AS display_name,
         u.status         AS account_status,
         u.created_at     AS created_at,
         u.created_at::text AS cursor_at,
         i.subject        AS subject
    FROM users u
    LEFT JOIN identities i ON i.user_id = u.id AND i.provider = 'local'`;

const toDriverAccount = (row: DriverAccountJoinedRow): DriverAccountRow & CursorAnchored => ({
  id: row.user_id,
  cursorAt: row.cursor_at,
  user: { id: row.user_id, displayName: row.display_name },
  // ★ THE SAME FUNCTION PROVISIONING USED. `AccountProvisioningService` derives
  // the username from the email with `localPartOfEmail` and hands it to whoever
  // created the account; deriving it any other way here would eventually print
  // a different string for the same person.
  username: row.subject === null ? null : localPartOfEmail(row.subject),
  accountStatus: row.account_status,
  createdAt: row.created_at,
});

@Injectable()
export class DriverAccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * One page of driver accounts, NEWEST FIRST.
   *
   * ★ NEWEST FIRST, UNLIKE THE EMPLOYEE ROSTER, and the difference is what the
   * list is for. The roster is browsed; this is checked — the account somebody
   * just created is the one they came here to see, so it is the one at the top.
   *
   * KEYSET, like every list in this API except the dispatch board. `id` is in
   * the comparison because `created_at` is not unique: several accounts
   * provisioned in one transaction share a timestamp, and comparing the
   * timestamp alone loses rows inside such a tie at a page boundary.
   * `idx_users_account_type_page` (0022) answers this in the direction written
   * here, tiebreaker included.
   *
   * `LIMIT $n + 1` is how `toPage` knows whether another page exists, without a
   * `COUNT(*)` that would re-scan on every page.
   */
  async listPage(
    filter: { accountStatus?: AccountStatus },
    limit: number,
    cursor: Cursor | undefined,
    executor: DatabaseQuery = this.db,
  ): Promise<(DriverAccountRow & CursorAnchored)[]> {
    // Built positionally so the placeholders cannot drift from the values.
    const values: unknown[] = ['driver'];
    const conditions: string[] = [`u.account_type = $1`];

    if (filter.accountStatus !== undefined) {
      values.push(filter.accountStatus);
      conditions.push(`u.status = $${values.length}`);
    }
    if (cursor) {
      values.push(cursor.t, cursor.i);
      conditions.push(
        `(u.created_at, u.id) < ($${values.length - 1}::timestamptz, $${values.length})`,
      );
    }

    values.push(limit + 1);

    const rows = await executor.query<DriverAccountJoinedRow>(
      `${DRIVER_ACCOUNT_SELECT}
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $${values.length}`,
      values,
    );

    return rows.map(toDriverAccount);
  }
}
