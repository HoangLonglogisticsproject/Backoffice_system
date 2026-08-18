import {
  assertProvisionableEmail,
  domainOfEmail,
  localPartOfEmail,
  normalizeEmail,
} from './email';

/**
 * The provisioning-time email rules.
 *
 * Two things are being defended here, and they pull in opposite directions:
 * the check has to be strict enough that a malformed address never becomes an
 * account, and cheap enough that an unauthenticated caller cannot spend the
 * server's CPU by choosing a long input. The shape check is therefore written
 * as linear scans rather than as a pattern — see the module for why — and the
 * last group below is what would fail if anyone put the regex back.
 */
describe('provisioning email rules', () => {
  const anyDomain: readonly string[] = [];

  describe('normalizeEmail', () => {
    it('lowercases, so one address is one account', () => {
      expect(normalizeEmail('USER@Example.COM')).toBe('user@example.com');
    });

    it('trims, so a pasted address with a trailing space is the same address', () => {
      expect(normalizeEmail('  user@example.com \t')).toBe('user@example.com');
    });
  });

  describe('localPartOfEmail and domainOfEmail', () => {
    it('splits on the LAST @, which is the one that separates the two', () => {
      expect(localPartOfEmail('a@b@example.com')).toBe('a@b');
      expect(domainOfEmail('a@b@example.com')).toBe('example.com');
    });

    it('answers for an address with no @ rather than throwing', () => {
      // Both are display and comparison helpers reached from paths that have
      // already validated; returning something total keeps them from becoming a
      // second place that can fail.
      expect(localPartOfEmail('nonsense')).toBe('nonsense');
      expect(domainOfEmail('nonsense')).toBe('');
    });
  });

  describe('accepts', () => {
    it.each([
      'user@example.com',
      'first.last@example.com',
      'user+tag@example.com',
      'user@sub.example.co.uk',
      "o'brien@example.com",
      'user@example.travel',
    ])('%s', (address) => {
      expect(assertProvisionableEmail(address, anyDomain)).toBe(address);
    });

    it('returns the NORMALISED address, not the one it was given', () => {
      expect(assertProvisionableEmail('  USER@Example.com  ', anyDomain)).toBe(
        'user@example.com',
      );
    });
  });

  describe('refuses', () => {
    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
      ['no @', 'userexample.com'],
      ['two @', 'user@host@example.com'],
      ['nothing before the @', '@example.com'],
      ['nothing after the @', 'user@'],
      ['domain with no dot', 'user@example'],
      ['domain starting with a dot', 'user@.example.com'],
      ['domain ending with a dot', 'user@example.'],
      ['space inside the local part', 'first last@example.com'],
      ['space inside the domain', 'user@exa mple.com'],
      ['a tab', 'user\t@example.com'],
      ['a newline', 'user@example.com\n.com'],
    ])('%s', (_label, address) => {
      expect(() => assertProvisionableEmail(address, anyDomain)).toThrow(/Email/);
    });

    it('refuses an address longer than any transport accepts', () => {
      const tooLong = `${'a'.repeat(310)}@${'b'.repeat(20)}.com`;

      expect(tooLong.length).toBeGreaterThan(320);
      expect(() => assertProvisionableEmail(tooLong, anyDomain)).toThrow(/too long/i);
    });
  });

  describe('the domain allowlist', () => {
    const allowed = ['example.com', 'partner.example.org'];

    it('accepts an address in it', () => {
      expect(assertProvisionableEmail('user@partner.example.org', allowed)).toBe(
        'user@partner.example.org',
      );
    });

    it('compares AFTER normalising, so case never smuggles one through', () => {
      expect(assertProvisionableEmail('USER@EXAMPLE.COM', allowed)).toBe('user@example.com');
    });

    it('refuses an address outside it', () => {
      expect(() => assertProvisionableEmail('user@elsewhere.com', allowed)).toThrow(
        /not permitted/,
      );
    });

    it('refuses a subdomain of an allowed domain — the list is exact', () => {
      expect(() => assertProvisionableEmail('user@mail.example.com', allowed)).toThrow(
        /not permitted/,
      );
    });

    it('never names the allowlist in the error', () => {
      // Echoing the permitted domains back hands out the deployment's shape to
      // anyone who can reach the endpoint.
      try {
        assertProvisionableEmail('user@elsewhere.com', allowed);
        throw new Error('expected a refusal');
      } catch (error) {
        expect((error as Error).message).not.toContain('example.com');
      }
    });

    it('an empty allowlist means every domain passes', () => {
      expect(assertProvisionableEmail('user@anywhere.test', [])).toBe('user@anywhere.test');
    });
  });

  /**
   * The reason this module holds no pattern with a `+` in it.
   *
   * Each input below is the shape that makes a naive email regex backtrack: a
   * long domain with no dot, so every split point has to be tried. The budget
   * is generous enough not to be flaky on a loaded machine and still far below
   * what a super-linear matcher would spend — the O(n²) version takes visibly
   * longer at 100 000 characters, and this bounds it at the length check.
   */
  describe('pathological input', () => {
    const budgetMs = 250;

    const timed = (fn: () => void): number => {
      const started = process.hrtime.bigint();
      fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    it.each([100, 1_000, 10_000, 100_000])(
      'refuses a %i-character domain with no dot, in constant-ish time',
      (length) => {
        const address = `user@${'a'.repeat(length)}`;

        const elapsed = timed(() => {
          expect(() => assertProvisionableEmail(address, anyDomain)).toThrow(/Email/);
        });

        expect(elapsed).toBeLessThan(budgetMs);
      },
    );

    it('refuses a long run of dots without exploring every split', () => {
      const address = `user@${'a.'.repeat(50_000)}`;

      const elapsed = timed(() => {
        // This one is refused for LENGTH, which is exactly the point: the cheap
        // check runs before the shape check, so the expensive input never
        // reaches the scan at all.
        expect(() => assertProvisionableEmail(address, anyDomain)).toThrow(/too long/i);
      });

      expect(elapsed).toBeLessThan(budgetMs);
    });

    it('rejects on length BEFORE looking at shape', () => {
      const longAndMalformed = 'x'.repeat(400);

      expect(() => assertProvisionableEmail(longAndMalformed, anyDomain)).toThrow(/too long/i);
    });
  });
});
