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
  /** Who the request is ABOUT (ADR-0001). Always present. */
  targetUser: UserSummary;
  action: MembershipRequestAction;
  status: DecisionStatus;
  requestedBy: string;
  requestedAt: string;
  /** Who RAISED it (ADR-0001). Always present. */
  requestedByUser: UserSummary;
  /**
   * Who decided it, as a bare id. There is deliberately NO `decidedByUser`:
   * no screen shows a decider's name yet, and the server will not pay for a
   * join nobody reads. It can be added additively when a screen needs it.
   */
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
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
  /** Who ASKED for this account (ADR-0001). Always present. */
  requestedByUser: UserSummary;
  /** No `decidedByUser` sibling, for the reason given on the request shape. */
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  /** The account approval produced. `null` until then. No projection sibling. */
  createdUserId: string | null;
}
