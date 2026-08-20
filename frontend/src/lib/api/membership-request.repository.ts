import { httpClient } from '../http/client';
import type {
  MembershipChangeRequest,
  MembershipChangeRequestWithUsers,
} from '../type/approval';
import type { Page, PageRequest } from '../type/pagination';

/**
 * Reading membership change requests (contract §10). Read-only: proposing and
 * deciding are later phases.
 *
 * TWO ENDPOINTS, TWO AUDIENCES, and they are not interchangeable:
 *
 *   /departments/:id/membership-requests   the queue for ONE department. The
 *                                          head of that department, or a global
 *                                          administrator.
 *
 *   /membership-requests                   the global decision queue. GLOBAL
 *                                          only — a head gets 403, including
 *                                          for requests they raised themselves,
 *                                          because a head proposes and never
 *                                          decides.
 *
 * Neither takes an actor, a role or a permission. Who is asking comes from the
 * session cookie, and what they may see is the server's answer — asking here
 * would be a second, weaker copy of a rule that already exists (§0).
 */

/**
 * The queue for one department. Scope is the route parameter (§15).
 */
export async function fetchDepartmentMembershipRequests(
  departmentId: string,
  page: PageRequest = {},
): Promise<Page<MembershipChangeRequestWithUsers>> {
  const { data } = await httpClient.get<Page<MembershipChangeRequestWithUsers>>(
    `/departments/${encodeURIComponent(departmentId)}/membership-requests`,
    { params: { limit: page.limit, cursor: page.cursor } },
  );
  return data;
}

/**
 * The global queue. Returns `[]` when nothing is waiting — an empty list, not a
 * 404, because "no pending requests" is a normal state rather than a missing
 * resource.
 */
export async function fetchPendingMembershipRequests(
  page: PageRequest = {},
): Promise<Page<MembershipChangeRequestWithUsers>> {
  const { data } = await httpClient.get<Page<MembershipChangeRequestWithUsers>>('/membership-requests', {
    params: { limit: page.limit, cursor: page.cursor },
  });
  return data;
}

/**
 * Deciding a request (contract §10). GLOBAL only.
 *
 * ★ THE DECIDER IS NEVER SENT. Who is deciding comes from the session cookie,
 * and the server refuses a self-approval with a database constraint, not a
 * client-side check. Passing an actor here would be a field the server ignores
 * at best and trusts at worst.
 *
 * Both answers return the BARE request — the identity projection is on the two
 * GET lists only, because the caller of this already knows who they just acted
 * on.
 */
export async function approveMembershipRequest(
  requestId: string,
): Promise<MembershipChangeRequest> {
  const { data } = await httpClient.post<MembershipChangeRequest>(
    `/membership-requests/${encodeURIComponent(requestId)}/approve`,
  );
  return data;
}

/** Rejecting takes an optional reason, which is stored and shown on the row. */
export async function rejectMembershipRequest(
  requestId: string,
  reason?: string,
): Promise<MembershipChangeRequest> {
  const { data } = await httpClient.post<MembershipChangeRequest>(
    `/membership-requests/${encodeURIComponent(requestId)}/reject`,
    reason ? { reason } : {},
  );
  return data;
}
