import type { Database } from '../../../common/types/database.port';
import { SessionRepository } from '../persistence/session.repository';
import { SessionService, __hashTokenForTest } from './session.service';

/**
 * Sessions decide who is logged in on every single request, so the cases that
 * matter are the ones where the answer must be "nobody": revoked, expired, and
 * an account disabled after the token was issued.
 */
describe('SessionService', () => {
  let rows: unknown[];
  let queries: Array<{ sql: string; params: readonly unknown[] | undefined }>;
  let service: SessionService;

  beforeEach(() => {
    rows = [];
    queries = [];

    const db: Database = {
      query: jest.fn(async (sql: string, params?: readonly unknown[]) => {
        queries.push({ sql, params });
        return rows as never[];
      }),
      transaction: jest.fn(),
    };

    // The repository is real, wrapping the fake port: the SQL it emits is
    // still asserted below, so moving the SQL did not weaken this suite.
    service = new SessionService(new SessionRepository(db as unknown as Database));
  });

  const activeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'session-1',
    user_id: 'user-1',
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: null,
    u_display_name: 'A Person',
    u_status: 'active',
    ...overrides,
  });

  describe('issue', () => {
    it('stores only the hash, never the token itself', async () => {
      const { token } = await service.issue('user-1');

      const insert = queries.find((q) => q.sql.includes('INSERT INTO sessions'));
      const stored = insert?.params?.[1] as string;

      // A dump of `sessions` must hand an attacker nothing they can present.
      expect(stored).not.toBe(token);
      expect(stored).toBe(__hashTokenForTest(token));
      expect(JSON.stringify(queries)).not.toContain(token);
    });

    it('issues a high-entropy token and a future expiry', async () => {
      const { token, expiresAt } = await service.issue('user-1');

      // 32 random bytes, base64url — no padding, comfortably beyond guessing.
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('never issues the same token twice', async () => {
      const issued = await Promise.all([service.issue('u'), service.issue('u'), service.issue('u')]);
      expect(new Set(issued.map((s) => s.token)).size).toBe(3);
    });
  });

  describe('resolve', () => {
    it('returns the user for a live session', async () => {
      rows = [activeRow()];

      await expect(service.resolve('tok')).resolves.toEqual({
        id: 'user-1',
        displayName: 'A Person',
        status: 'active',
      });
    });

    it('looks the session up by hash, so the raw token never reaches SQL', async () => {
      rows = [activeRow()];
      await service.resolve('tok');

      expect(queries[0]?.params?.[0]).toBe(__hashTokenForTest('tok'));
    });

    it('returns null for an unknown token', async () => {
      rows = [];
      await expect(service.resolve('nope')).resolves.toBeNull();
    });

    it('returns null for an expired session', async () => {
      rows = [activeRow({ expires_at: new Date(Date.now() - 1) })];
      await expect(service.resolve('tok')).resolves.toBeNull();
    });

    it('returns null for a revoked session — this is what logout means', async () => {
      rows = [activeRow({ revoked_at: new Date() })];
      await expect(service.resolve('tok')).resolves.toBeNull();
    });

    it('returns null when the user was disabled after logging in', async () => {
      rows = [activeRow({ u_status: 'disabled' })];

      // Status is re-checked on every request, not only at login: disabling an
      // account has to take effect now, not whenever the session expires.
      await expect(service.resolve('tok')).resolves.toBeNull();
    });
  });

  describe('revoke', () => {
    it('marks the session revoked by hash and leaves the row in place', async () => {
      await service.revoke('tok');

      const update = queries[0];
      expect(update?.sql).toContain('UPDATE sessions SET revoked_at');
      expect(update?.sql).toContain('revoked_at IS NULL');
      expect(update?.params?.[0]).toBe(__hashTokenForTest('tok'));
    });

    it('is idempotent — revoking twice or revoking nothing is not an error', async () => {
      await expect(service.revoke('tok')).resolves.toBeUndefined();
      await expect(service.revoke('tok')).resolves.toBeUndefined();
      await expect(service.revoke('never-existed')).resolves.toBeUndefined();
    });

    it('can end every session a user holds', async () => {
      await service.revokeAllForUser('user-1');

      expect(queries[0]?.sql).toContain('WHERE user_id = $1');
      expect(queries[0]?.params?.[0]).toBe('user-1');
    });
  });
});
