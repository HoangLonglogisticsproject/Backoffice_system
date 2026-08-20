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
  /** Who `userId` refers to. Always present — the join is INNER. */
  user: UserSummary;
  departmentId: string;
  status: MembershipStatus;
  createdAt: string;
  /** Set exactly when `status` is `ended`; the database enforces the pair. */
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
  /**
   * Who leads the unit, by name. Present on the READ only.
   *
   * `assign` and `revoke` answer from the write path and return the same shape
   * WITHOUT this field: the caller of those already named the user themselves,
   * so the server does not pay for a join to tell them what they just sent.
   */
  user?: UserSummary;
  /** The membership that entitles this person to lead here (invariant #6). */
  membershipId: string;
  grantedAt: string;
}
