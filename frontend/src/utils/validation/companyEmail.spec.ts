import { describe, expect, it } from 'vitest';
import { COMPANY_EMAIL_DOMAIN, toCompanyEmail, toLocalPart } from './companyEmail';

/**
 * The form's half of the company email policy.
 *
 * The server is what actually enforces the domain; everything here is about the
 * user not having to type it, and about never constructing something the server
 * would have to refuse.
 */
describe('company email', () => {
  it('is the company domain and nothing configurable', () => {
    expect(COMPANY_EMAIL_DOMAIN).toBe('hoanglonglti.com');
  });

  describe('builds the address from a local part', () => {
    it.each([
      ['uyen', 'uyen@hoanglonglti.com'],
      ['nuna', 'nuna@hoanglonglti.com'],
      ['uyen.sales', 'uyen.sales@hoanglonglti.com'],
      ['nguyen-anh', 'nguyen-anh@hoanglonglti.com'],
      ['hoang_duc', 'hoang_duc@hoanglonglti.com'],
    ])('%s → %s', (typed, expected) => {
      expect(toCompanyEmail(typed)).toBe(expected);
    });

    it('trims, because a paste carries whitespace', () => {
      expect(toCompanyEmail('  uyen \t')).toBe('uyen@hoanglonglti.com');
    });

    it('does NOT lowercase — the server owns normalisation', () => {
      // A second copy of that rule on this side is a second thing that can
      // disagree with the real one.
      expect(toCompanyEmail('Uyen')).toBe('Uyen@hoanglonglti.com');
    });
  });

  describe('a pasted full address', () => {
    it('is unwrapped rather than doubled', () => {
      expect(toCompanyEmail('uyen@hoanglonglti.com')).toBe('uyen@hoanglonglti.com');
      expect(toLocalPart('uyen@hoanglonglti.com')).toBe('uyen');
    });

    it('is unwrapped whatever case the domain was pasted in', () => {
      expect(toCompanyEmail('uyen@HoangLongLTI.com')).toBe('uyen@hoanglonglti.com');
    });

    it('never produces the double domain', () => {
      expect(toCompanyEmail('uyen@hoanglonglti.com')).not.toContain(
        'hoanglonglti.com@hoanglonglti.com',
      );
    });
  });

  describe('refuses', () => {
    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
      ['an outside domain', 'uyen@gmail.com'],
      ['another outside domain', 'nuna@yahoo.com'],
      ['a bare @', 'uyen@'],
      ['nothing before the domain', '@hoanglonglti.com'],
      ['an inner space', 'uyen sales'],
      ['a tab', 'uyen\tsales'],
      ['a stray @', 'uy@en'],
    ])('%s', (_label, typed) => {
      expect(toCompanyEmail(typed)).toBeNull();
    });

    it('refuses a local part that would overflow the address', () => {
      expect(toCompanyEmail('a'.repeat(320))).toBeNull();
    });
  });

  /**
   * ★ THE OLD DOMAIN IS NOW A FOREIGN ONE.
   *
   * `hoanglongti.com` (one `l`) was the policy until the company domain was
   * confirmed as `hoanglonglti.com`. The two differ by a single character, so a
   * stale copy of the old value would look right in review and quietly provision
   * accounts nobody can receive mail at. Pinned here so the change cannot be
   * half-reverted.
   */
  describe('the superseded domain is not the company domain', () => {
    it('does not unwrap a hoanglongti.com address as if it were ours', () => {
      // Not our suffix, so the whole thing stays the "local part" and then fails
      // validation on the `@` — rather than silently becoming `uyen`.
      expect(toLocalPart('uyen@hoanglongti.com')).toBe('uyen@hoanglongti.com');
      expect(toCompanyEmail('uyen@hoanglongti.com')).toBeNull();
    });

    it('builds addresses at the canonical domain only', () => {
      expect(toCompanyEmail('uyen')).toBe(`uyen@${COMPANY_EMAIL_DOMAIN}`);
      expect(COMPANY_EMAIL_DOMAIN).toBe('hoanglonglti.com');
    });
  });
});
