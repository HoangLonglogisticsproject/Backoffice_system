/**
 * A person this deployment knows about.
 *
 * Deliberately thin: a name and whether they may act. Everything that varies
 * per project — which unit they belong to, what they may do, what a project
 * calls their job — arrives in later phases and lives elsewhere. A `User` that
 * grows business fields is a foundation that stops being reusable.
 */
export interface User {
  id: string;
  displayName: string;
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
