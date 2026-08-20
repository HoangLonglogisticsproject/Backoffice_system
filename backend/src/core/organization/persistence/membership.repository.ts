import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { Cursor } from '../../../common/pagination/cursor';
import { DepartmentMembership, MembershipStatus } from '../domain/department.entity';

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
   * One page of the active members of a department, oldest first.
   *
   * KEYSET, not OFFSET. `(created_at, id)` is a total order over an index that
   * answers each page with a single seek, so page 16,000 costs what page 1
   * costs. `OFFSET` would walk and discard every earlier row: measured at
   * 888,000 memberships, `OFFSET 800000` took 941.9 ms and spilled 22 MB to
   * disk against 0.279 ms for the keyset equivalent.
   *
   * `id` is in the comparison because `created_at` is NOT unique — provisioning
   * several people in one transaction gives them the same timestamp. Comparing
   * the pair as a ROW makes the order total; comparing the timestamp alone
   * silently loses rows at a page boundary that falls inside a tie.
   *
   * `LIMIT $n + 1` is how `hasMore` is answered without a `COUNT(*)` that would
   * re-scan the partition on every page.
   */
  async listActiveInDepartmentPage(
    departmentId: string,
    limit: number,
    cursor: Cursor | undefined,
    executor: DatabaseQuery = this.db,
  ): Promise<DepartmentMembership[]> {
    // Row-wise comparison, not `created_at > $2 OR (created_at = $2 AND ...)`.
    // Both are correct; this one the planner satisfies straight from the index,
    // and it is far harder to get subtly wrong.
    const rows = cursor
      ? await executor.query<MembershipRow>(
          `SELECT * FROM department_memberships
            WHERE department_id = $1 AND status = 'active'
              AND (created_at, id) > ($2, $3)
            ORDER BY created_at ASC, id ASC
            LIMIT $4`,
          [departmentId, cursor.t, cursor.i, limit + 1],
        )
      : await executor.query<MembershipRow>(
          `SELECT * FROM department_memberships
            WHERE department_id = $1 AND status = 'active'
            ORDER BY created_at ASC, id ASC
            LIMIT $2`,
          [departmentId, limit + 1],
        );

    return rows.map(toMembership);
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
