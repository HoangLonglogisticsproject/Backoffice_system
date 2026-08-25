import { httpClient } from './client';
import type { Department } from '@/types/organization';

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

/**
 * Every department in the deployment (contract §5).
 *
 * ⚠ GLOBAL ONLY. `unit.read` is checked with NO route scope, so only a global
 * caller passes — a head or member gets 403 and must use `fetchDepartment` on
 * the one id `GET /authorization/me` already gave them (see `useMyDepartments`).
 *
 * Not paginated: the backend returns a bare array, because a deployment has
 * tens of departments and never thousands.
 */
export async function fetchDepartments(): Promise<Department[]> {
  const { data } = await httpClient.get<Department[]>('/departments');
  return data;
}
