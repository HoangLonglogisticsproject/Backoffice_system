import type { DepartmentFunction } from '../../organization/domain/department.entity';

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
  /**
   * Add a row to the trip schedule, or a vehicle / customer / place to the
   * catalogues. Held by a GLOBAL caller and by the SALES, ACCOUNTING and
   * DISPATCH functions — see the requirement table.
   */
  'trip.create',
  /**
   * Edit, restatus or archive a trip row — including rows somebody else wrote —
   * and correct the catalogues behind it. Held by a GLOBAL caller and by the
   * head of a SALES, ACCOUNTING or DISPATCH unit (`withinFunction`); see the
   * requirement table below.
   *
   * ⚠ NO LONGER DISPATCH, AND NO LONGER PRICING. Putting a lorry and a driver
   * on a trip is `dispatch.write`; typing what the trip is sold or bought for is
   * `trip.price.write`. Both used to ride on this key, which handed them to
   * every head in the company whatever their department did.
   */
  'trip.write',

  /**
   * ★ PUT A LORRY AND ITS DRIVER ON A TRIP, SWAP THE DRIVER, TAKE THE PAIR OFF —
   * and read the list of drivers to choose from.
   *
   * One key for the four routes, because the business names one act: điều
   * phối. There is no lorry-only or driver-only dispatch (ADR-0004), so there
   * is nothing to split. Held by a GLOBAL caller and by every member of a
   * DISPATCH-function department — see `orFunction` below.
   */
  'dispatch.write',

  /**
   * ★ SEE THE TWO PRICES ON A TRIP ROW: what the customer is charged and what
   * the carrier is paid.
   *
   * ★ READING ONLY, SINCE 0032. This key used to gate writing too, on the
   * argument that a holder who may type a figure must be able to read it back.
   * That argument still holds — and it holds in ONE direction: everybody who
   * may write may read. The reverse is what the business refused: sales and
   * accounting read the figures and must not set them. So `trip.price.write`
   * is its own key, and every requirement that grants it also grants this one.
   *
   * ⚠ SEPARATE FROM `cost.read`, WHICH IS A DIFFERENT LEDGER AT A DIFFERENT
   * TIER. `cost.*` covers `trip_costs` and `trip_outsource_hires` — many
   * lines per trip, voided rather than edited, 'global' only. These two are
   * single columns on the trip row agreed when it is booked.
   */
  'trip.price.read',

  /**
   * ★ SET OR CLEAR THE TWO PRICES. Gates the `sellPrice` / `purchasePrice`
   * keys of the create and patch bodies: a caller without it who sends either
   * is refused, not silently stripped. Held by a GLOBAL caller and by the
   * DISPATCH function.
   */
  'trip.price.write',

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
 *
 * ⚠ AND THERE IS NO FOURTH. "Dispatcher", "sales" and "accountant" are not
 * roles: they are what a person's DEPARTMENT is for, carried on the department
 * (`departments.function`, 0032) and read off the caller's active membership.
 * See `orFunction` below.
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
export type PermissionTier = 'any' | 'head' | 'member' | 'head-anywhere' | 'global';

/**
 * A requirement: the tier, and OPTIONALLY the department functions that grant
 * the permission regardless of tier.
 *
 * ★ WHY `orFunction` EXISTS, AND WHY IT IS AN "OR" (0032).
 *
 * The five tiers all answer one shape of question — what is this caller's
 * relation to a department, or how senior are they. Some permissions are about
 * WHICH KIND of department the caller sits in: everybody in dispatch dispatches,
 * nobody in sales does, and seniority has nothing to do with it. That is a
 * relation the tiers cannot spell, so it is spelled beside them.
 *
 * `can()` grants the permission if EITHER the tier is satisfied OR the caller's
 * active membership is in a department whose `function` is listed. A global
 * caller still passes before either is read, and a temporary credential still
 * fails before either is read — the two rules that bracket everything.
 *
 * ★ ABSENT MEANS ABSENT. A requirement with no `orFunction` is decided by its
 * tier alone; no function grants it. That is how `trip.complete.review` stays
 * the SuperAdmin's, whatever a department is for — and an architecture test
 * holds it there.
 */
export interface PermissionRequirement {
  tier: PermissionTier;
  orFunction?: readonly DepartmentFunction[];
  /**
   * ★ AN "AND", NOT AN "OR": the tier must be satisfied AND the caller's
   * department must be one of these functions. Spelled for `trip.write` —
   * "a head, of a booking department" — so that seniority in Marketing or HR
   * buys nothing on the board. A global caller still passes before either is
   * read. Absent means the tier alone decides, as it always did.
   */
  withinFunction?: readonly DepartmentFunction[];
}

export const PERMISSION_REQUIREMENT: Readonly<Record<PermissionKey, PermissionRequirement>> = {
  'unit.read': { tier: 'member' },
  'unit.member.read': { tier: 'head' },
  'unit.write': { tier: 'global' },
  'unit.member.write': { tier: 'global' },
  'role.assign': { tier: 'global' },
  'user.write': { tier: 'global' },

  /**
   * ★ THE BOARD BELONGS TO THE THREE BOOKING FUNCTIONS, AND TO NOBODY ELSE
   * (business clarification 2026-09-17). Sales, accounting and dispatch read
   * it — member or head; a member or head of Marketing, HR, IT or any other
   * unit does not, however senior; a driver has no function and reads their
   * own turns through `/driver` instead. 'global' as the tier so that no
   * seniority elsewhere grants it: visibility is a function of the unit, never
   * of head-or-member. Customer Service is deliberately NOT listed — its
   * access is a deferred business decision, not an omission.
   */
  'trip.read': { tier: 'global', orFunction: ['sales', 'accounting', 'dispatch'] },

  /**
   * ★ BOOKING A TRIP IS A JOB, NOT A RIGHT OF EVERY ACCOUNT (0032). The three
   * functions the business named — sales, accounting, dispatch — book runs;
   * a member or head of Marketing, HR or IT does not, and a driver has no
   * function at all. 'global' as the tier so that no seniority elsewhere in
   * the company grants it; the function list is the whole grant. The same key
   * still gates adding a lorry, a customer or a place to the catalogues —
   * the people who book runs are the people who need a new customer on file.
   */
  'trip.create': { tier: 'global', orFunction: ['sales', 'accounting', 'dispatch'] },

  /**
   * ★ CORRECTING THE BOARD IS SENIORITY WITHIN A BOOKING FUNCTION. The
   * standing rule — a head, not a member — stays; `withinFunction` adds that
   * the head must lead a sales, accounting or dispatch unit. Without it a
   * head of HR could restatus, archive or rewrite a trip they may not even
   * read. A dispatch MEMBER still holds none of this: pricing an existing
   * row is `trip.price.write`, which the patch route authorises per field.
   */
  'trip.write': { tier: 'head-anywhere', withinFunction: ['sales', 'accounting', 'dispatch'] },

  /**
   * ★ DISPATCH IS A FUNCTION, NOT A SENIORITY (0032).
   *
   * The tier is 'global' — no departmental relation grants it on its own — and
   * the DISPATCH function grants it to everybody in that unit, head or member.
   * A head of Sales, who may still correct the board under `trip.write`, holds
   * nothing here; a plain dispatcher, who may not correct the board, holds all
   * of it. That asymmetry is the requirement.
   */
  'dispatch.write': { tier: 'global', orFunction: ['dispatch'] },

  /**
   * ★ READING THE PRICES: a global administrator and everybody in SALES,
   * ACCOUNTING or DISPATCH — member or head alike — and nobody else. A head
   * of any other unit used to see them under 'head-anywhere'; the business
   * clarification of 2026-09-17 closed that: price visibility follows the
   * unit's function, never seniority. The three functions all SEE the two
   * figures; only one of them SETS them (`trip.price.write` below).
   *
   * ★ WHY NOT 'head'. That tier asks for a target department, and a trip
   * belongs to none — the same reason `trip.write` above is 'head-anywhere'.
   * Marking this 'head' would refuse every head at the guard while
   * `grantedPermissions` listed it anyway, so the client would draw the price
   * field and the server would blank it.
   *
   * ★ WHY NOT 'global', WHICH IS WHERE `cost.*` SITS. Money on a trip is not
   * one tier. `cost.*` is the company's cost BASE — every fuel line and every
   * carrier hire — and stays at the tightest tier until somebody decides who
   * should hold it. These two columns are the commercial terms of one booking,
   * which the people arranging and accounting for that booking have to see.
   *
   * ★ DISPATCH IS LISTED HERE TOO, NOT ONLY ON THE WRITE KEY. Whoever may set
   * a figure must be able to read it back, or the form refuses to show them
   * what they just saved. The two lists are kept in step by hand and pinned
   * by a test.
   */
  'trip.price.read': { tier: 'global', orFunction: ['sales', 'accounting', 'dispatch'] },

  /**
   * ★ SETTING THE PRICES: a global administrator and the DISPATCH function.
   * Nobody else — not a head of Sales, not accounting, however senior.
   */
  'trip.price.write': { tier: 'global', orFunction: ['dispatch'] },

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
  'cost.read': { tier: 'global' },
  'cost.create': { tier: 'global' },
  'cost.void': { tier: 'global' },

  /**
   * ★ 'global' BECAUSE THE CONTRACT NAMES ONE ACTOR, NOT BECAUSE IT IS SAFEST.
   *
   * Confirming that a trip is finished is reserved to the SuperAdmin: it is the
   * moment the trip's figures become permanent and the row closes for good — a
   * trigger makes `finished` irreversible, so there is no undo to fall back on.
   * `head-anywhere` would hand that to every department head, and `any` to
   * everybody with an account.
   *
   * ★ AND NO `orFunction`, WHICH IS THE POINT OF 0032 NOT TOUCHING IT. Dispatch
   * arranges the run and prices it; dispatch is NOT the final reviewer of its
   * own work. An architecture test refuses a build in which a function appears
   * on this line.
   *
   * ⚠ AND IT IS DELIBERATELY NOT `trip.write`. A dispatcher correcting a
   * delivery address and a reviewer closing a trip's books are different acts
   * with different consequences; sharing a key would mean the narrower one
   * could never be granted without the wider one.
   *
   * As everywhere else, 'global' is a RELATION — a caller whose authority is
   * not scoped to a department — and WHICH accounts hold it stays data.
   */
  'trip.complete.review': { tier: 'global' },

  /**
   * ★ `head-anywhere`, WHICH IS THE TIER THIS CASE WAS BUILT FOR.
   *
   * A driver belongs to no department, so there is no unit to name and no
   * target to scope against — asking for one would refuse every head at the
   * guard. Heading ANY department is the whole test, and an ordinary member
   * fails it, which is what the specification asks for.
   */
  'driver.account.request': { tier: 'head-anywhere' },
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}
