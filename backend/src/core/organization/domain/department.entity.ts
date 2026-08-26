import type { AccountStatus, UserSummary } from '../../../common/types/user-summary';

/**
 * An organizational unit. A row, never a name in code.
 *
 * "Department" is the neutral word for a subdivision — it could be a branch, a
 * shift, a warehouse or a class in another deployment, and nothing here knows
 * which. What a customer calls their units, and what those units are, is data
 * an administrator enters at runtime.
 */
export interface Department {
  id: string;
  /** Stable identifier for URLs and configuration; survives a rename. */
  slug: string;
  name: string;
  status: DepartmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `archived` rather than deleted, for the same reason users are disabled rather
 * than deleted: memberships and authored records keep pointing here.
 */
export type DepartmentStatus = 'active' | 'archived';

/**
 * A person's presence in a unit, over a period of time.
 *
 * Membership is an ORGANIZATIONAL fact, not a permission. It answers "where
 * does this person sit", never "what may they do" — that question belongs to
 * role assignments, which live in their own table so the two can never drift
 * into contradicting each other about the same person.
 */
export interface DepartmentMembership {
  id: string;
  userId: string;
  departmentId: string;
  status: MembershipStatus;
  createdAt: Date;
  /** Set exactly when `status` becomes `ended`; the database enforces the pair. */
  endedAt: Date | null;
}

export type MembershipStatus = 'active' | 'ended';

/**
 * ★ THE POSITION A ROSTER SHOWS, DERIVED — never stored, never a row.
 *
 * `role_assignments` holds SUPERADMIN and DEPARTMENT_HEAD and nothing else:
 * 0004's header is explicit that MEMBER is the ABSENCE of a row. So this is not
 * a lookup, it is a question asked of the assignment table — "is there an active
 * DEPARTMENT_HEAD assignment for this membership" — and the answer's two cases
 * are the two values here.
 *
 * ⚠ Do NOT add MEMBER to `role_assignments`. Every plain employee would need a
 * row that means nothing, the CHECK constraint forbids the value, and the
 * absence that currently carries the meaning would stop being unambiguous.
 */
export type EmployeeRole = 'DEPARTMENT_HEAD' | 'MEMBER';

/**
 * One line of an employee roster: a membership, the person holding it, the unit
 * it is in, and the position it confers.
 *
 * ★ ONE SHAPE FOR BOTH ROSTERS — the department-scoped read and the global one.
 * They differ in WHICH rows the caller may see, which is an authorization
 * question the guard answers, never a difference in what a row IS. Two shapes
 * would drift, and the screens would drift with them.
 *
 * ★ THE TWO STATUSES ARE BOTH HERE AND ARE NOT INTERCHANGEABLE:
 *
 *   membershipStatus  is this person still in this unit      active | ended
 *   accountStatus     may this person's account operate      active | disabled
 *
 * A single `status` field would have to pick one meaning and lie about the
 * other, which is why neither is named `status`.
 *
 * ★ STILL A MEMBERSHIP, NOT A PERSON. `membershipId` identifies the row; the
 * person is `user.id`. One person legitimately has many rows here over time —
 * an ended Sales membership and an active Vận hành one are two lines of history
 * for ONE employee identity, never two employees.
 */
export interface EmployeeRosterRow {
  /**
   * ★ THE MEMBERSHIP'S id, not the person's — same convention as
   * `DepartmentMembership`. The person is `user.id`. Mixing them up deletes the
   * wrong row one day, and it is also what makes the cursor work: the keyset is
   * `(joinedAt, id)` over `department_memberships`.
   */
  id: string;
  user: UserSummary;
  department: { id: string; name: string };
  role: EmployeeRole;
  membershipStatus: MembershipStatus;
  accountStatus: AccountStatus;
  /** `department_memberships.created_at` — joining the unit IS the row's birth. */
  joinedAt: Date;
  /** Set exactly when `membershipStatus` is `ended`; the database enforces the pair. */
  endedAt: Date | null;
}

/**
 * Slugs are compared, not displayed, so they are stored normalised — the same
 * reasoning as `normalizeSubject` for identities. `Sales `, `sales` and `SALES`
 * are one unit, and discovering that at insert time rather than at lookup time
 * is how duplicates are avoided.
 */
export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}
