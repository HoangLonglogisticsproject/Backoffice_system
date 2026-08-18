import { ValidationError } from '../../../common/errors/domain.error';

/**
 * The password rules, at the authentication boundary rather than in the User
 * model — a user is not "invalid" because a policy changed, and tightening the
 * floor must not make existing rows unreadable.
 *
 * Length only. Composition rules (an uppercase, a symbol) push people toward
 * `Password1!` and are no longer recommended by NIST; length is what buys
 * entropy. Anything more than this belongs to a deployment that has asked for
 * it, not to the foundation.
 */
export const PASSWORD_POLICY = {
  /** NIST SP 800-63B floor is 8; 12 is the cheap upgrade for an admin tool. */
  minLength: 12,

  /**
   * A ceiling exists only to bound work: every character is hashed with
   * memory-hard scrypt, so an unbounded field is an unbounded amount of CPU
   * per request. Well above any real passphrase.
   */
  maxLength: 1024,
} as const;

/**
 * Throws rather than truncating.
 *
 * Silent truncation is the subtle version of this bug: the account is created
 * with a shorter secret than the user believes they chose, and nobody finds out.
 */
export function assertPasswordAcceptable(password: string): void {
  if (password.length < PASSWORD_POLICY.minLength) {
    throw new ValidationError(
      `Password must be at least ${PASSWORD_POLICY.minLength} characters.`,
    );
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    throw new ValidationError(
      `Password must be at most ${PASSWORD_POLICY.maxLength} characters.`,
    );
  }
}
