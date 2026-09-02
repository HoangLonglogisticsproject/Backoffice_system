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
  /** See the trip schedule, and the vehicle / customer catalogues behind it. */
  'trip.read',
  /** Add a row to the trip schedule, or a vehicle / customer to the catalogues. */
  'trip.create',
  /**
   * Edit, restatus or archive a trip row — including rows somebody else wrote.
   * Held by a GLOBAL caller and by any department head; see the requirement
   * table below for why "any department" is the honest reading here.
   */
  'trip.write',

  /** See the money on a trip: its cost lines, its hires, and their totals. */
  'cost.read',
  /** Record a cost line or an outsourced hire against a trip. */
  'cost.create',
  /** Withdraw one, with a reason. There is no edit — a correction is a void. */
  'cost.void',

  /**
   * ★ ONE KEY FOR BOTH DECISIONS, NOT TWO.
   *
   * Approving and rejecting a completion are the same authority used two ways —
   * the reviewer looked at the trip and said yes or no. Splitting them would
   * create a holder who may send work back but never accept it, which is not a
   * role anybody has asked for and not one the contract describes.
   *
   * The action is REVIEW, and the two outcomes are what the route says.
   */
  'trip.complete.review',

  /**
   * ★ PROPOSE A DRIVER ACCOUNT — AND NOTHING MORE.
   *
   * Holding this lets somebody put a name and an address in front of a global
   * administrator. It does not create an account, does not activate one, and
   * carries no route that could. Approving is `user.write`, which is `'global'`
   * and which no department head holds — that separation is the whole design.
   *
   * ★ ONE KEY, NOT ONE PER DEPARTMENT. Operations and Accounting were named
   * separately in the requirement, but they are the same act by the same kind
   * of person: a head, proposing. `'head-anywhere'` says exactly that and stays
   * true when a third department starts hiring drivers. Keys named after
   * departments would turn the org chart into the permission set.
   */
  'driver.account.request',
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
 *   'any'           — no relation required; any authenticated caller holds this
 *   'head'          — must hold the active head assignment for that department
 *   'member'        — must hold the active membership of that department
 *   'head-anywhere' — must be head of SOME department; the target is not asked
 *   'global'        — no departmental relation grants this; only GLOBAL does
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
 *
 * ★ WHY 'any' EXISTS, AND WHY IT IS NOT A HOLE. The four department-scoped
 * relations cannot express "company-wide data every employee works with" — the
 * trip schedule belongs to no department, so scoping it to one would be an
 * invention rather than a fact. Without this tier such a route would have to
 * drop `PermissionGuard` and run on `AuthGuard` alone, which ALSO drops the
 * `mustChangeSecret` gate that only the guards enforce (see `permission.guard`).
 * That is the actual hole this tier closes.
 *
 * It stays fail-closed because it is a value that must be WRITTEN HERE for a
 * specific key. A permission with no entry does not become 'any'; it does not
 * typecheck. And `can()` still refuses an 'any' permission to a caller whose
 * temporary credential is unchanged, because that check runs first.
 *
 * ★ WHY 'head-anywhere' EXISTS, AND WHY 'head' COULD NOT BE REUSED. It answers
 * "a senior caller, on company-wide data" — the combination the other four
 * cannot spell. 'head' is a relation to a TARGET department, and `can()` fails
 * closed when a scoped requirement is asked with no target; the trip routes
 * declare no target because a trip belongs to no department. So marking
 * `trip.write` as 'head' would refuse every head at the guard while
 * `grantedPermissions` — which has no target either, and answers "somewhere" —
 * happily listed it. The client would draw the edit button and the server would
 * answer 403 to it. This tier is the one shape that keeps those two agreeing.
 *
 * ⚠ IT IS DELIBERATELY NOT "head of the department that owns the row", because
 * there is no such department. A head of Sales may correct a trip nobody in
 * Sales entered. That is the price of putting company-wide data behind a
 * departmental role, and it is accepted here: heads are the shift seniors
 * dispatch escalates a mistyped row to.
 */
export type PermissionRequirement = 'any' | 'head' | 'member' | 'head-anywhere' | 'global';

export const PERMISSION_REQUIREMENT: Readonly<Record<PermissionKey, PermissionRequirement>> = {
  'unit.read': 'member',
  'unit.member.read': 'head',
  'unit.write': 'global',
  'unit.member.write': 'global',
  'role.assign': 'global',
  'user.write': 'global',

  // The trip schedule is dispatch's shared working record: everybody reads it
  // and everybody adds rows to it. Correcting a row is still administration —
  // it changes what a past trip appears to say — but administration a shift
  // senior performs, not one that waits for a GLOBAL administrator. See the
  // capability README for the decision.
  'trip.read': 'any',
  'trip.create': 'any',
  'trip.write': 'head-anywhere',

  /**
   * ★ MONEY IS 'global' — THE MOST RESTRICTIVE TIER — AND THIS IS A DELIBERATE
   * PLACEHOLDER, NOT A FINISHED ANSWER.
   *
   * The requirement on record is that price visibility is RESTRICTED, and that
   * the people who need it are a small group. Which group, expressed as which
   * holders, is a role-mapping decision nobody has taken yet.
   *
   * Until it is taken this fails CLOSED. 'any' would hand every finished
   * account the company's cost base, and the difference between the two
   * mistakes is not symmetric: a tier that is too tight blocks work until
   * somebody widens it, while a tier that is too loose has already disclosed
   * the figures by the time anyone notices. Relaxing this later is one edit to
   * this table; un-disclosing is not possible.
   *
   * ⚠ NO ROLE IS NAMED HERE OR ANYWHERE ELSE. 'global' is a RELATION — a
   * caller whose authorization is not scoped to a department — and which
   * accounts hold it stays data, exactly as it is for every other permission.
   */
  'cost.read': 'global',
  'cost.create': 'global',
  'cost.void': 'global',

  /**
   * ★ 'global' BECAUSE THE CONTRACT NAMES ONE ACTOR, NOT BECAUSE IT IS SAFEST.
   *
   * Confirming that a trip is finished is reserved to the SuperAdmin: it is the
   * moment the trip's figures become permanent and the row closes for good — a
   * trigger makes `done` irreversible, so there is no undo to fall back on.
   * `head-anywhere` would hand that to every department head, and `any` to
   * everybody with an account.
   *
   * ⚠ AND IT IS DELIBERATELY NOT `trip.write`. A dispatcher correcting a
   * delivery address and a reviewer closing a trip's books are different acts
   * with different consequences; sharing a key would mean the narrower one
   * could never be granted without the wider one.
   *
   * As everywhere else, 'global' is a RELATION — a caller whose authority is
   * not scoped to a department — and WHICH accounts hold it stays data.
   */
  'trip.complete.review': 'global',

  /**
   * ★ `head-anywhere`, WHICH IS THE TIER THIS CASE WAS BUILT FOR.
   *
   * A driver belongs to no department, so there is no unit to name and no
   * target to scope against — asking for one would refuse every head at the
   * guard. Heading ANY department is the whole test, and an ordinary member
   * fails it, which is what the specification asks for.
   */
  'driver.account.request': 'head-anywhere',
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}
