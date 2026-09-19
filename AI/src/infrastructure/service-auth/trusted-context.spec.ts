import { TrustedContextError } from '../../common/errors/domain.error';
import { signTrustedContext, verifyTrustedContext, type TrustedContext } from './trusted-context';

describe('trusted context (HMAC-SHA256)', () => {
  const secret = 'a-test-secret-of-at-least-32-characters!!';
  const now = new Date('2026-09-19T10:00:00Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const payload = (overrides: Partial<TrustedContext> = {}): TrustedContext => ({
    sub: '11111111-1111-4111-8111-111111111111',
    perms: ['alert.operational.write'],
    fn: ['dispatch'],
    aud: 'ai',
    iat: nowSeconds,
    exp: nowSeconds + 60,
    cid: 'req-42',
    ...overrides,
  });

  it('round-trips a valid token', () => {
    const token = signTrustedContext(payload(), secret);
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith('v1.')).toBe(true);
    expect(verifyTrustedContext(token, secret, now)).toEqual(payload());
  });

  it('refuses a tampered payload — the signature no longer matches', () => {
    const token = signTrustedContext(payload(), secret);
    const [version, body, signature] = token.split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...payload(), sub: '22222222-2222-4222-8222-222222222222' }),
      'utf8',
    ).toString('base64url');

    expect(() => verifyTrustedContext(`${version}.${forged}.${signature}`, secret, now)).toThrow(TrustedContextError);
    expect(() => verifyTrustedContext(`${version}.${body}.${signature.slice(0, -2)}AA`, secret, now)).toThrow(
      TrustedContextError,
    );
  });

  it('refuses a token signed with another secret', () => {
    const token = signTrustedContext(payload(), 'another-secret-of-at-least-32-characters');
    expect(() => verifyTrustedContext(token, secret, now)).toThrow(TrustedContextError);
  });

  it('refuses an expired token, and one whose exp is exactly now', () => {
    expect(() =>
      verifyTrustedContext(signTrustedContext(payload({ iat: nowSeconds - 120, exp: nowSeconds - 60 }), secret), secret, now),
    ).toThrow(TrustedContextError);
    expect(() =>
      verifyTrustedContext(signTrustedContext(payload({ exp: nowSeconds }), secret), secret, now),
    ).toThrow(TrustedContextError);
  });

  it('refuses an issued-after-expiry token', () => {
    expect(() =>
      verifyTrustedContext(signTrustedContext(payload({ iat: nowSeconds + 120, exp: nowSeconds + 60 }), secret), secret, now),
    ).toThrow(TrustedContextError);
  });

  it('refuses the wrong audience', () => {
    const token = signTrustedContext({ ...payload(), aud: 'backend' } as unknown as TrustedContext, secret);
    expect(() => verifyTrustedContext(token, secret, now)).toThrow(TrustedContextError);
  });

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['two parts', 'v1.abc'],
    ['four parts', 'v1.a.b.c'],
    ['unknown version', 'v2.abc.def'],
    ['garbage', 'not even close'],
  ])('refuses a malformed token: %s', (_label, token) => {
    expect(() => verifyTrustedContext(token, secret, now)).toThrow(TrustedContextError);
  });

  it('refuses a well-signed token whose payload is not the contract', () => {
    const token = signTrustedContext({ hello: 'world' } as unknown as TrustedContext, secret);
    expect(() => verifyTrustedContext(token, secret, now)).toThrow(TrustedContextError);
  });

  it('refuses everything when no secret is configured', () => {
    const token = signTrustedContext(payload(), secret);
    expect(() => verifyTrustedContext(token, '', now)).toThrow(TrustedContextError);
    expect(() => signTrustedContext(payload(), '')).toThrow(/without a secret/);
  });

  it('gives one message for every refusal, so a caller learns nothing about why', () => {
    const messages = new Set<string>();
    for (const token of ['', 'v1.a.b', signTrustedContext(payload({ exp: 1 }), secret)]) {
      try {
        verifyTrustedContext(token, secret, now);
      } catch (error) {
        messages.add((error as Error).message);
      }
    }
    expect(messages.size).toBe(1);
  });
});
