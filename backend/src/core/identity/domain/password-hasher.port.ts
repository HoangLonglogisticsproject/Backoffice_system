/**
 * PORT. `core/` states what it needs; `infrastructure/auth/` provides it; the
 * composition root wires the two together.
 *
 * This file is the reason `core → infrastructure` is forbidden. Identity code
 * depends on *hashing a password*, not on scrypt — so swapping the algorithm,
 * or moving to a provider that verifies elsewhere, never edits the foundation.
 */
export interface PasswordHasher {
  /** Returns a self-describing digest: algorithm and parameters travel with it. */
  hash(plaintext: string): Promise<string>;

  /**
   * Constant-time where it matters. Must return false rather than throw on a
   * malformed digest — a corrupt row is a failed login, not a 500.
   */
  verify(plaintext: string, digest: string): Promise<boolean>;

  /**
   * Burns roughly the same time as a real verification.
   *
   * Called when no identity matched, so that "unknown user" and "wrong
   * password" take the same time. Without it, response latency answers the
   * question the error message refuses to.
   */
  fakeVerify(): Promise<void>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
