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
 * The policy for a TEMPORARY credential — the one an administrator hands over
 * at onboarding, and the one the invitation flow generates.
 *
 * A LOWER FLOOR, DELIBERATELY, and it is not a weakening of the rule above: it
 * is a different secret with a different lifetime and different exposure.
 *
 *   it is dictated, not chosen     somebody reads it aloud or types it into a
 *                                  chat window. A 12-character requirement here
 *                                  buys nothing and gets written on paper.
 *
 *   it is per person, never shared a deployment does not get one onboarding
 *                                  password for everybody — each account gets
 *                                  its own, and the generated ones are 32 bytes
 *                                  of CSPRNG.
 *
 *   it opens almost nothing        `must_change_secret` refuses every route but
 *                                  login, logout, `auth/me` and the password
 *                                  change itself. There is no session to steal
 *                                  and no data to read until it has been
 *                                  replaced, at which point PASSWORD_POLICY
 *                                  applies in full.
 *
 * The floor is still the NIST minimum rather than nothing: an eight character
 * secret behind a login throttle is not guessable in the window it exists for,
 * and zero would let an empty string through.
 */
export const TEMPORARY_PASSWORD_POLICY = {
  minLength: 8,
  maxLength: PASSWORD_POLICY.maxLength,
} as const;

/**
 * Throws rather than truncating.
 *
 * Silent truncation is the subtle version of this bug: the account is created
 * with a shorter secret than the user believes they chose, and nobody finds out.
 */
export function assertPasswordAcceptable(password: string): void {
  assertWithin(password, PASSWORD_POLICY);
}

/**
 * The same check against the temporary floor.
 *
 * A separate function rather than a parameter, so that every call site says in
 * its own name WHICH secret it is judging. `assertPasswordAcceptable(pw, policy)`
 * would let a caller pass the wrong policy and read as though it were right.
 */
export function assertTemporaryPasswordAcceptable(password: string): void {
  assertWithin(password, TEMPORARY_PASSWORD_POLICY);
}

function assertWithin(
  password: string,
  policy: { minLength: number; maxLength: number },
): void {
  if (password.length < policy.minLength) {
    throw new ValidationError(`Password must be at least ${policy.minLength} characters.`);
  }
  if (password.length > policy.maxLength) {
    throw new ValidationError(`Password must be at most ${policy.maxLength} characters.`);
  }
}
