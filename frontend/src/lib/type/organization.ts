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
 * `GET /departments/:departmentId/members` (§6).
 *
 * ⚠ THIS IS A MEMBERSHIP, NOT A PERSON. It carries `userId` and no display
 * name, because the endpoint answers "who is in this unit" from the membership
 * table alone. There is no bulk user-lookup endpoint in the current contract,
 * so a screen that wants names cannot get them from here — see the integration
 * gaps in the phase report rather than inventing a join on the client.
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
