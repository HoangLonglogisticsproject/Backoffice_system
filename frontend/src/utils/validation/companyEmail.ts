/**
 * The company email policy, as the form needs it.
 *
 * Every employee account is `<local-part>@hoanglongti.com`. The form therefore
 * asks for the local part only and appends the domain — nobody types
 * `@hoanglongti.com` fifty times, and nobody can type a different one.
 *
 * ★ THIS IS A UX HELPER, NOT A SECURITY CONTROL. The domain is enforced by the
 * server on every provisioning route (`ALLOWED_EMAIL_DOMAINS`, applied in
 * `core/users/domain/email.ts`), and it would still be enforced if this file
 * did not exist. What this buys is a shorter field and an error before the
 * round trip — not authority.
 *
 * NO NORMALISATION HAPPENS HERE. The server trims and lowercases, and it is the
 * only thing that decides what an address canonically is; a second copy of that
 * rule on this side is a second thing that can disagree with it.
 */

export const COMPANY_EMAIL_DOMAIN = 'hoanglongti.com';

const SUFFIX = `@${COMPANY_EMAIL_DOMAIN}`;

/** The API's bound, mirrored so a paste of nonsense fails here rather than at 422. */
const MAX_EMAIL_LENGTH = 320;

/**
 * What the user meant by what they typed.
 *
 * A pasted full company address is ACCEPTED and unwrapped rather than refused.
 * The alternative — "this field takes the local part only, try again" — punishes
 * the single most predictable thing somebody does with an email field, and the
 * intent is never ambiguous. Case-insensitive, because the server treats
 * `@HoangLongTI.com` as the same domain.
 *
 * `uyen`                    → `uyen`
 * `uyen@hoanglongti.com`    → `uyen`      ← never `uyen@hoanglongti.com@…`
 * `uyen@gmail.com`          → `uyen@gmail.com`, which then fails validation
 */
export function toLocalPart(typed: string): string {
  const trimmed = typed.trim();
  return trimmed.toLowerCase().endsWith(SUFFIX) ? trimmed.slice(0, -SUFFIX.length) : trimmed;
}

/**
 * The address to submit, or `null` when the local part cannot make one.
 *
 * The rules are the SERVER's rules, not new ones: non-empty, no whitespace, no
 * `@`, and short enough. `uyen.sales`, `nguyen-anh` and `hoang_duc` are all
 * ordinary local parts and pass without a policy of their own — inventing a
 * stricter pattern here would refuse names the API would have accepted.
 */
export function toCompanyEmail(typed: string): string | null {
  const local = toLocalPart(typed);

  if (local.length === 0) return null;
  if (/[\s@]/.test(local)) return null;

  const email = `${local}${SUFFIX}`;
  return email.length > MAX_EMAIL_LENGTH ? null : email;
}
