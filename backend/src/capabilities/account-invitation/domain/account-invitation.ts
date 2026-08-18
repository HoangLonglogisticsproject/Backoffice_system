/**
 * Hoàng Long's onboarding policy, as data.
 *
 * PROJECT-OWNED. Another deployment lets a global administrator call
 * `POST /users` and deletes this capability whole.
 */

export const INVITATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export interface AccountInvitation {
  id: string;
  /** Where the invitee lands: the unit of the head who invited them. */
  departmentId: string;
  /** Normalised. The invitee has no account yet, so there is no id to hold. */
  email: string;
  status: InvitationStatus;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string | null;
  /** Set exactly when approved; the database enforces the pair. */
  createdUserId: string | null;
}

/**
 * The permission a head needs to invite.
 *
 * Project-owned for the same reason as `membership.request.create`: the word
 * "invitation" names something only this capability has.
 */
export const ACCOUNT_INVITATION_CREATE = 'account.invitation.create';
