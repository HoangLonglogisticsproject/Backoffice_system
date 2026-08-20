import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { AuthorizationContext } from '../domain/authorization.context';
import type { AssignableRoleKey } from '../domain/permission';
import type { UserSummary } from '../../../common/types/user-summary';

/** SQLSTATE 23505 unique_violation / 23503 foreign_key_violation, read as data. */
const sqlState = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null
    ? ((error as { code?: string }).code ?? undefined)
    : undefined;

export interface RoleAssignment {
  id: string;
  userId: string;
  roleKey: AssignableRoleKey;
  scopeType: 'GLOBAL' | 'DEPARTMENT';
  scopeId: string | null;
  membershipId: string | null;
  status: 'active' | 'revoked';
  grantedVia: 'api' | 'bootstrap';
  grantedBy: string | null;
  grantedAt: Date;
  revokedVia: 'api' | 'bootstrap' | null;
  revokedBy: string | null;
  revokedAt: Date | null;
}

/**
 * A head assignment as the DISPLAY read returns it: the assignment, plus the
 * name of the person holding it.
 *
 * `user_id` is NOT NULL with a `NO ACTION` foreign key, so the join is INNER and
 * cannot produce a null.
 */
export interface RoleAssignmentWithUser extends RoleAssignment {
  user: UserSummary;
}

interface AssignmentRow {
  id: string;
  user_id: string;
  role_key: AssignableRoleKey;
  scope_type: 'GLOBAL' | 'DEPARTMENT';
  scope_id: string | null;
  membership_id: string | null;
  status: 'active' | 'revoked';
  granted_via: 'api' | 'bootstrap';
  granted_by: string | null;
  granted_at: Date;
  revoked_via: 'api' | 'bootstrap' | null;
  revoked_by: string | null;
  revoked_at: Date | null;
}

const toAssignment = (row: AssignmentRow): RoleAssignment => ({
  id: row.id,
  userId: row.user_id,
  roleKey: row.role_key,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  membershipId: row.membership_id,
  status: row.status,
  grantedVia: row.granted_via,
  grantedBy: row.granted_by,
  grantedAt: row.granted_at,
  revokedVia: row.revoked_via,
  revokedBy: row.revoked_by,
  revokedAt: row.revoked_at,
});

/**
 * SQL for role assignments, and the one query that builds an authorization
 * context.
 *
 * Every method takes an optional executor for the same reason the organization
 * repository does: composing into a caller's transaction is the difference
 * between an atomic hand-over and two independent commits.
 */
@Injectable()
export class AuthorizationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The caller's authorization context, in ONE round trip.
   *
   * One query rather than three because this runs on every authorized request
   * and is the query an attacker gets to schedule. Both indexes it needs are
   * partial and cover only active rows, so it reads a handful of tuples.
   *
   * `must_change_secret` is aggregated with `bool_or` over the caller's local
   * identities: a caller is gated if ANY credential they could have just
   * authenticated with is still temporary. With one local identity per user
   * today this is simply that identity's flag.
   */
  async loadContext(
    userId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<AuthorizationContext> {
    const rows = await executor.query<{
      global: boolean;
      head_of: string[] | null;
      member_of: string[] | null;
      must_change_secret: boolean | null;
    }>(
      `SELECT
         COALESCE(bool_or(ra.role_key = 'SUPERADMIN'), false) AS global,
         COALESCE(
           array_agg(DISTINCT ra.scope_id) FILTER (WHERE ra.role_key = 'DEPARTMENT_HEAD'),
           '{}'
         ) AS head_of,
         (SELECT COALESCE(array_agg(m.department_id), '{}')
            FROM department_memberships m
           WHERE m.user_id = $1 AND m.status = 'active') AS member_of,
         (SELECT COALESCE(bool_or(i.must_change_secret), false)
            FROM identities i
           WHERE i.user_id = $1) AS must_change_secret
       FROM (SELECT $1::uuid AS uid) anchor
       LEFT JOIN role_assignments ra
         ON ra.user_id = anchor.uid AND ra.status = 'active'`,
      [userId],
    );

    const row = rows[0];

    return {
      userId,
      global: row?.global ?? false,
      headOf: row?.head_of ?? [],
      memberOf: row?.member_of ?? [],
      mustChangeSecret: row?.must_change_secret ?? false,
    };
  }

  /** The caller's local login name, derived for display. Never used to authorize. */
  async findLocalSubject(
    userId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<string | null> {
    const rows = await executor.query<{ subject: string }>(
      "SELECT subject FROM identities WHERE user_id = $1 AND provider = 'local' LIMIT 1",
      [userId],
    );
    return rows[0]?.subject ?? null;
  }

  async findActiveAssignmentById(
    id: string,
    executor: DatabaseQuery = this.db,
  ): Promise<RoleAssignment | null> {
    const rows = await executor.query<AssignmentRow>(
      "SELECT * FROM role_assignments WHERE id = $1 AND status = 'active'",
      [id],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async findActiveSuperAdmin(executor: DatabaseQuery = this.db): Promise<RoleAssignment | null> {
    const rows = await executor.query<AssignmentRow>(
      "SELECT * FROM role_assignments WHERE role_key = 'SUPERADMIN' AND status = 'active'",
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async findActiveHeadOfDepartment(
    departmentId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<RoleAssignment | null> {
    const rows = await executor.query<AssignmentRow>(
      `SELECT * FROM role_assignments
        WHERE role_key = 'DEPARTMENT_HEAD' AND scope_id = $1 AND status = 'active'`,
      [departmentId],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  /**
   * The same head, for the one caller that has to SHOW them.
   *
   * A separate method rather than a join added to `findActiveHeadOfDepartment`,
   * because that one has three other callers — the approval services look the
   * head up INSIDE a transaction to decide a workflow, and none of them display
   * anything. Adding the join there would charge every one of them for a name
   * only this route prints.
   */
  async findActiveHeadOfDepartmentWithUser(
    departmentId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<RoleAssignmentWithUser | null> {
    const rows = await executor.query<AssignmentRow & { user_display_name: string }>(
      `SELECT a.id, a.user_id, a.role_key, a.scope_type, a.scope_id, a.membership_id,
              a.status, a.granted_via, a.granted_by, a.granted_at,
              a.revoked_via, a.revoked_by, a.revoked_at,
              u.display_name AS user_display_name
         FROM role_assignments a
         JOIN users u ON u.id = a.user_id
        WHERE a.role_key = 'DEPARTMENT_HEAD' AND a.scope_id = $1 AND a.status = 'active'`,
      [departmentId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      ...toAssignment(row),
      user: { id: row.user_id, displayName: row.user_display_name },
    };
  }

  async listActiveAssignmentsForUser(
    userId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<RoleAssignment[]> {
    const rows = await executor.query<AssignmentRow>(
      "SELECT * FROM role_assignments WHERE user_id = $1 AND status = 'active'",
      [userId],
    );
    return rows.map(toAssignment);
  }

  /**
   * Grants an assignment.
   *
   * Two SQLSTATEs are translated rather than allowed to surface raw, because
   * both mean something a caller can act on:
   *
   *   23505 — somebody already holds this role here (the uniqueness indexes)
   *   23503 — the head has no matching active membership (invariant #6's
   *           foreign key). The service checks first and reports it clearly;
   *           this catches the race that slips between check and write.
   */
  async grant(
    input: {
      userId: string;
      roleKey: AssignableRoleKey;
      scopeId: string | null;
      membershipId: string | null;
      grantedVia: 'api' | 'bootstrap';
      grantedBy: string | null;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<RoleAssignment> {
    try {
      const rows = await executor.query<AssignmentRow>(
        `INSERT INTO role_assignments
           (user_id, role_key, scope_type, scope_id, membership_id, granted_via, granted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.userId,
          input.roleKey,
          input.roleKey === 'SUPERADMIN' ? 'GLOBAL' : 'DEPARTMENT',
          input.scopeId,
          input.membershipId,
          input.grantedVia,
          input.grantedBy,
        ],
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT INTO role_assignments returned no row');

      return toAssignment(row);
    } catch (error) {
      const state = sqlState(error);

      if (state === '23505') {
        throw new ConflictError(
          input.roleKey === 'SUPERADMIN'
            ? 'There is already an active SuperAdmin.'
            : 'That department already has an active head.',
        );
      }

      if (state === '23503') {
        throw new ConflictError(
          'A department head must hold an active membership of the same department.',
        );
      }

      throw error;
    }
  }

  /**
   * Revokes an assignment, only if it is still active.
   *
   * Returns null when this call was not the one that revoked it, which is what
   * lets the service answer "already revoked" instead of reporting success it
   * did not achieve.
   */
  async revoke(
    input: {
      id: string;
      revokedVia: 'api' | 'bootstrap';
      revokedBy: string | null;
      now: Date;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<RoleAssignment | null> {
    const rows = await executor.query<AssignmentRow>(
      `UPDATE role_assignments
          SET status = 'revoked', revoked_at = $4, revoked_via = $2, revoked_by = $3
        WHERE id = $1 AND status = 'active'
        RETURNING *`,
      [input.id, input.revokedVia, input.revokedBy, input.now],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  /** Every active elevated assignment a user holds. Used when disabling them. */
  async revokeAllForUser(
    input: { userId: string; revokedVia: 'api' | 'bootstrap'; revokedBy: string | null; now: Date },
    executor: DatabaseQuery = this.db,
  ): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE role_assignments
          SET status = 'revoked', revoked_at = $4, revoked_via = $2, revoked_by = $3
        WHERE user_id = $1 AND status = 'active'
        RETURNING id`,
      [input.userId, input.revokedVia, input.revokedBy, input.now],
    );
    return rows.length;
  }
}
