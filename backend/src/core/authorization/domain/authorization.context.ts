import type { DepartmentFunction } from '../../organization/domain/department.entity';
import {
  PERMISSIONS,
  PERMISSION_REQUIREMENT,
  PermissionKey,
  PermissionRequirement,
  RoleKey,
} from './permission';

/**
 * Everything authorization knows about the caller, loaded fresh from the
 * database on every authorized request.
 *
 * Deliberately NOT carried in the session. A session lives twelve hours; a
 * revoked role has to stop working now. Putting any of this in the cookie or in
 * a cache would make "revoke" mean "revoke, eventually" — and the gap would be
 * invisible until the day it mattered.
 *
 * Deliberately made of RELATIONS, not of a role name. `headOf`, `memberOf` and
 * `functions` are what the database actually stores; a role is a label derived
 * from them for display. Deciding permission from the relation means there is
 * no derived value that can drift out of step with the rows it came from.
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
   * What the departments in `memberOf` are FOR (`departments.function`, 0032),
   * with the nulls left out.
   *
   * ★ AT MOST ONE ELEMENT TODAY, and typed as a list anyway. An active person
   * holds exactly one active membership (invariant #6), and a department has
   * at most one function, so this cannot hold two — but a list says "the
   * functions of the units I am in", which stays true if either rule ever
   * changes, while a scalar would encode both rules into the type.
   *
   * ★ EMPTY FOR A DRIVER, BY CONSTRUCTION. A driver account holds no
   * membership, so there is no department to read a function off. That is
   * what keeps every `orFunction` permission away from drivers without a
   * single line saying so.
   */
  functions: readonly DepartmentFunction[];

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
 * because the frontend's `Role` union has exactly these three values. A
 * department's function does not change the word: a dispatcher is a MEMBER.
 */
export function roleOf(context: AuthorizationContext): RoleKey {
  if (context.global) return 'SUPERADMIN';
  if (context.headOf.length > 0) return 'DEPARTMENT_HEAD';
  return 'MEMBER';
}

/**
 * Does the caller sit in a department whose function this requirement names?
 *
 * ★ NO TARGET, ON PURPOSE. A function is a fact about the caller's OWN unit,
 * read off their active membership; the route's target department, where there
 * is one, says nothing about it. So this is answered the same way with or
 * without a target — which is what keeps `can()` and `grantedPermissions()`
 * agreeing, exactly as `'head-anywhere'` does.
 *
 * Absent `orFunction` is absent: no function grants the permission.
 */
const grantedByFunction = (
  context: AuthorizationContext,
  requirement: PermissionRequirement,
): boolean =>
  requirement.orFunction?.some((fn) => context.functions.includes(fn)) ?? false;

/**
 * Does the caller's unit satisfy the requirement's `withinFunction`, when it
 * has one? An AND on top of the tier — see `PermissionRequirement`. Absent
 * means unconstrained. Like the function grant above, it needs no target.
 */
const withinFunction = (
  context: AuthorizationContext,
  requirement: PermissionRequirement,
): boolean =>
  requirement.withinFunction === undefined ||
  requirement.withinFunction.some((fn) => context.functions.includes(fn));

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

  // ★ THE FUNCTION OF THE CALLER'S UNIT, ASKED BEFORE THE TIER. It is an OR:
  // a dispatcher holds `dispatch.write` whether or not they head anything, so
  // a tier of 'global' — which would otherwise refuse everybody below — is
  // not reached for them. And it is asked AFTER the two gates above, so a
  // temporary credential is still refused and a global caller still needs no
  // function.
  if (grantedByFunction(context, requirement)) return true;

  if (requirement.tier === 'global') return false;

  // ★ THE "AND" HALF. A requirement that names `withinFunction` is satisfied
  // by its tier ONLY inside one of those units — a head of HR fails
  // `trip.write` here before the tier is even read. Checked after `global`
  // (which needs no unit) and after `orFunction` (which is the OR).
  if (!withinFunction(context, requirement)) return false;

  // Company-wide data with no departmental owner. Reached only AFTER the
  // provisioning gate above, so "any authenticated caller" never includes one
  // who is still holding a temporary credential.
  if (requirement.tier === 'any') return true;

  // ★ ALSO COMPANY-WIDE, BUT SENIOR. Answered without a target on purpose: the
  // routes behind this tier — correcting the trip schedule — have no department
  // to name, so asking for one would refuse every head at the guard while
  // `grantedPermissions` below listed the permission anyway. Holding a head
  // assignment ANYWHERE is the whole test.
  if (requirement.tier === 'head-anywhere') return context.headOf.length > 0;

  const departmentId = target?.departmentId;
  if (!departmentId) return false;

  return requirement.tier === 'head'
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
    // The same OR as `can()`, and it needs no target either — so the two agree
    // for every function-granted key, which is the property this list exists
    // to keep.
    if (grantedByFunction(context, requirement)) return true;

    if (requirement.tier === 'global') return false;
    // The same AND as `can()`, target-free, so the two keep agreeing.
    if (!withinFunction(context, requirement)) return false;
    if (requirement.tier === 'any') return true;

    // 'head-anywhere' falls in with 'head' by construction: both are true
    // exactly when this caller heads at least one department. They differ only
    // in `can()`, where one needs a target and the other refuses to ask for one.
    return requirement.tier === 'head' || requirement.tier === 'head-anywhere'
      ? context.headOf.length > 0
      : context.memberOf.length > 0;
  });
}
