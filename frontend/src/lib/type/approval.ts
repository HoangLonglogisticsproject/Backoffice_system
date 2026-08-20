/**
 * The approval workflow shapes, exactly as the backend returns them (§9, §10).
 *
 * Both flows are "a head proposes, a global administrator decides", and both
 * are read-only here — proposing and deciding are later phases.
 */

import type { UserSummary } from './organization';

/** §9, §10. Both workflows share the same three-valued decision state. */
export type DecisionStatus = 'pending' | 'approved' | 'rejected';

/**
 * §10. Two actions, and neither of them is "add": an active person always
 * belongs to exactly one department, so putting them somewhere means taking
 * them out of where they are.
 */
export type MembershipRequestAction = 'TRANSFER_MEMBER' | 'REMOVE_MEMBER';

/**
 * `GET /departments/:departmentId/membership-requests` and
 * `GET /membership-requests` (§10).
 *
 * ⚠ THE RESPONSE SAYS `targetUserId`. The POST body for the same workflow says
 * `userId` — two names for one idea, and the contract calls this the easiest
 * thing in the whole API to get wrong. Only the response name appears here
 * because this phase is read-only; whoever adds the mutation must not assume
 * symmetry.
 *
 * `departmentId` is the SOURCE, derived by the server from the target's current
 * membership — never supplied by a caller. `targetDepartmentId` is the
 * destination and exists only for a transfer.
 */
export interface MembershipChangeRequest {
  id: string;
  /** Source. Read from the database, not from whoever raised the request. */
  departmentId: string;
  /** Destination. `null` for `REMOVE_MEMBER`. */
  targetDepartmentId: string | null;
  targetUserId: string;
  action: MembershipRequestAction;
  status: DecisionStatus;
  requestedBy: string;
  requestedAt: string;
  /**
   * Who decided it, as a bare id. There is deliberately NO `decidedByUser`
   * anywhere: no screen shows a decider's name yet, and the server will not pay
   * for a join nobody reads. It can be added additively when a screen needs it.
   */
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}

/**
 * The same request as the LIST reads return it, with both people named.
 *
 * ⚠ ONLY the two GET lists produce this. `POST` to raise, approve or reject all
 * answer from the write path and return the base `MembershipChangeRequest` with
 * no projections. Putting `targetUser` on the base shape would promise a field
 * three endpoints do not send.
 */
export interface MembershipChangeRequestWithUsers extends MembershipChangeRequest {
  /** Who the request is ABOUT (ADR-0001). */
  targetUser: UserSummary;
  /** Who RAISED it (ADR-0001). */
  requestedByUser: UserSummary;
}

/**
 * `GET /departments/:departmentId/account-invitations` and
 * `GET /account-invitations` (§9).
 *
 * The target is an EMAIL, not a user id, because the person being invited has
 * no row to point at yet — that is the whole difference from a membership
 * change request, and why they are two endpoints rather than one.
 *
 * While `pending` there is no user, identity, credential or membership;
 * `createdUserId` is filled in only by approval.
 *
 * ⚠ NO PASSWORD FIELD, EVER. The temporary secret appears exactly once, in the
 * response to `POST /account-invitations/:id/approve` (§13). It is not on this
 * shape, not in any list, and cannot be read back.
 */
export interface AccountInvitation {
  id: string;
  departmentId: string;
  /** The INVITED address. Not a display name, and never a substitute for one. */
  email: string;
  status: DecisionStatus;
  requestedBy: string;
  requestedAt: string;
  /** No `decidedByUser` sibling, for the reason given on the request shape. */
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  /** The account approval produced. `null` until then. No projection sibling. */
  createdUserId: string | null;
}

/**
 * The same invitation as the LIST reads return it, with the asker named.
 *
 * ⚠ ONLY the two GET lists produce this. Raising, approving and rejecting all
 * return the base `AccountInvitation` — and approval wraps that base shape
 * inside its own envelope alongside the one-time password, which carries no
 * projection either.
 */
export interface AccountInvitationWithUser extends AccountInvitation {
  /** Who ASKED for this account (ADR-0001). */
  requestedByUser: UserSummary;
}
