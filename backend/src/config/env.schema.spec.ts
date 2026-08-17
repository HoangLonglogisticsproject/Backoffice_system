import { validateEnv } from './env.schema';

/**
 * Configuration is the one thing that must fail LOUDLY. A deployment that
 * boots pointing at the wrong database is worse than one that refuses to boot,
 * so these tests assert the refusal.
 */
describe('validateEnv', () => {
  const valid = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

  it('applies defaults for everything optional', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('log');
  });

  it('refuses to start without DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuses a non-PostgreSQL connection string', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/PostgreSQL/);
  });

  describe('DATABASE_URL is validated by parsing, not by prefix', () => {
    // A prefix check accepts strings that cannot connect, and the failure then
    // arrives as a connection error that reads like the database is down
    // rather than like the URL is wrong.
    it('refuses a URL with no host', () => {
      expect(() => validateEnv({ DATABASE_URL: 'postgres:///db' })).toThrow(/host/);
    });

    it('refuses a URL that names no database', () => {
      expect(() => validateEnv({ DATABASE_URL: 'postgres://user:pw@localhost:5432' })).toThrow(
        /database/,
      );
    });

    it('refuses something that is not a URL at all', () => {
      expect(() => validateEnv({ DATABASE_URL: 'not a url' })).toThrow(/valid URL/);
    });

    it('accepts both accepted schemes', () => {
      for (const url of [
        'postgres://user:pw@localhost:5432/backoffice',
        'postgresql://user:pw@db.internal:5432/backoffice',
      ]) {
        expect(validateEnv({ ...valid, DATABASE_URL: url }).DATABASE_URL).toBe(url);
      }
    });
  });

  describe('TRUST_PROXY_HOPS', () => {
    it('defaults to trusting NO proxy, so X-Forwarded-For cannot be forged', () => {
      // The login throttle keys on the client address. Trusting a header by
      // default would hand an attacker a fresh budget per request.
      expect(validateEnv(valid).TRUST_PROXY_HOPS).toBe(0);
    });

    it('accepts a hop count for a deployment that really is behind a proxy', () => {
      expect(validateEnv({ ...valid, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    });

    it('rejects a negative hop count', () => {
      expect(() => validateEnv({ ...valid, TRUST_PROXY_HOPS: '-1' })).toThrow();
    });
  });

  it('coerces PORT from string, because env vars are always strings', () => {
    expect(validateEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => validateEnv({ ...valid, PORT: '70000' })).toThrow();
  });

  describe('CORS_ORIGINS', () => {
    it('defaults to empty, which means CORS stays off — the secure default', () => {
      expect(validateEnv(valid).CORS_ORIGINS).toEqual([]);
    });

    it('parses a comma-separated allowlist and trims it', () => {
      const env = validateEnv({
        ...valid,
        CORS_ORIGINS: 'http://localhost:4200, https://app.example.com ',
      });

      expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200', 'https://app.example.com']);
    });

    it('REFUSES a wildcard', () => {
      // A wildcard cannot be combined with cookie credentials: the browser
      // would reject the response, and if it did not, any site could read
      // authenticated data. Better to fail at boot than to ship it.
      expect(() => validateEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(/explicit origins/);
      expect(() => validateEnv({ ...valid, CORS_ORIGINS: 'http://a.test,*' })).toThrow();
    });
  });

  it('reports every problem at once, not one per restart', () => {
    // Three separate mistakes: an invalid enum, an uncoercible number, and a
    // missing required value. Someone setting this up for the first time should
    // see all three, not discover them one restart at a time.
    let message = '';
    try {
      validateEnv({ NODE_ENV: 'staging', PORT: 'abc' });
    } catch (error) {
      message = (error as Error).message;
    }

    // Asserted independently rather than as one ordered regex. The previous
    // form was `/NODE_ENV.*PORT.*DATABASE_URL|DATABASE_URL.*/`, whose second
    // alternative matched on DATABASE_URL alone — so the test passed while
    // reporting exactly the one problem it existed to prove was not alone.
    expect(message).toContain('NODE_ENV');
    expect(message).toContain('PORT');
    expect(message).toContain('DATABASE_URL');
  });
});
