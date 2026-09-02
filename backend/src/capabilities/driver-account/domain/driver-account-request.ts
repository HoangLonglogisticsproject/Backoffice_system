import type { UserSummary } from '../../../common/types/user-summary';

/**
 * A proposal that somebody be given a driver account.
 *
 * ★ A REQUEST IS NOT AN ACCOUNT, AND THE GAP IS THE WHOLE FEATURE. A department
 * head may say who should drive; only a global administrator may make it so.
 * Everything here exists to keep those two acts separate and both recorded.
 *
 * ★ NO PASSWORD LIVES ON THIS TYPE, and none may ever be added. A pending
 * request can sit for days, and a temporary secret stored for days is a secret
 * with a window. The credential is generated at approval by the same
 * provisioning path the invitation flow uses and handed to the approver once.
 *
 * ★ NO DEPARTMENT EITHER. A driver belongs to no unit. That is why this is its
 * own table rather than a nullable column on `account_invitations`, whose
 * department is required, re-checked at approval and used to scope its listing.
 */

export const DRIVER_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type DriverRequestStatus = (typeof DRIVER_REQUEST_STATUSES)[number];

export interface DriverAccountRequest {
  id: string;
  /** Normalised. The proposed driver has no account yet, so there is no id. */
  email: string;
  displayName: string;
  status: DriverRequestStatus;

  requestedBy: string;
  requestedAt: Date;

  decidedBy: string | null;
  decidedAt: Date | null;
  /**
   * Required on rejection, absent on approval.
   *
   * ★ THE DATABASE ENFORCES THE FIRST HALF. A head told only "rejected" has
   * nothing to correct and nobody to ask, which is the failure the existing
   * invitation flow still has — it does not accept a reason at all.
   */
  decisionReason: string | null;

  /** Set exactly when approved; the database enforces the pair. */
  createdUserId: string | null;
}

/** The same row with the people resolved, for a screen that shows names. */
export interface DriverAccountRequestWithUsers extends DriverAccountRequest {
  requester: UserSummary;
  decider: UserSummary | null;
}

/**
 * Is this rejection sayable?
 *
 * ★ CHECKED HERE AS WELL AS IN THE DATABASE, and both are wanted. The CHECK
 * constraint is what makes a reasonless rejection impossible to store even for
 * a maintenance script; this is what makes the API answer 422 with a sentence
 * instead of surfacing a constraint violation as a 500.
 */
export const isUsableRejectionReason = (reason: string | null | undefined): boolean =>
  typeof reason === 'string' && reason.trim().length > 0;
