import { httpClient } from './client';
import type { Department, DepartmentFunction } from '@/types/organization';

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

export interface CreateDepartmentInput {
  slug: string;
  name: string;
  /** Absent or `null` creates an ordinary unit (contract §5). */
  function?: DepartmentFunction | null;
}

/** `POST /departments` → 201 (contract §5). GLOBAL only; `slug` is immutable afterwards. */
export async function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  const { data } = await httpClient.post<Department>('/departments', input);
  return data;
}

export interface UpdateDepartmentInput {
  name?: string;
  /** `null` CLEARS the function; an absent key leaves it alone (contract §5). */
  function?: DepartmentFunction | null;
}

/** `PATCH /departments/:id` → 200 (contract §5). Both keys land in one transaction. */
export async function updateDepartment(
  departmentId: string,
  input: UpdateDepartmentInput,
): Promise<Department> {
  const { data } = await httpClient.patch<Department>(
    `/departments/${encodeURIComponent(departmentId)}`,
    input,
  );
  return data;
}
