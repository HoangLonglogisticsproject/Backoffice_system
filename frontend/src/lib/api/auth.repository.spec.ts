import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();

vi.mock('../http/client', () => ({
  httpClient: {
    post: (...args: unknown[]) => post(...args),
    get: (...args: unknown[]) => get(...args),
  },
}));

const { login, logout, changePassword, fetchIdentity, fetchAuthorization } = await import(
  './auth.repository'
);

describe('auth repository', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    post.mockResolvedValue({ data: {} });
    get.mockResolvedValue({ data: {} });
  });

  describe('login', () => {
    it('sends the email as `subject`, never as `email` (§1)', async () => {
      // The single most common way this integration is got wrong. Sending
      // `email` is a 422, and the mapping belongs here so no caller repeats it.
      await login('admin@example.com', 'a passphrase');

      expect(post).toHaveBeenCalledWith('/auth/login', {
        subject: 'admin@example.com',
        password: 'a passphrase',
      });

      const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('username');
    });

    it('returns the identity and expiry, and never a token (§1)', async () => {
      const data = {
        user: { id: 'u1', displayName: 'Root Admin', status: 'active' },
        expiresAt: '2026-08-18T20:30:44.911Z',
      };
      post.mockResolvedValue({ data });

      const result = await login('a@b.test', 'pw');

      expect(result).toEqual(data);
      // There is no token in the response and there never will be — the
      // session is an HttpOnly cookie. A field named like one would invite
      // somebody to store it.
      expect(JSON.stringify(result)).not.toMatch(/token/i);
    });
  });

  it('changePassword sends both passwords (§1)', async () => {
    await changePassword('old one', 'a new long passphrase');

    expect(post).toHaveBeenCalledWith('/auth/password', {
      currentPassword: 'old one',
      newPassword: 'a new long passphrase',
    });
  });

  it('logout posts, so the server revokes rather than the client forgetting', async () => {
    await logout();
    expect(post).toHaveBeenCalledWith('/auth/logout');
  });

  it('reads identity and authorization from their own endpoints', async () => {
    await fetchIdentity();
    expect(get).toHaveBeenCalledWith('/auth/me');

    // `fetchAuthorization` now checks that the body is actually a session, so
    // the blanket `{}` stub the other cases share is no longer enough here —
    // see `authorization.contract.spec.ts` for why that check exists.
    get.mockResolvedValue({
      data: {
        userId: 'fab71f53-0000-4000-8000-000000000000',
        username: 'boss',
        role: 'SUPERADMIN',
        departmentIds: [],
        permissions: [],
      },
    });

    await fetchAuthorization();
    expect(get).toHaveBeenCalledWith('/authorization/me');
  });
});
