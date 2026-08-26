import { httpClient } from './client';
import type { EmployeeDetail, EmployeeRosterRow, MembershipStatus } from '@/types/organization';
import type { Page, PageRequest } from '@/types/pagination';

/**
 * Reading who is in a department (contract §6).
 *
 * The only parameter is the department on the URL. There is deliberately no
 * `sourceDepartmentId`, no actor id and no scope argument:
 *
 *   scope    is the route parameter, and the server checks it (§15). A second
 *            copy in a body or an argument would be a value the client picks
 *            and the server ignores — which reads like it does something.
 *
 *   actor    comes from the session cookie. Passing a user id would invite
 *            somebody to pass a different one.
 *
 * NO CLIENT-SIDE FILTERING. The list is returned exactly as the server sent it.
 * Filtering here would mean the client had decided what the caller is allowed
 * to see, which is the server's answer (§0) — and a filter that hides a row the
 * server chose to return is a bug that looks like a feature.
 *
 * ⚠ A MEMBER IS REFUSED THIS, even for their own department (§6). Only the HEAD
 * of that department, or a global administrator, gets 200; everyone else gets
 * 403. That is a settled default, not an oversight, so a 403 here is a normal
 * outcome to render — never a reason to sign anybody out.
 */
export async function fetchDepartmentMembers(
  departmentId: string,
  page: PageRequest = {},
  membershipStatus?: MembershipStatus,
): Promise<Page<EmployeeRosterRow>> {
  const { data } = await httpClient.get<Page<EmployeeRosterRow>>(
    `/departments/${encodeURIComponent(departmentId)}/members`,
    { params: { limit: page.limit, cursor: page.cursor, membershipStatus } },
  );
  return data;
}

/**
 * The DEPLOYMENT-WIDE roster (`GET /memberships`) — every unit, one page at a
 * time.
 *
 * ★ GLOBAL-ONLY, AND THE SERVER IS WHAT MAKES IT SO. `unit.member.read` is
 * checked here WITHOUT a department, and an unscoped check is exactly what only
 * a global caller survives. A head asking for this gets 403; they have their own
 * department's roster and nothing wider.
 *
 * ★ ONE REQUEST, NOT ONE PER DEPARTMENT. Listing departments and then fetching
 * each unit's members would be N+1, would give every unit its own cursor so the
 * merged list could not be paginated or ordered, and would put a scope decision
 * in the browser. The server answers it as a single keyset query instead.
 *
 * ⚠ NO `departmentId` PARAMETER. Narrowing to one unit is the SCOPED endpoint's
 * job, where the guard checks that unit. Accepting one here would be a scoped
 * query authorized by the global rule.
 */
export async function fetchEmployeeRoster(
  page: PageRequest = {},
  membershipStatus?: MembershipStatus,
): Promise<Page<EmployeeRosterRow>> {
  const { data } = await httpClient.get<Page<EmployeeRosterRow>>('/memberships', {
    // `undefined` is dropped by the client, which is how "Tất cả" asks for both
    // without a magic value meaning "do not filter".
    params: { limit: page.limit, cursor: page.cursor, membershipStatus },
  });
  return data;
}

/**
 * One employee: identity, account state, and employment history.
 *
 * ★ THE SERVER DECIDES BOTH ACCESS AND DISCLOSURE. Whether this caller may open
 * the person at all is judged against the target's ACTIVE membership, and which
 * periods come back is narrowed by the same authority. Nothing is filtered here,
 * and no department is sent — there is no parameter a caller could use to widen
 * or narrow what they are allowed to see.
 *
 * A 403 is a normal outcome to render: a head reaching somebody who has moved to
 * another unit is refused by design, not by accident.
 */
export async function fetchEmployeeDetail(userId: string): Promise<EmployeeDetail> {
  const { data } = await httpClient.get<EmployeeDetail>(
    `/users/${encodeURIComponent(userId)}/memberships`,
  );
  return data;
}
