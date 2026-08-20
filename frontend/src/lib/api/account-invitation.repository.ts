import { httpClient } from '../http/client';
import type { AccountInvitation } from '../type/approval';
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
): Promise<Page<AccountInvitation>> {
  const { data } = await httpClient.get<Page<AccountInvitation>>(
    `/departments/${encodeURIComponent(departmentId)}/account-invitations`,
    { params: { limit: page.limit, cursor: page.cursor } },
  );
  return data;
}

/** The global approval queue. `[]` when nothing is waiting (§9). */
export async function fetchPendingAccountInvitations(
  page: PageRequest = {},
): Promise<Page<AccountInvitation>> {
  const { data } = await httpClient.get<Page<AccountInvitation>>('/account-invitations', {
    params: { limit: page.limit, cursor: page.cursor },
  });
  return data;
}
