import { UserContext } from '@bo/types';
import { OwnedRecord } from '@bo/types';

/**
 * LEVEL 2 — record ownership *inside* a unit.
 *
 * Deliberately separate from department isolation (level 1, AccessService).
 * They answer different questions and must not be collapsed into one ranked
 * scope: "which departments can I enter?" is not "whose records can I read?".
 *
 *   SUPERADMIN      → every record
 *   DEPARTMENT_HEAD → every record of their own department, assigned or not
 *   MEMBER          → only records assigned to them
 *
 * The server is the enforcement point. This mirror exists so fixtures behave
 * like production and so the UI never renders a row it would then have to hide.
 *
 * Pure by contract: no Angular, no RxJS, no DI, no router. A backend written
 * in TypeScript imports this file as-is rather than re-implementing it.
 */
export function canSeeRecord(record: OwnedRecord, ctx: UserContext): boolean {
  switch (ctx.role) {
    case 'SUPERADMIN':
      return true;
    case 'DEPARTMENT_HEAD':
      return record.departmentId === ctx.departmentId;
    case 'MEMBER':
      return record.departmentId === ctx.departmentId && record.assigneeId === ctx.userId;
  }
}

export function visibleRecords<T extends OwnedRecord>(records: readonly T[], ctx: UserContext): T[] {
  return records.filter((r) => canSeeRecord(r, ctx));
}

/** Only a head (or above) may hand a record to someone else. */
export function canAssignRecords(ctx: UserContext): boolean {
  return ctx.role === 'SUPERADMIN' || ctx.role === 'DEPARTMENT_HEAD';
}
