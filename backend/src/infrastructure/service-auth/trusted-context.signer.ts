import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../config/app.config';

/**
 * The backend's half of the trusted user context (ADR-0007 §H).
 *
 * When a person acts on an alert, the backend has already authenticated the
 * session and checked the `PermissionKey`. What it hands the AI is a SIGNED,
 * SHORT-LIVED statement of that fact:
 *
 *   v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
 *
 *   { sub, perms, fn, aud: 'ai', iat, exp, cid }
 *
 * The AI verifies the signature, audience and expiry and records `sub` as the
 * actor. It does NOT re-derive permissions — the backend already did, which is
 * why `perms` is a snapshot the AI may read (Phase 2 retrieval pre-filter) and
 * not a rule it evaluates.
 *
 * ★ NOT A SESSION TOKEN, NOT A JWT LIBRARY, NOT A NEW USER AUTH PATH. Sixty
 * seconds of validity, one audience, one hop. It cannot log anybody in.
 *
 * The same format is implemented, byte for byte, in
 * `AI/src/infrastructure/service-auth/trusted-context.ts`. Two copies on
 * purpose: the two applications share no source (ADR-0007), so the contract
 * is pinned by a test on each side rather than by an import.
 */

export const TRUSTED_CONTEXT_AUDIENCE = 'ai' as const;
const VERSION = 'v1';

/** Default lifetime. Long enough for one hop, short enough that replay is a stopwatch problem. */
export const TRUSTED_CONTEXT_TTL_SECONDS = 60;

export interface TrustedContext {
  sub: string;
  perms: readonly string[];
  fn: readonly string[];
  aud: typeof TRUSTED_CONTEXT_AUDIENCE;
  iat: number;
  exp: number;
  cid: string;
}

const mac = (secret: string, signed: string): Buffer =>
  createHmac('sha256', secret).update(signed, 'utf8').digest();

export function signTrustedContext(payload: TrustedContext, secret: string): string {
  if (secret.length === 0) throw new Error('Cannot sign a trusted context without TRUSTED_CONTEXT_SECRET.');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signed = `${VERSION}.${body}`;
  return `${signed}.${mac(secret, signed).toString('base64url')}`;
}

/**
 * The verifier, kept beside the signer so the format is tested from both
 * ends on this side too. Returns `null` on any refusal; the backend never
 * verifies these in production — the AI does.
 */
export function verifyTrustedContext(token: string, secret: string, now: Date = new Date()): TrustedContext | null {
  if (secret.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, signature] = parts as [string, string, string];

  const expected = mac(secret, `${VERSION}.${body}`);
  const presented = Buffer.from(signature, 'base64url');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;

  let parsed: TrustedContext;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TrustedContext;
  } catch {
    return null;
  }
  if (parsed.aud !== TRUSTED_CONTEXT_AUDIENCE) return null;
  if (typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(now.getTime() / 1000)) return null;
  return parsed;
}

/** Mints contexts with this deployment's secret. Unused until Phase 1c wires the alert gateway. */
@Injectable()
export class TrustedContextSigner {
  constructor(private readonly config: AppConfig) {}

  issue(
    claims: { sub: string; perms: readonly string[]; fn: readonly string[]; cid: string },
    options: { now?: Date; ttlSeconds?: number } = {},
  ): string {
    const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
    return signTrustedContext(
      {
        ...claims,
        aud: TRUSTED_CONTEXT_AUDIENCE,
        iat,
        exp: iat + (options.ttlSeconds ?? TRUSTED_CONTEXT_TTL_SECONDS),
      },
      this.config.trustedContextSecret,
    );
  }
}
