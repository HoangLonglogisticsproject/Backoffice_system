import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TrustedContextError } from '../../common/errors/domain.error';

/**
 * A user's trusted context: the backend's signed statement that it has
 * authenticated this person, checked their permission for this action, and
 * vouches for them — briefly.
 *
 *   v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
 *
 * HMAC-SHA256 because both sides hold the same secret and nothing else needs
 * to verify it: a signature scheme would add a key pair for no third party.
 * The AI VERIFIES; only the backend SIGNS. `sign` exists on this side so the
 * verifier can be tested without the backend, and so the format is pinned by
 * one file per side rather than described in prose.
 *
 * ★ THE AI READS `sub` AND `cid` AND NOTHING ELSE IN PHASE 1. `perms` and
 * `fn` travel from day one so Phase 2's retrieval pre-filter has them without
 * a contract change, but no code here turns them into a decision — that is
 * the backend's job, already done before the token was minted.
 */

export const TRUSTED_CONTEXT_AUDIENCE = 'ai' as const;
const VERSION = 'v1';

export const trustedContextSchema = z.object({
  /** The backend user id. Snapshotted by the AI as actor; never looked up. */
  sub: z.string().uuid(),
  /** Permission keys the backend found granted. Opaque tokens to the AI. */
  perms: z.array(z.string().min(1)),
  /** Department functions of the caller. Opaque tokens to the AI. */
  fn: z.array(z.string().min(1)),
  aud: z.literal(TRUSTED_CONTEXT_AUDIENCE),
  /** Seconds since the epoch, like a JWT — not milliseconds. */
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  /** Correlation id of the request the backend is acting for. */
  cid: z.string().min(1).max(200),
});

export type TrustedContext = z.infer<typeof trustedContextSchema>;

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const mac = (secret: string, signed: string): Buffer =>
  createHmac('sha256', secret).update(signed, 'utf8').digest();

/** Mints a token. The backend's signer is the production caller of this shape. */
export function signTrustedContext(payload: TrustedContext, secret: string): string {
  if (secret.length === 0) throw new Error('Cannot sign a trusted context without a secret.');
  const body = b64(JSON.stringify(payload));
  const signed = `${VERSION}.${body}`;
  return `${signed}.${mac(secret, signed).toString('base64url')}`;
}

/**
 * Verifies a token or throws `TrustedContextError` (→ 401).
 *
 * Signature first, then shape, then audience and expiry. The signature check
 * is constant-time on equal-length buffers; a length mismatch is refused
 * before comparing, which leaks only that the token is malformed.
 */
export function verifyTrustedContext(token: unknown, secret: string, now: Date = new Date()): TrustedContext {
  const refuse = (): never => {
    throw new TrustedContextError('Trusted context is missing, invalid or expired.');
  };

  if (secret.length === 0) return refuse();
  if (typeof token !== 'string') return refuse();

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return refuse();
  const [, body, signature] = parts as [string, string, string];

  const expected = mac(secret, `${VERSION}.${body}`);
  const presented = Buffer.from(signature, 'base64url');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return refuse();

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return refuse();
  }

  const result = trustedContextSchema.safeParse(parsed);
  if (!result.success) return refuse();

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (result.data.exp <= nowSeconds) return refuse();
  if (result.data.iat > result.data.exp) return refuse();

  return result.data;
}
