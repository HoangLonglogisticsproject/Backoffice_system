import { httpClient } from '../http/client';
import type { MembershipChangeRequest } from '../type/approval';

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
): Promise<MembershipChangeRequest[]> {
  const { data } = await httpClient.get<MembershipChangeRequest[]>(
    `/departments/${encodeURIComponent(departmentId)}/membership-requests`,
  );
  return data;
}

/**
 * The global queue. Returns `[]` when nothing is waiting — an empty list, not a
 * 404, because "no pending requests" is a normal state rather than a missing
 * resource.
 */
export async function fetchPendingMembershipRequests(): Promise<MembershipChangeRequest[]> {
  const { data } = await httpClient.get<MembershipChangeRequest[]>('/membership-requests');
  return data;
}
