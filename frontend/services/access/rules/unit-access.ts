import { UserContext } from '@bo/types';

/**
 * LEVEL 1 — which organizational units may this person enter?
 *
 * Deliberately separate from record ownership (level 2, record-access.ts).
 * They answer different questions and must not be collapsed into one ranked
 * scope: "which units can I enter?" is not "whose records can I read?".
 *
 *   SUPERADMIN      → every unit
 *   DEPARTMENT_HEAD → their own unit only
 *   MEMBER          → their own unit only
 *
 * The server is the enforcement point. This mirror exists so the UI never
 * offers a door it would then have to slam.
 *
 * Pure by contract: no Angular, no RxJS, no DI, no router. A backend written
 * in TypeScript imports this file as-is rather than re-implementing it.
 *
 * "Unit" is the neutral word for an organizational subdivision — a department,
 * branch, shift, warehouse or class. `UserContext.departmentId` still carries
 * the older name; renaming the model is a separate step.
 */
export function canAccessUnit(user: UserContext, unitId: string | undefined): boolean {
  if (!unitId) return false;
  if (user.role === 'SUPERADMIN') return true;
  return unitId === user.departmentId;
}

/** Only a head configures their own unit; a superadmin configures any. */
export function canConfigureUnit(user: UserContext, unitId: string): boolean {
  if (user.role === 'SUPERADMIN') return true;
  return user.role === 'DEPARTMENT_HEAD' && unitId === user.departmentId;
}

/**
 * Filters a list of units down to the ones in reach. Generic on purpose — the
 * rule only ever looks at `id`, so it works for any unit-shaped record.
 */
export function visibleUnits<T extends { id: string }>(
  units: readonly T[],
  user: UserContext,
): T[] {
  if (user.role === 'SUPERADMIN') return [...units];
  return units.filter((unit) => unit.id === user.departmentId);
}
