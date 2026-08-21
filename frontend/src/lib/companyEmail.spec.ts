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
    expect(COMPANY_EMAIL_DOMAIN).toBe('hoanglongti.com');
  });

  describe('builds the address from a local part', () => {
    it.each([
      ['uyen', 'uyen@hoanglongti.com'],
      ['nuna', 'nuna@hoanglongti.com'],
      ['uyen.sales', 'uyen.sales@hoanglongti.com'],
      ['nguyen-anh', 'nguyen-anh@hoanglongti.com'],
      ['hoang_duc', 'hoang_duc@hoanglongti.com'],
    ])('%s → %s', (typed, expected) => {
      expect(toCompanyEmail(typed)).toBe(expected);
    });

    it('trims, because a paste carries whitespace', () => {
      expect(toCompanyEmail('  uyen \t')).toBe('uyen@hoanglongti.com');
    });

    it('does NOT lowercase — the server owns normalisation', () => {
      // A second copy of that rule on this side is a second thing that can
      // disagree with the real one.
      expect(toCompanyEmail('Uyen')).toBe('Uyen@hoanglongti.com');
    });
  });

  describe('a pasted full address', () => {
    it('is unwrapped rather than doubled', () => {
      expect(toCompanyEmail('uyen@hoanglongti.com')).toBe('uyen@hoanglongti.com');
      expect(toLocalPart('uyen@hoanglongti.com')).toBe('uyen');
    });

    it('is unwrapped whatever case the domain was pasted in', () => {
      expect(toCompanyEmail('uyen@HoangLongTI.com')).toBe('uyen@hoanglongti.com');
    });

    it('never produces the double domain', () => {
      expect(toCompanyEmail('uyen@hoanglongti.com')).not.toContain(
        'hoanglongti.com@hoanglongti.com',
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
      ['nothing before the domain', '@hoanglongti.com'],
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
});
