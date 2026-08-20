import type { UserSummary } from '../../../common/types/user-summary';

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
 * A membership as a LIST READ returns it: the row, plus the name of the person
 * it points at.
 *
 * Separate from `DepartmentMembership` on purpose. The bare entity is what the
 * write paths produce — `openMembership`, `lockActiveForUser`, the transfer
 * inside a transaction — and none of them need a name or should pay for the
 * join to get one. Making the projection part of the entity would push that
 * cost onto every one of those callers to serve a display concern.
 */
export interface DepartmentMembershipWithUser extends DepartmentMembership {
  user: UserSummary;
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
