import {
  assertPasswordAcceptable,
  assertTemporaryPasswordAcceptable,
  PASSWORD_POLICY,
  TEMPORARY_PASSWORD_POLICY,
} from './password.policy';

/**
 * Two secrets, two floors.
 *
 * The split is a business decision and it is easy to undo by accident — one
 * import changed at a call site and onboarding starts refusing the passwords an
 * administrator is told to hand out, or a permanent password stops being held
 * to the rule that protects it. These tests pin both directions.
 */
describe('password policies', () => {
  const of = (length: number): string => 'x'.repeat(length);

  describe('the permanent policy', () => {
    it('refuses anything below its floor', () => {
      expect(() => assertPasswordAcceptable(of(PASSWORD_POLICY.minLength - 1))).toThrow(
        /at least 12/,
      );
    });

    it('accepts exactly the floor', () => {
      expect(() => assertPasswordAcceptable(of(PASSWORD_POLICY.minLength))).not.toThrow();
    });

    it('refuses above the ceiling, which exists to bound scrypt work', () => {
      expect(() => assertPasswordAcceptable(of(PASSWORD_POLICY.maxLength + 1))).toThrow(
        /at most/,
      );
    });

    it('has no composition rule — length is what buys entropy', () => {
      expect(() => assertPasswordAcceptable('correct horse battery staple')).not.toThrow();
    });
  });

  describe('the temporary policy', () => {
    it('accepts the eight-character credential an administrator hands over', () => {
      // The business decided onboarding credentials are dictated, not chosen:
      // '12345678' is a legal one, and refusing it would only move it onto
      // paper.
      expect(() => assertTemporaryPasswordAcceptable('12345678')).not.toThrow();
    });

    it('still refuses shorter than the NIST floor', () => {
      expect(() => assertTemporaryPasswordAcceptable(of(7))).toThrow(/at least 8/);
    });

    it('refuses an empty secret', () => {
      expect(() => assertTemporaryPasswordAcceptable('')).toThrow(/at least 8/);
    });

    it('keeps the same ceiling — the scrypt cost is identical', () => {
      expect(TEMPORARY_PASSWORD_POLICY.maxLength).toBe(PASSWORD_POLICY.maxLength);
      expect(() => assertTemporaryPasswordAcceptable(of(PASSWORD_POLICY.maxLength + 1))).toThrow(
        /at most/,
      );
    });
  });

  describe('the relationship between them', () => {
    it('the temporary floor is lower, and that asymmetry is the whole point', () => {
      expect(TEMPORARY_PASSWORD_POLICY.minLength).toBeLessThan(PASSWORD_POLICY.minLength);
    });

    it('a secret legal as temporary is NOT necessarily legal as permanent', () => {
      const handedOver = '12345678';

      expect(() => assertTemporaryPasswordAcceptable(handedOver)).not.toThrow();
      // Which is what forces the person to choose a real one: the credential
      // they were given cannot be kept.
      expect(() => assertPasswordAcceptable(handedOver)).toThrow(/at least 12/);
    });

    it('a permanent secret is always legal as temporary', () => {
      expect(() => assertTemporaryPasswordAcceptable(of(PASSWORD_POLICY.minLength))).not.toThrow();
    });
  });
});
