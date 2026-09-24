import { MIN_SCAN_INTERVAL_MS, validateEnv } from './env.schema';

/**
 * Configuration must fail LOUDLY. A service that boots pointing at the wrong
 * database, or accepting an empty bearer secret, is worse than one that
 * refuses to boot.
 */
describe('validateEnv (AI)', () => {
  const secret = 'x'.repeat(32);
  const valid = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    SERVICE_TOKEN_BACKEND_TO_AI: secret,
    TRUSTED_CONTEXT_SECRET: secret,
  };

  it('applies defaults for everything optional', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3100);
    expect(env.LOG_LEVEL).toBe('log');
    expect(env.DB_SCHEMA).toBe('ai');
  });

  it('refuses to start without DATABASE_URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('refuses a non-PostgreSQL connection string', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(/PostgreSQL/);
  });

  describe('the two secrets', () => {
    it('are required', () => {
      expect(() => validateEnv({ ...valid, SERVICE_TOKEN_BACKEND_TO_AI: undefined })).toThrow(
        /SERVICE_TOKEN_BACKEND_TO_AI/,
      );
      expect(() => validateEnv({ ...valid, TRUSTED_CONTEXT_SECRET: undefined })).toThrow(/TRUSTED_CONTEXT_SECRET/);
    });

    it('refuse anything shorter than 32 characters — a typed value is not a secret', () => {
      expect(() => validateEnv({ ...valid, SERVICE_TOKEN_BACKEND_TO_AI: 'short' })).toThrow(/at least 32/);
      expect(() => validateEnv({ ...valid, TRUSTED_CONTEXT_SECRET: 'x'.repeat(31) })).toThrow(/at least 32/);
    });

    it('do not appear in the error message', () => {
      const leaked = 'S3CR3T-VALUE-THAT-MUST-NOT-LEAK';
      expect(() => validateEnv({ ...valid, SERVICE_TOKEN_BACKEND_TO_AI: leaked })).toThrow(
        expect.not.objectContaining({ message: expect.stringContaining(leaked) }),
      );
    });
  });

  describe('SCAN_INTERVAL — a technical floor, and an empty value that means unset', () => {
    it('is optional: absent leaves the scheduler unarmed', () => {
      expect(validateEnv({ ...valid, SCAN_INTERVAL: undefined }).SCAN_INTERVAL).toBeUndefined();
    });

    it('★ an EMPTY value means unset, not malformed', () => {
      // `SCAN_INTERVAL: ${SCAN_INTERVAL}` in a compose file renders exactly
      // this when the host variable is not exported. Refusing to boot on it
      // would take the Alert API down over a variable that only governs
      // scanning.
      expect(validateEnv({ ...valid, SCAN_INTERVAL: '' }).SCAN_INTERVAL).toBeUndefined();
    });

    it('★ a WHITESPACE-ONLY value means unset too', () => {
      expect(validateEnv({ ...valid, SCAN_INTERVAL: '   ' }).SCAN_INTERVAL).toBeUndefined();
    });

    it.each(['0s', '1ms', '999ms'])('refuses %s — below the technical floor', (value) => {
      expect(() => validateEnv({ ...valid, SCAN_INTERVAL: value })).toThrow(/SCAN_INTERVAL must be at least/);
    });

    it('says the floor is a guard rail, not the cadence', () => {
      expect(() => validateEnv({ ...valid, SCAN_INTERVAL: '0s' })).toThrow(/NOT the operational scan cadence/);
    });

    it(`accepts EXACTLY the floor (${MIN_SCAN_INTERVAL_MS}ms)`, () => {
      expect(validateEnv({ ...valid, SCAN_INTERVAL: '1000ms' }).SCAN_INTERVAL).toBe(MIN_SCAN_INTERVAL_MS);
      expect(validateEnv({ ...valid, SCAN_INTERVAL: '1s' }).SCAN_INTERVAL).toBe(MIN_SCAN_INTERVAL_MS);
    });

    it('accepts an ordinary larger interval', () => {
      expect(validateEnv({ ...valid, SCAN_INTERVAL: '5m' }).SCAN_INTERVAL).toBe(300_000);
    });

    it.each(['300', 'soon', '5 m', '-1s', '5x'])('refuses %j — present but not a duration', (value) => {
      // Malformed is NOT normalised away: only an empty value means unset.
      expect(() => validateEnv({ ...valid, SCAN_INTERVAL: value })).toThrow(/SCAN_INTERVAL/);
    });

    it('★ no production cadence is defaulted anywhere', () => {
      // The floor exists so a misconfiguration cannot hot-loop. It is not a
      // decision about how often to scan, and nothing supplies one.
      expect(validateEnv(valid).SCAN_INTERVAL).toBeUndefined();
    });
  });

  describe('the other optional durations treat empty the same way', () => {
    it.each([
      'DETECTOR_UNASSIGNED_TRIP_HIGH_LEAD',
      'DETECTOR_STALE_START_GRACE',
      'DETECTOR_STALE_START_HIGH_AFTER',
      'DETECTOR_COMPLETION_REVIEW_HIGH_AFTER',
    ])('%s: empty means unset, so the threshold stays TBD', (name) => {
      expect(validateEnv({ ...valid, [name]: '' })[name as 'DETECTOR_STALE_START_GRACE']).toBeUndefined();
      expect(() => validateEnv({ ...valid, [name]: 'nonsense' })).toThrow(new RegExp(name));
    });
  });

  describe('a defaulted duration falls back to its approved value when empty', () => {
    it.each([
      ['DETECTOR_UNASSIGNED_TRIP_WARNING_LEAD', 2 * 3_600_000],
      ['DETECTOR_COMPLETION_REVIEW_WARNING_AFTER', 12 * 3_600_000],
      ['BACKEND_TIMEOUT', 10_000],
      ['SCAN_INITIAL_DELAY', 0],
    ])('%s falls back to %i ms', (name, expected) => {
      const env = validateEnv({ ...valid, [name]: '' }) as unknown as Record<string, number>;
      expect(env[name]).toBe(expected);
    });
  });

  describe('DB_SCHEMA is an identifier, never a SQL fragment', () => {
    it.each(['ai', 'ai_itest_7f3a', '_private'])('accepts %s', (name) => {
      expect(validateEnv({ ...valid, DB_SCHEMA: name }).DB_SCHEMA).toBe(name);
    });

    it.each([
      'ai; DROP SCHEMA public',
      'ai,public',
      'Ai',
      '"ai"',
      'ai schema',
      '1ai',
      '',
      'a'.repeat(64),
      'ai.public',
    ])('refuses %j', (name) => {
      expect(() => validateEnv({ ...valid, DB_SCHEMA: name })).toThrow(/DB_SCHEMA/);
    });
  });
});
