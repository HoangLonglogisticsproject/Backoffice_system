import { PERMISSIONS, PERMISSION_REQUIREMENT, PermissionKey, RoleKey } from './permission';

/**
 * Everything authorization knows about the caller, loaded fresh from the
 * database on every authorized request.
 *
 * Deliberately NOT carried in the session. A session lives twelve hours; a
 * revoked role has to stop working now. Putting any of this in the cookie or in
 * a cache would make "revoke" mean "revoke, eventually" — and the gap would be
 * invisible until the day it mattered.
 *
 * Deliberately made of RELATIONS, not of a role name. `headOf` and `memberOf`
 * are what the database actually stores; a role is a label derived from them
 * for display. Deciding permission from the relation means there is no derived
 * value that can drift out of step with the rows it came from.
 */
export interface AuthorizationContext {
  userId: string;

  /** Holds an active GLOBAL assignment — full authority, everywhere. */
  global: boolean;

  /** Departments where this caller holds the active head assignment. */
  headOf: readonly string[];

  /** Departments where this caller holds an active membership. */
  memberOf: readonly string[];

  /**
   * Their credential is a temporary one that has not been changed yet.
   *
   * Provisioning is not finished until they have chosen their own password, so
   * such a caller may authenticate but may do nothing else. Kept here rather
   * than checked at each call site so it cannot be forgotten at one of them.
   */
  mustChangeSecret: boolean;
}

/**
 * The label for this caller, for display only.
 *
 * Nothing in `can()` consults this. It exists because a UI needs a word, and
 * because the frontend's `Role` union has exactly these three values.
 */
export function roleOf(context: AuthorizationContext): RoleKey {
  if (context.global) return 'SUPERADMIN';
  if (context.headOf.length > 0) return 'DEPARTMENT_HEAD';
  return 'MEMBER';
}

/**
 * May this caller do `permission`, to `target`?
 *
 * A pure function over the context: no database, no DI, no request. That is
 * what makes the rule testable without either, and what keeps the guard a thin
 * wrapper rather than a place where policy accumulates.
 *
 * Two properties worth stating because everything else rests on them:
 *
 *   FAIL CLOSED. Every path that is not explicitly allowed returns false —
 *   including a scoped permission asked without a target, which is a caller
 *   bug, and answering "true" to it would silently grant everything.
 *
 *   PROVISIONING GATE FIRST. A caller who still holds a temporary credential is
 *   refused everything here, before any relation is considered.
 */
export function can(
  context: AuthorizationContext,
  permission: PermissionKey,
  target?: { departmentId?: string },
): boolean {
  if (context.mustChangeSecret) return false;

  // GLOBAL is the whole point of GLOBAL: every permission, every department,
  // including departments that do not exist yet.
  if (context.global) return true;

  const requirement = PERMISSION_REQUIREMENT[permission];
  if (requirement === 'global') return false;

  // Company-wide data with no departmental owner. Reached only AFTER the
  // provisioning gate above, so "any authenticated caller" never includes one
  // who is still holding a temporary credential.
  if (requirement === 'any') return true;

  // ★ ALSO COMPANY-WIDE, BUT SENIOR. Answered without a target on purpose: the
  // routes behind this tier — correcting the trip schedule — have no department
  // to name, so asking for one would refuse every head at the guard while
  // `grantedPermissions` below listed the permission anyway. Holding a head
  // assignment ANYWHERE is the whole test.
  if (requirement === 'head-anywhere') return context.headOf.length > 0;

  const departmentId = target?.departmentId;
  if (!departmentId) return false;

  return requirement === 'head'
    ? context.headOf.includes(departmentId)
    : context.memberOf.includes(departmentId);
}

/**
 * Every permission this caller holds somewhere, for `GET /authorization/me`.
 *
 * "Somewhere" is the honest reading: a head holds `unit.member.read` for their
 * own department and nowhere else, and this list cannot express that. It is a
 * hint for rendering, never an authorization decision — the server re-decides
 * each request with the target in hand.
 */
export function grantedPermissions(context: AuthorizationContext): PermissionKey[] {
  if (context.mustChangeSecret) return [];

  return PERMISSIONS.filter((permission) => {
    if (context.global) return true;

    const requirement = PERMISSION_REQUIREMENT[permission];
    if (requirement === 'global') return false;
    if (requirement === 'any') return true;

    // 'head-anywhere' falls in with 'head' by construction: both are true
    // exactly when this caller heads at least one department. They differ only
    // in `can()`, where one needs a target and the other refuses to ask for one.
    return requirement === 'head' || requirement === 'head-anywhere'
      ? context.headOf.length > 0
      : context.memberOf.length > 0;
  });
}
