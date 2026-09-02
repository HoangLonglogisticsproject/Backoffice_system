/**
 * A person this deployment knows about.
 *
 * Deliberately thin: a name and whether they may act. Everything that varies
 * per project — which unit they belong to, what they may do, what a project
 * calls their job — arrives in later phases and lives elsewhere. A `User` that
 * grows business fields is a foundation that stops being reusable.
 */
/**
 * What KIND of account this is — and it is stored, not derived.
 *
 * ★ "HAS NO DEPARTMENT" WOULD HAVE BEEN THE WRONG TEST. It is true of a driver,
 * and equally true of every employee who has been offboarded, so inferring the
 * answer would have quietly reclassified people the day they left.
 *
 * ★ AND IT IS NOT A ROLE. It grants nothing and denies nothing on its own:
 * authorization still comes from role assignments and memberships, and a driver
 * simply holds neither. The one place it decides anything is the Backoffice
 * boundary, where a driver is refused the company-wide trip reads that
 * `trip.read` would otherwise give any authenticated caller.
 */
export const ACCOUNT_TYPES = ['employee', 'driver'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface User {
  id: string;
  displayName: string;
  accountType: AccountType;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `disabled` rather than deleted, always.
 *
 * Audit records, authored content and memberships keep pointing at this row
 * after someone leaves; removing it would either break those references or
 * force them to carry a copy of the name. Disabling revokes access and keeps
 * history readable.
 */
export type UserStatus = 'active' | 'disabled';

/** How a user proves who they are. One user may hold several. */
export interface Identity {
  id: string;
  userId: string;
  /** 'local' today. The column exists so a second provider needs no migration. */
  provider: string;
  /** Email for `local`; the issuer's subject for a federated provider. */
  subject: string;
  /** Present for `local` only — providers that verify elsewhere store nothing. */
  secretHash: string | null;
  /** Temporary credentials must be replaced before normal use. */
  mustChangeSecret: boolean;
  createdAt: Date;
}

export const LOCAL_PROVIDER = 'local';

/**
 * Subjects are compared, not displayed, so they are stored normalised.
 * `USER@Example.com ` and `user@example.com` are the same account, and finding
 * that out at login time rather than at signup time is how duplicates happen.
 */
export function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase();
}
