import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseQuery } from '../../../common/types/database.port';
import { SessionRepository } from '../persistence/session.repository';
import { User, UserStatus } from '../../users/domain/user.entity';

/**
 * Server-side sessions, addressed by an opaque bearer token.
 *
 * Chosen over a signed stateless token for one reason: logout has to actually
 * log out. Revoking a JWT needs a denylist, a denylist needs storage and a
 * lookup on every request — which is this table, only with a signature layer
 * and an expiry-skew problem on top. Fewer moving parts win.
 *
 * No refresh tokens, no rotation, no sliding expiry. Those solve problems a
 * short-lived access token creates, and a backoffice with a server-side
 * session does not have them.
 *
 * ⚠ DEAD ROWS ARE NEVER SWEPT, and that is a decision rather than an oversight.
 *
 * Expired and revoked sessions accumulate. They are inert — `resolve` rejects
 * both, so this is table size, not access — which is why the answer is not a
 * scheduler inside the application. Adding one would mean a job runner, a
 * leader-election story for multiple replicas, and a failure mode, all to run a
 * single statement that a deployment's own cron already knows how to run:
 *
 *   DELETE FROM sessions
 *    WHERE expires_at < now() - interval '30 days'
 *       OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days');
 *
 * The window keeps recent rows readable for "when did this session end, and
 * how". `idx_sessions_expires_at` exists to make that delete cheap.
 */

/** 256 bits from the CSPRNG — long enough that guessing is not a threat model. */
const TOKEN_BYTES = 32;

/** Fixed lifetime. Re-login is cheap in a backoffice; silent extension is not. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  displayName: string;
  status: UserStatus;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(private readonly sessions: SessionRepository) {}

  /**
   * Issues a session and returns the token ONCE.
   *
   * Only the hash is stored, so this value cannot be recovered later — a dump
   * of `sessions` hands an attacker nothing they can present.
   */
  async issue(userId: string, now: Date = new Date()): Promise<IssuedSession> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    await this.sessions.insert({ userId, tokenHash: hashToken(token), expiresAt });

    return { token, expiresAt };
  }

  /**
   * Resolves a bearer token to its user, or null.
   *
   * Returns null — never throws and never distinguishes — for every failure:
   * unknown token, expired, revoked, or a user disabled since they logged in.
   * The caller answers 401 for all of them, so none of them is a probe.
   */
  async resolve(token: string, now: Date = new Date()): Promise<SessionUser | null> {
    const row = await this.sessions.findByTokenHash(hashToken(token));
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (row.expires_at.getTime() <= now.getTime()) return null;

    // Checked on every request, not only at login: disabling an account has to
    // take effect now, not when their session happens to expire.
    if (row.u_status !== 'active') return null;

    return { id: row.user_id, displayName: row.u_display_name, status: row.u_status };
  }

  /** Logout. Idempotent: revoking an unknown or already-revoked token is a no-op. */
  async revoke(token: string, now: Date = new Date()): Promise<void> {
    await this.sessions.revokeByTokenHash(hashToken(token), now);
  }

  /**
   * Every session for a user — for disabling an account or a forced sign-out.
   *
   * Takes an optional EXECUTOR, and that parameter is the whole point: cutting
   * somebody's sessions is never a standalone act. It happens while their roles
   * are being revoked, or while global authority is being handed over, and all
   * of it must commit together or not at all. `Database.transaction()` hands
   * its callback a different connection, so a caller inside a transaction must
   * pass it here — otherwise this statement runs on the pool and commits on its
   * own, which is a partial commit that stays invisible until the surrounding
   * transaction is the one that fails.
   *
   * Defaulting to `this.db` keeps every existing single-statement caller
   * unchanged.
   */
  async revokeAllForUser(
    userId: string,
    now: Date = new Date(),
    executor?: DatabaseQuery,
  ): Promise<void> {
    await this.sessions.revokeAllForUser(userId, now, executor);
  }
}

/**
 * SHA-256, deliberately — NOT a password hash.
 *
 * The token is 256 random bits, so there is no dictionary to slow down. A
 * memory-hard KDF here would add ~100 ms to *every authenticated request* and
 * hand anyone a trivial denial of service. Slow hashing defends low-entropy
 * secrets; this is not one.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Exported for tests that need to assert the stored form, never for lookup. */
export const __hashTokenForTest = hashToken;

/** Narrow a full user to what a session exposes. */
export const toSessionUser = (user: User): SessionUser => ({
  id: user.id,
  displayName: user.displayName,
  status: user.status,
});
