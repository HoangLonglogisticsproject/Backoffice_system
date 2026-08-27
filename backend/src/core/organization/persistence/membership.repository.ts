import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { Cursor, CursorAnchored } from '../../../common/pagination/cursor';
import {
  DepartmentMembership,
  EmployeeRosterRow,
  MembershipStatus,
} from '../domain/department.entity';
import type { AccountStatus } from '../../../common/types/user-summary';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

interface MembershipRow {
  id: string;
  user_id: string;
  department_id: string;
  status: MembershipStatus;
  created_at: Date;
  ended_at: Date | null;
}

/**
 * One roster line as PostgreSQL hands it back.
 *
 * `is_head` is a BOOLEAN the query computes, not a role string: the assignment
 * table has no MEMBER value to return, so the only thing SQL can honestly say
 * is whether an active head assignment was found.
 */
interface RosterRow {
  membership_id: string;
  membership_status: MembershipStatus;
  joined_at: Date;
  ended_at: Date | null;
  cursor_at: string;
  user_id: string;
  user_display_name: string;
  account_status: AccountStatus;
  department_id: string;
  department_name: string;
  is_head: boolean;
}

/**
 * The employee roster, as one query over the tables that already exist.
 *
 * ★ NO EMPLOYEE TABLE, AND THERE MUST NOT BE ONE. Everything a roster line
 * shows is already stored; the only thing missing was a read model that joins
 * it. A table would be a second, copied source of truth that drifts the first
 * time somebody transfers.
 *
 * ★ THE ROLE JOIN IS ON `membership_id`, NOT ON (user, department). 0004 gives
 * `role_assignments` a `membership_id` naming exactly which membership entitles
 * the headship, and a composite FK holds the two in agreement — so this is the
 * column the schema intends, it is indexed by 0008, and it cannot accidentally
 * match a head assignment from a DIFFERENT membership of the same person in the
 * same unit (a rejoin).
 *
 * ★ `status = 'active'` ON THE ASSIGNMENT IS LOAD-BEARING. A revoked row is
 * history — an ex-head — and counting it would keep calling somebody Trưởng
 * phòng after they were stood down.
 *
 * ★ COLUMNS ARE ALIASED, not `SELECT *`. Three tables here carry `id`, `status`
 * and `created_at`; a star would let the last one win and the mapper would read
 * a user's id as a membership's.
 *
 * INNER on both joins: `user_id` and `department_id` are NOT NULL with FKs that
 * refuse the delete, so both sides are guaranteed present, and both are 1:1 on
 * a primary key so neither can multiply a row.
 */
const ROSTER_SELECT = `
  SELECT m.id            AS membership_id,
         m.status        AS membership_status,
         m.created_at    AS joined_at,
         m.ended_at      AS ended_at,
         m.created_at::text AS cursor_at,
         u.id            AS user_id,
         u.display_name  AS user_display_name,
         u.status        AS account_status,
         d.id            AS department_id,
         d.name          AS department_name,
         (ra.id IS NOT NULL) AS is_head
    FROM department_memberships m
    JOIN users       u ON u.id = m.user_id
    JOIN departments d ON d.id = m.department_id
    LEFT JOIN role_assignments ra
           ON ra.membership_id = m.id
          AND ra.role_key = 'DEPARTMENT_HEAD'
          AND ra.status   = 'active'`;

const toRosterRow = (row: RosterRow): EmployeeRosterRow & CursorAnchored => ({
  id: row.membership_id,
  user: { id: row.user_id, displayName: row.user_display_name },
  department: { id: row.department_id, name: row.department_name },
  // The absence of an active assignment IS the MEMBER case — see `EmployeeRole`.
  role: row.is_head ? 'DEPARTMENT_HEAD' : 'MEMBER',
  membershipStatus: row.membership_status,
  accountStatus: row.account_status,
  joinedAt: row.joined_at,
  endedAt: row.ended_at,
  cursorAt: row.cursor_at,
});

const toMembership = (row: MembershipRow): DepartmentMembership => ({
  id: row.id,
  userId: row.user_id,
  departmentId: row.department_id,
  status: row.status,
  createdAt: row.created_at,
  endedAt: row.ended_at,
});

/**
 * SQL for who is in which unit, over time.
 *
 * Separate from `DepartmentRepository` because this is a different aggregate
 * with a different lifecycle: units are renamed and archived, memberships are
 * opened and closed, and the queries have nothing in common but a foreign key.
 *
 * NO TRANSACTIONS ARE OPENED HERE — see `DepartmentRepository` for why.
 */
@Injectable()
export class MembershipRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The one active membership a user holds, or null.
   *
   * Singular by contract, and the database backs that up: `uq_single_active_membership`
   * makes a second active row impossible, so this never has to choose.
   */
  async findActiveForUser(
    userId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DepartmentMembership | null> {
    const rows = await executor.query<MembershipRow>(
      "SELECT * FROM department_memberships WHERE user_id = $1 AND status = 'active'",
      [userId],
    );
    return rows[0] ? toMembership(rows[0]) : null;
  }

  /** Same, but locks the row so a transfer can end it without racing. */
  async lockActiveForUser(
    userId: string,
    executor: DatabaseQuery,
  ): Promise<DepartmentMembership | null> {
    const rows = await executor.query<MembershipRow>(
      "SELECT * FROM department_memberships WHERE user_id = $1 AND status = 'active' FOR UPDATE",
      [userId],
    );
    return rows[0] ? toMembership(rows[0]) : null;
  }

  /**
   * One page of an employee roster, oldest first.
   *
   * ★ SCOPE IS A PARAMETER, AUTHORIZATION IS NOT. `departmentId` present means
   * the department-scoped read; absent means the global one. WHICH of those a
   * caller may ask for is decided by the permission guard before this runs —
   * this method only builds the query it was asked for, and never inspects a
   * session. Putting the scope decision here would be a second, weaker copy of
   * a rule the guard already owns.
   *
   * ★ `membershipStatus` IS A PARAMETER, NOT A HARDCODED `'active'`. The old
   * member list pinned `m.status = 'active'` into the SQL, which made the
   * status column a constant and left ended memberships unreachable by any
   * query — the history was in the table and unqueryable. Passing it in is what
   * lets a SuperAdmin ask for people who have left without a second endpoint.
   * `undefined` means BOTH, for the "Tất cả" filter.
   *
   * KEYSET, not OFFSET. `(created_at, id)` is a total order answered by a
   * single index seek, so the last page costs what the first does. `id` is in
   * the comparison because `created_at` is NOT unique — provisioning several
   * people in one transaction gives them the same timestamp, and comparing the
   * timestamp alone silently loses rows at a page boundary inside a tie.
   *
   * `LIMIT $n + 1` answers `hasMore` without a `COUNT(*)`.
   */
  async listRosterPage(
    scope: {
      departmentId?: string;
      /**
       * ★ DISCLOSURE, NOT ACCESS. Whether the caller may read this employee at
       * all was decided by a guard before this ran. This narrows WHICH of the
       * rows they are shown — a head sees the periods inside the units they
       * lead and no others, so a filtered history can never mention a unit they
       * have no authority over. Absent means unfiltered, which is the global
       * caller's case.
       */
      departmentIds?: readonly string[];
      /** One person's employment history, oldest first. */
      userId?: string;
      membershipStatus?: MembershipStatus;
    },
    limit: number,
    cursor: Cursor | undefined,
    executor: DatabaseQuery = this.db,
  ): Promise<(EmployeeRosterRow & CursorAnchored)[]> {
    // Built positionally so the placeholders cannot drift from the values.
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (scope.userId !== undefined) {
      values.push(scope.userId);
      conditions.push(`m.user_id = $${values.length}`);
    }
    if (scope.departmentIds !== undefined) {
      // `= ANY($n)` rather than an IN-list built by string concatenation: one
      // placeholder whatever the length, and nothing to escape.
      values.push([...scope.departmentIds]);
      conditions.push(`m.department_id = ANY($${values.length}::uuid[])`);
    }
    if (scope.departmentId !== undefined) {
      values.push(scope.departmentId);
      conditions.push(`m.department_id = $${values.length}`);
    }
    if (scope.membershipStatus !== undefined) {
      values.push(scope.membershipStatus);
      conditions.push(`m.status = $${values.length}`);
    }
    if (cursor) {
      values.push(cursor.t, cursor.i);
      conditions.push(
        `(m.created_at, m.id) > ($${values.length - 1}::timestamptz, $${values.length})`,
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit + 1);

    const rows = await executor.query<RosterRow>(
      `${ROSTER_SELECT}
        ${where}
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT $${values.length}`,
      values,
    );

    return rows.map(toRosterRow);
  }

  async countActiveInDepartment(
    departmentId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<number> {
    const rows = await executor.query<{ count: string }>(
      "SELECT count(*) AS count FROM department_memberships WHERE department_id = $1 AND status = 'active'",
      [departmentId],
    );
    // `count()` arrives as a string: it is bigint, and the driver refuses to
    // silently narrow it to a float.
    return Number(rows[0]?.count ?? 0);
  }

  /** Full history for one person, newest first. Includes ended rows by design. */
  async listHistoryForUser(
    userId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DepartmentMembership[]> {
    const rows = await executor.query<MembershipRow>(
      'SELECT * FROM department_memberships WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map(toMembership);
  }

  async create(
    input: { userId: string; departmentId: string },
    executor: DatabaseQuery = this.db,
  ): Promise<DepartmentMembership> {
    try {
      const rows = await executor.query<MembershipRow>(
        'INSERT INTO department_memberships (user_id, department_id) VALUES ($1, $2) RETURNING *',
        [input.userId, input.departmentId],
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT INTO department_memberships returned no row');

      return toMembership(row);
    } catch (error) {
      // Hitting `uq_single_active_membership` means this person is already in a
      // unit: either the caller skipped the transfer path, or two requests
      // raced. Both are conflicts, not server errors.
      if (isUniqueViolation(error)) {
        throw new ConflictError('That user already belongs to a department.');
      }
      throw error;
    }
  }

  /**
   * Ends a membership by id, only if it is still active. Returns the row when
   * this call is the one that ended it, null when it was already ended.
   *
   * ⚠ Ending a membership leaves the user with none, which on its own is the
   * forbidden "active user belonging nowhere". Every caller must either open
   * another membership (transfer) or disable the user (removal) in the SAME
   * transaction. This stays a primitive so both flows can compose it.
   */
  async end(
    membershipId: string,
    now: Date,
    executor: DatabaseQuery,
  ): Promise<DepartmentMembership | null> {
    const rows = await executor.query<MembershipRow>(
      `UPDATE department_memberships
          SET status = 'ended', ended_at = $2
        WHERE id = $1 AND status = 'active'
        RETURNING *`,
      [membershipId, now],
    );
    return rows[0] ? toMembership(rows[0]) : null;
  }
}
