import type { AppConfig } from '../../config/app.config';
import {
  signTrustedContext,
  TRUSTED_CONTEXT_CLOCK_SKEW_SECONDS,
  TRUSTED_CONTEXT_MAX_TTL_SECONDS,
  TRUSTED_CONTEXT_TTL_SECONDS,
  TrustedContextSigner,
  verifyTrustedContext,
} from './trusted-context.signer';

describe('trusted context signer', () => {
  const secret = 'a-test-secret-of-at-least-32-characters!!';
  const now = new Date('2026-09-19T10:00:00Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const claims = { sub: '11111111-1111-4111-8111-111111111111', perms: ['trip.read'], fn: ['dispatch'], cid: 'req-1' };

  const signer = (configured: string) =>
    new TrustedContextSigner({ trustedContextSecret: configured } as unknown as AppConfig);

  it('issues a v1 token with audience ai, iat now, exp now + 60s by default', () => {
    const token = signer(secret).issue(claims, { now });
    const payload = verifyTrustedContext(token, secret, now);
    expect(payload).toEqual({ ...claims, aud: 'ai', iat: nowSeconds, exp: nowSeconds + TRUSTED_CONTEXT_TTL_SECONDS });
  });

  it('honours a custom ttl', () => {
    const payload = verifyTrustedContext(signer(secret).issue(claims, { now, ttlSeconds: 5 }), secret, now);
    expect(payload?.exp).toBe(nowSeconds + 5);
  });

  it("refuses to issue a token that outlives the verifier's maximum — the contract is short-lived", () => {
    expect(() => signer(secret).issue(claims, { now, ttlSeconds: TRUSTED_CONTEXT_MAX_TTL_SECONDS + 1 })).toThrow(
      /lives at most/,
    );
    expect(() => signer(secret).issue(claims, { now, ttlSeconds: 0 })).toThrow(/lives at most/);
    expect(verifyTrustedContext(signer(secret).issue(claims, { now, ttlSeconds: TRUSTED_CONTEXT_MAX_TTL_SECONDS }), secret, now)).not.toBeNull();
  });

  it("mirrors the verifier's window: future iat beyond skew, over-long life, expired beyond skew", () => {
    const base = { ...claims, aud: 'ai' as const };
    const s = (iat: number, exp: number) => signTrustedContext({ ...base, iat, exp }, secret);

    expect(verifyTrustedContext(s(nowSeconds + TRUSTED_CONTEXT_CLOCK_SKEW_SECONDS + 1, nowSeconds + 90), secret, now)).toBeNull();
    expect(verifyTrustedContext(s(nowSeconds + TRUSTED_CONTEXT_CLOCK_SKEW_SECONDS, nowSeconds + 90), secret, now)).not.toBeNull();
    expect(verifyTrustedContext(s(nowSeconds, nowSeconds + TRUSTED_CONTEXT_MAX_TTL_SECONDS + 1), secret, now)).toBeNull();
    expect(verifyTrustedContext(s(nowSeconds - 120, nowSeconds - TRUSTED_CONTEXT_CLOCK_SKEW_SECONDS - 1), secret, now)).toBeNull();
    expect(verifyTrustedContext(s(nowSeconds - 60, nowSeconds - TRUSTED_CONTEXT_CLOCK_SKEW_SECONDS + 1), secret, now)).not.toBeNull();
  });

  it('refuses to sign when the secret is not configured — no silent unsigned context', () => {
    expect(() => signer('').issue(claims)).toThrow(/TRUSTED_CONTEXT_SECRET/);
  });

  it('what it signs, only the same secret verifies', () => {
    const token = signer(secret).issue(claims, { now });
    expect(verifyTrustedContext(token, 'another-secret-of-at-least-32-characters', now)).toBeNull();
    // 61 s after issue is 1 s past expiry — inside the 30 s skew, so still accepted; 91 s is not.
    expect(verifyTrustedContext(token, secret, new Date(now.getTime() + 61_000))).not.toBeNull();
    expect(verifyTrustedContext(token, secret, new Date(now.getTime() + 91_000))).toBeNull();
    expect(verifyTrustedContext(`${token}x`, secret, now)).toBeNull();
  });

  it('pins the wire format the AI side implements independently', () => {
    const token = signTrustedContext({ ...claims, aud: 'ai', iat: 1, exp: 2 }, secret);
    const [version, body, signature] = token.split('.');
    expect(version).toBe('v1');
    expect(JSON.parse(Buffer.from(body as string, 'base64url').toString('utf8'))).toEqual({
      ...claims,
      aud: 'ai',
      iat: 1,
      exp: 2,
    });
    expect(Buffer.from(signature as string, 'base64url')).toHaveLength(32);
  });
});
