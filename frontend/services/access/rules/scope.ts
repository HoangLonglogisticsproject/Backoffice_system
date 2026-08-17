/**
 * Access scope — the most primitive type in the system. Imports nothing.
 *
 * These three values are not job titles, they are **data radii**: how far a
 * person can see. That is the only thing an authorization mechanism needs to
 * know, and it is what makes the mechanism reusable across businesses.
 *
 *   SUPERADMIN       every record                     radius = whole organization
 *   DEPARTMENT_HEAD  every record of their own unit   radius = one unit
 *   MEMBER           only records assigned to them    radius = themselves
 *
 * A customer's job titles map ONTO these — several titles may share one radius
 * (an owner and an auditor both see everything; they differ in what they may
 * *do*, which is capabilities, not scope). Display labels belong to the tenant,
 * never here.
 *
 * The TYPE itself lives in types/access-scope.ts — `UserContext` needs it, and
 * keeping it here made types/ import services/ and closed a cycle through the
 * whole foundation. What stays here is the runtime that goes with it.
 */
import { Role } from '@bo/types';

export const ROLES: readonly Role[] = ['SUPERADMIN', 'DEPARTMENT_HEAD', 'MEMBER'];

/** Narrows an arbitrary string, e.g. one written in a template. */
export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
