import { httpClient } from '../http/client';
import type { DepartmentMembership } from '../type/organization';

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
): Promise<DepartmentMembership[]> {
  const { data } = await httpClient.get<DepartmentMembership[]>(
    `/departments/${encodeURIComponent(departmentId)}/members`,
  );
  return data;
}
