import { httpClient } from './client';
import type { DepartmentHeadWithUser } from '@/types/organization';

/**
 * Reading who leads a department (contract §15b). Read-only: appointing and
 * revoking are later phases.
 *
 * ⚠ GLOBAL ONLY, INCLUDING THIS READ. The permission is `role.assign`, and the
 * whole route family is closed to a department head — they cannot even see
 * their own appointment through it. That is unusual enough to be worth stating:
 * a 403 here from a head is correct, not a scope bug.
 *
 * ⚠ NO HEAD IS A 404, NOT AN EMPTY BODY. A department that has never had a head
 * answers 404, which is indistinguishable in shape from a department that does
 * not exist. So a caller must branch on the status code — returning `null` here
 * would merge "this unit has no head" with "there is no such unit", and those
 * lead to different screens.
 *
 * That is deliberately NOT smoothed over into `Promise<DepartmentHead | null>`:
 * the two 404s carry different meanings and only the caller knows which one
 * matters to it.
 */
export async function fetchDepartmentHead(departmentId: string): Promise<DepartmentHeadWithUser> {
  const { data } = await httpClient.get<DepartmentHeadWithUser>(
    `/departments/${encodeURIComponent(departmentId)}/head`,
  );
  return data;
}
