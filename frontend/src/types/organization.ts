/**
 * Organization shapes, exactly as the backend returns them (contract §5, §6).
 *
 * Nothing here is reshaped, renamed or enriched. The response IS the contract,
 * and a client that quietly renames a field is a client that disagrees with the
 * documentation the next person will read.
 */

/** §5. Archived, never deleted — memberships keep pointing at the row. */
export type DepartmentStatus = 'active' | 'archived';

/** `GET /departments/:departmentId` (§5). */
export interface Department {
  id: string;
  /** Stable identifier for URLs; survives a rename. */
  slug: string;
  name: string;
  status: DepartmentStatus;
  createdAt: string;
  updatedAt: string;
}

/** §6. A membership ends, it is not removed — the row is history. */
export type MembershipStatus = 'active' | 'ended';

/**
 * The canonical way this API names a person (ADR-0001).
 *
 * It arrives INSIDE a resource the caller was already allowed to read, so it
 * carries no authorization of its own: a name is visible exactly when the row
 * referencing it is. There is deliberately no endpoint that turns an arbitrary
 * user id into a name, and a screen must never try to build one.
 *
 * `displayName` and nothing else. Not `email` — an email is not a display name
 * and must never be shown in place of one. Not `username` — the server does not
 * store one; it derives it from the email, so returning it would leak the local
 * part of somebody's address.
 */
export interface UserSummary {
  id: string;
  displayName: string;
}

/**
 * `GET /departments/:departmentId/members` (§6).
 *
 * THIS IS STILL A MEMBERSHIP, NOT A PERSON — `id` is the membership's, and
 * `user.id` is the person's. They are different things and a screen that mixes
 * them up will delete the wrong row one day.
 *
 * `user` is the identity projection (ADR-0001), added by the server inside the
 * same authorized query. `userId` is unchanged and stays: nothing that read the
 * old shape breaks.
 */
export interface DepartmentMembership {
  id: string;
  userId: string;
  departmentId: string;
  status: MembershipStatus;
  createdAt: string;
  /** Set exactly when `status` is `ended`; the database enforces the pair. */
  endedAt: string | null;
}

/**
 * `users.status` — whether the BACKOFFICE ACCOUNT may operate.
 *
 * ⚠ NOT whether somebody still works here. That is `MembershipStatus`, and the
 * two answer different questions off different columns. They move together
 * during offboarding, but nothing in the schema ties them, so neither is ever
 * derived from the other.
 */
export type AccountStatus = 'active' | 'disabled';

/**
 * The position a roster shows — DERIVED from `role_assignments`, never stored.
 *
 * The table holds SUPERADMIN and DEPARTMENT_HEAD and nothing else: MEMBER is
 * the ABSENCE of an active assignment. So the server answers this question, not
 * a lookup, and there is no MEMBER row anywhere to go looking for.
 */
export type EmployeeRole = 'DEPARTMENT_HEAD' | 'MEMBER';

/**
 * One line of an employee roster — `GET /departments/:id/members` and
 * `GET /memberships` both return exactly this shape.
 *
 * ★ ONE SHAPE, TWO AUDIENCES. The two endpoints differ in WHICH rows the caller
 * may see, which the server decides; a row is the same thing either way. The
 * screens differ only in which columns they draw.
 *
 * ★ TWO STATUSES, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *   membershipStatus  is this person still in this unit    active | ended
 *   accountStatus     may this person's account operate     active | disabled
 *
 * Neither is named `status`, because a single field would have to pick one
 * meaning and lie about the other.
 *
 * ★ STILL A MEMBERSHIP, NOT A PERSON. `id` is the membership's; the person is
 * `user.id`. One person legitimately has several rows here over time — an ended
 * Sales membership beside an active Vận hành one is two lines of history for
 * ONE employee, never two employees.
 */
export interface EmployeeRosterRow {
  /** The MEMBERSHIP's id. The person is `user.id`. */
  id: string;
  user: UserSummary;
  department: { id: string; name: string };
  role: EmployeeRole;
  membershipStatus: MembershipStatus;
  accountStatus: AccountStatus;
  /** `department_memberships.created_at` — joining the unit IS the row's birth. */
  joinedAt: string;
  /** Set exactly when `membershipStatus` is `ended`; the database enforces the pair. */
  endedAt: string | null;
}

/**
 * `GET /departments/:departmentId/head` (§15b).
 *
 * Department-scoped, but owned by AUTHORIZATION rather than organization: the
 * permission is `role.assign`, which is GLOBAL-only. A head cannot read this
 * for their own department — the whole route family is closed to them, read
 * included. It lives with the department types because that is how a screen
 * consumes it: "who leads this unit".
 *
 * Assign, revoke and read all return this same shape. A department with no head
 * is a **404**, not an empty body — absence is not an error, so a caller checks
 * for 404 rather than for null.
 */
export interface DepartmentHead {
  assignmentId: string;
  departmentId: string;
  userId: string;
  /** The membership that entitles this person to lead here (invariant #6). */
  membershipId: string;
  grantedAt: string;
}

/**
 * What `GET /departments/:departmentId/head` returns: the assignment, named.
 *
 * The READ only. `assign` and `revoke` answer from the write path and return
 * the base `DepartmentHead` without `user`, so the projection is a separate
 * type rather than an optional field — optional would leave every caller
 * guessing which of the three routes they are holding.
 */
export interface DepartmentHeadWithUser extends DepartmentHead {
  user: UserSummary;
}

/**
 * `GET /users/:userId/memberships` — one employee, read only.
 *
 * ★ KEYED BY THE PERSON. `user.id` is the canonical identity and survives every
 * lifecycle event, which is what lets several employment periods appear as ONE
 * employee. A membership id would scope this to a single period.
 *
 * ★ TWO STATUSES, NEVER MERGED. `accountStatus` is `users.status` — may this
 * account operate. Each membership carries its own `membershipStatus` — is this
 * person still in that unit. Neither is derived from the other.
 *
 * ⚠ `memberships` MAY BE PARTIAL, and the screen must say so. A department head
 * is shown only the periods inside the units they lead; a global administrator
 * is shown all of them. Presenting a filtered list as a complete history would
 * be a lie the server cannot correct.
 */
export interface EmployeeDetail {
  user: UserSummary;
  accountStatus: AccountStatus;
  memberships: EmployeeRosterRow[];
}
