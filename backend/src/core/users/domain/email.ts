import { ValidationError } from '../../../common/errors/domain.error';

/**
 * Email rules for PROVISIONING an account. Never used on the login path.
 *
 * That split is a security decision, not tidiness. Refusing a login because the
 * address is malformed, or because its domain is not on the allowlist, answers
 * a different question than "wrong password" — and an attacker who can tell
 * those apart learns which domains this deployment uses and which addresses are
 * shaped like real ones. Login therefore only normalises and looks up; every
 * failure there produces one identical answer.
 *
 * Pure functions, no framework: the allowlist arrives as an argument rather than
 * being read from config here, so `core/` never learns a customer's domain and
 * this file can be tested with nothing wired up.
 */

/** Any whitespace at all. No quantifier, so it cannot backtrack. */
const WHITESPACE = /\s/;

/**
 * Deliberately permissive, and deliberately NOT an RFC 5322 implementation.
 *
 * A full grammar accepts things no mail server will deliver to and rejects
 * things that work, and every regex claiming to be complete is famous for being
 * wrong. What this rules out is the shape that breaks the rest of the system: a
 * missing or repeated `@`, whitespace, an empty local part or domain, a domain
 * with no dot. Deliverability is proven by sending mail, not by a pattern.
 *
 * WRITTEN AS SCANS RATHER THAN AS ONE PATTERN, on purpose. The obvious regex
 * for this shape is `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, and it is super-linear:
 * `.` belongs to `[^\s@]`, so the segment before the dot and the segment after
 * it overlap, and an address whose domain has no dot makes the engine retry
 * every split point — O(n²) on a string an unauthenticated caller chooses the
 * length of. Each check below is one pass with no backtracking at all, and the
 * rule it enforces is legible without simulating a regex engine.
 */
function hasProvisionableShape(email: string): boolean {
  const at = email.indexOf('@');

  // No `@`, or nothing before it.
  if (at <= 0) return false;

  // A second `@`. Exactly one is what makes the split below meaningful.
  if (email.includes('@', at + 1)) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (WHITESPACE.test(local) || WHITESPACE.test(domain)) return false;

  // A dot inside the domain — neither leading nor trailing, so there is
  // something on both sides of it.
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/** Longest address any transport accepts; also the DTO's limit. */
const MAX_LENGTH = 320;

/**
 * Compared, never displayed — so stored normalised.
 *
 * `USER@Example.com ` and `user@example.com` are one account, and finding that
 * out at provisioning time rather than at login time is how duplicates are
 * avoided. Matches `normalizeSubject` in `user.entity.ts`; both exist because
 * one is the identity contract and this one is the provisioning rule.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The part a person is called by. Display only — never an authorization input. */
export function localPartOfEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

export function domainOfEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}

/**
 * Normalises and checks an address for provisioning, or throws.
 *
 * `allowedDomains` empty means every domain passes — the deployment has not
 * restricted itself, which is the reusable default.
 */
export function assertProvisionableEmail(
  email: string,
  allowedDomains: readonly string[],
): string {
  const normalized = normalizeEmail(email);

  if (normalized.length === 0) throw new ValidationError('Email is required.');
  if (normalized.length > MAX_LENGTH) throw new ValidationError('Email is too long.');
  if (!hasProvisionableShape(normalized)) {
    throw new ValidationError('Email is not a valid address.');
  }

  if (allowedDomains.length > 0 && !allowedDomains.includes(domainOfEmail(normalized))) {
    // Names the rule, not the allowlist: echoing the permitted domains back to
    // whoever asked hands out the deployment's shape for free.
    throw new ValidationError('That email domain is not permitted for this deployment.');
  }

  return normalized;
}
