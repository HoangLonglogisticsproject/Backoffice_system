import type { UserSummary } from '../../../common/types/user-summary';

/**
 * Hoàng Long's approval policy, as data.
 *
 * PROJECT-OWNED. "A head proposes, a global administrator decides" is one
 * company's rule, not a mechanism every backoffice needs — another deployment
 * may grant its heads `unit.member.write` and delete this capability whole.
 * Nothing in `core/` references any of it.
 */

/**
 * Two actions, and deliberately no `ADD_MEMBER`.
 *
 * An active person always belongs to exactly one unit, so there is no state in
 * which "add them to a unit" is meaningful: putting somebody somewhere means
 * taking them out of where they are, which is a transfer. Bringing in somebody
 * who does not exist yet is `account-invitation`, a different capability.
 */
export const REQUEST_ACTIONS = ['TRANSFER_MEMBER', 'REMOVE_MEMBER'] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface MembershipChangeRequest {
  id: string;
  /**
   * Where the target was when this was raised — DERIVED from their membership,
   * never accepted from a caller, and re-read at decision time because they may
   * have moved since.
   */
  departmentId: string;
  /** Where they should end up. Only a transfer has one. */
  targetDepartmentId: string | null;
  targetUserId: string;
  action: RequestAction;
  status: RequestStatus;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string | null;
}

/**
 * A request as a LIST READ returns it: the row, plus the names of the two
 * people it concerns.
 *
 * Separate from the entity because the write paths — raise, decide, the lookups
 * inside a transaction — need neither name and should not pay for the joins
 * that fetch them.
 */
export interface MembershipChangeRequestWithUsers extends MembershipChangeRequest {
  /** Who the request is ABOUT. */
  targetUser: UserSummary;
  /** Who RAISED it. */
  requestedByUser: UserSummary;
}

/**
 * The permission a head needs to raise a request.
 *
 * Declared HERE rather than in `core/authorization` because the word "request"
 * names something only this capability has. A core permission catalogue holding
 * this key would mean core knew a capability existed — and `B1` greps import
 * paths, so that leak would never show up in red.
 */
export const MEMBERSHIP_REQUEST_CREATE = 'membership.request.create';
