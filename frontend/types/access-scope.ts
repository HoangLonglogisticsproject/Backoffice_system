/**
 * Access scope — the most primitive shape in the system. Imports nothing.
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
 * The TYPE lives in types/ and the runtime helpers that go with it live in
 * services/access/rules/scope.ts. Splitting them is not pedantry: `UserContext`
 * needs this type, so keeping it in services/ made types/ import services/ and
 * put a cycle through the whole foundation.
 */
export type Role = 'SUPERADMIN' | 'DEPARTMENT_HEAD' | 'MEMBER';
