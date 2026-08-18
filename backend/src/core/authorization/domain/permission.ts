/**
 * The closed set of things a caller may be allowed to do, and the relation each
 * one requires between the caller and the target.
 *
 * Closed on purpose. A guard names a permission in source, so a permission that
 * no code reads is a row nobody can act on; and letting an administrator invent
 * new keys at runtime would mean inventing the code that honours them too.
 * Roles and permissions are code; WHO HOLDS THEM is data. That split is what
 * "SuperAdmin must not be hardcoded" actually asks for.
 */
export const PERMISSIONS = [
  /** See a unit and its attributes. */
  'unit.read',
  /** Create, rename or archive a unit. */
  'unit.write',
  /** See who is in a unit. */
  'unit.member.read',
  /** Change who is in a unit. */
  'unit.member.write',
  /** Grant or revoke a role assignment. */
  'role.assign',
  /** Create an account, or change an account's status. */
  'user.write',
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

/**
 * Role CONTRACTS. Three, fixed, and never edited at runtime.
 *
 * Note that only two of them are ever stored (see `0004_authorization.sql`):
 * MEMBER is what a person is when they hold no elevated assignment, so it is
 * derived rather than recorded. A stored MEMBER row would be a second place
 * that records membership, free to contradict the first.
 */
export const ROLE_KEYS = ['SUPERADMIN', 'DEPARTMENT_HEAD', 'MEMBER'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Roles that are actually persisted as assignments. */
export const ASSIGNABLE_ROLE_KEYS = ['SUPERADMIN', 'DEPARTMENT_HEAD'] as const;
export type AssignableRoleKey = (typeof ASSIGNABLE_ROLE_KEYS)[number];

export type ScopeType = 'GLOBAL' | 'DEPARTMENT';

/**
 * What a NON-GLOBAL caller must be to the target department for each permission.
 *
 *   'head'    — must hold the active head assignment for that department
 *   'member'  — must hold the active membership of that department
 *   'global'  — no departmental relation grants this; only GLOBAL does
 *
 * This table IS the permission model, and it is deliberately expressed as a
 * relation to the target rather than as a role. Roles would need `can()` to
 * know which role a caller has and then which departments that role covers —
 * two lookups that can disagree. The relation is the thing the database already
 * stores, so there is nothing to keep in sync.
 *
 * A head necessarily also holds a membership of the same department (the
 * foreign key in 0004 guarantees it), so 'member' permissions cover heads too
 * without being listed twice.
 */
export const PERMISSION_REQUIREMENT: Readonly<Record<PermissionKey, 'head' | 'member' | 'global'>> =
  {
    'unit.read': 'member',
    'unit.member.read': 'head',
    'unit.write': 'global',
    'unit.member.write': 'global',
    'role.assign': 'global',
    'user.write': 'global',
  };

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}
