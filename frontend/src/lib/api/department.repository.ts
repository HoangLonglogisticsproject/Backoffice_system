import { httpClient } from '../http/client';
import type { Department } from '../type/organization';

/**
 * Reading one department (contract §5).
 *
 * ONE endpoint, deliberately. `GET /departments` is GLOBAL-only, so a head or a
 * member asking it gets 403 — it is the wrong way to build a menu. The right
 * source of "which department may I look at" is `departmentIds` from
 * `GET /authorization/me`, and this reads the one it names (§5).
 *
 * NO PERMISSION LOGIC LIVES HERE. This repository does not ask whether the
 * caller may read the department; it asks the server, which answers 403 if not.
 * Deciding here would be a second, weaker copy of a rule the server already
 * owns, and the two would eventually disagree (§0).
 */
export async function fetchDepartment(departmentId: string): Promise<Department> {
  // The id goes in the PATH, which is where scope lives (§15). It is never a
  // body field — a body that named the department could name any of them.
  const { data } = await httpClient.get<Department>(
    `/departments/${encodeURIComponent(departmentId)}`,
  );
  return data;
}
