import { httpClient } from '../http/client';
import type { AccountInvitation, AccountInvitationWithUser } from '../type/approval';
import type { Page, PageRequest } from '../type/pagination';

/**
 * Reading account invitations (contract §9). Read-only: inviting and deciding
 * are later phases.
 *
 * Same two-audience split as membership requests, for the same reason — a head
 * invites, a global administrator approves:
 *
 *   /departments/:id/account-invitations   the head of that department, or
 *                                          GLOBAL.
 *   /account-invitations                   GLOBAL only; a head gets 403.
 *
 * ⚠ NO TEMPORARY PASSWORD PASSES THROUGH HERE. The secret exists in exactly one
 * response — the approval (§13) — and is never readable again, from these
 * endpoints or any other. Nothing in this module should ever be extended to
 * "fetch it back"; there is no such thing to fetch.
 */

/** The invitations raised for one department. Scope is the route parameter (§15). */
export async function fetchDepartmentAccountInvitations(
  departmentId: string,
  page: PageRequest = {},
): Promise<Page<AccountInvitationWithUser>> {
  const { data } = await httpClient.get<Page<AccountInvitationWithUser>>(
    `/departments/${encodeURIComponent(departmentId)}/account-invitations`,
    { params: { limit: page.limit, cursor: page.cursor } },
  );
  return data;
}

/** The global approval queue. `[]` when nothing is waiting (§9). */
export async function fetchPendingAccountInvitations(
  page: PageRequest = {},
): Promise<Page<AccountInvitationWithUser>> {
  const { data } = await httpClient.get<Page<AccountInvitationWithUser>>('/account-invitations', {
    params: { limit: page.limit, cursor: page.cursor },
  });
  return data;
}

/**
 * A head asks for an account (contract §9). HEAD of the route's department, or
 * GLOBAL.
 *
 * EMAIL ONLY. There is no name, no password, no role and no department in the
 * body — the department comes from the URL, and everything else is decided at
 * approval. That asymmetry with `POST /users` is the workflow, not an
 * oversight: a head may propose a colleague, and only an administrator may
 * create the account.
 */
export async function requestAccountInvitation(
  departmentId: string,
  email: string,
  reason?: string,
): Promise<AccountInvitation> {
  const { data } = await httpClient.post<AccountInvitation>(
    `/departments/${encodeURIComponent(departmentId)}/account-invitations`,
    reason ? { email, reason } : { email },
  );
  return data;
}

/**
 * The one-time result of approving an invitation.
 *
 * ⚠ `temporaryPassword` IS RETURNED EXACTLY ONCE AND CANNOT BE READ BACK. There
 * is no email adapter in this deployment, so this response is the only channel
 * that can carry it to the person it belongs to. It is never stored in
 * plaintext, never logged, and no endpoint can produce it again — so the screen
 * that receives it must show it before it navigates away.
 */
export interface ApprovedInvitation {
  invitation: AccountInvitation;
  username: string;
  temporaryPassword: string;
}

/**
 * Approving an invitation (contract §13) → **201**, because it creates an
 * account.
 *
 * ★ THE APPROVER DOES NOT CHOOSE THE PASSWORD. The server generates it. The
 * only thing this body may carry is a display name, and even that is optional —
 * a body-less approve is a legal request. Anything else about the account (the
 * address, the department) was fixed when the head raised it.
 */
export async function approveAccountInvitation(
  invitationId: string,
  displayName?: string,
): Promise<ApprovedInvitation> {
  const { data } = await httpClient.post<ApprovedInvitation>(
    `/account-invitations/${encodeURIComponent(invitationId)}/approve`,
    displayName ? { displayName } : {},
  );
  return data;
}

/** Rejecting creates nothing, so it answers 200 with the closed invitation. */
export async function rejectAccountInvitation(
  invitationId: string,
  reason?: string,
): Promise<AccountInvitation> {
  const { data } = await httpClient.post<AccountInvitation>(
    `/account-invitations/${encodeURIComponent(invitationId)}/reject`,
    reason ? { reason } : {},
  );
  return data;
}
