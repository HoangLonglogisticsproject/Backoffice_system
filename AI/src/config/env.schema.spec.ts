import { validateEnv } from './env.schema';

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
