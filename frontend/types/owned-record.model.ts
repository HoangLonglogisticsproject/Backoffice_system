/**
 * Anything a person can own. Ownership is a separate concern from unit
 * isolation — see access/rules/record-access.ts.
 *
 * Deliberately the smallest shape that the ownership rule can decide on, so a
 * customer's own records satisfy it by structural typing without inheriting
 * anything.
 */
export interface OwnedRecord {
  id: string;
  /** The organizational unit this record belongs to. */
  departmentId: string;
  /** null = unassigned: visible to the unit's head but to no member. */
  assigneeId: string | null;
}
