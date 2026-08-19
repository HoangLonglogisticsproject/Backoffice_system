import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../http/apiError';

const fetchAuthorization = vi.fn();
const fetchIdentity = vi.fn();

vi.mock('../api/auth.repository', () => ({
  fetchAuthorization: (...args: unknown[]) => fetchAuthorization(...args),
  fetchIdentity: (...args: unknown[]) => fetchIdentity(...args),
}));

const { current } = await import('./session.repository');

/**
 * The three session states (contract §3b), and the one that is usually missed.
 *
 * Two of the three are 403, so status alone cannot tell them apart — that is
 * why these assert on `code` too. Collapsing them is the lockout loop the
 * contract describes.
 */
describe('sessionRepository.current()', () => {
  const authorization = {
    userId: 'u1',
    username: 'admin',
    role: 'SUPERADMIN' as const,
    departmentIds: [],
    permissions: [],
  };

  beforeEach(() => {
    fetchAuthorization.mockReset();
    fetchIdentity.mockReset();
  });

  it('is READY when authorization resolves', async () => {
    fetchAuthorization.mockResolvedValue(authorization);

    await expect(current()).resolves.toEqual({ status: 'ready', authorization });
    expect(fetchIdentity).not.toHaveBeenCalled();
  });

  it('is ANONYMOUS on 401', async () => {
    fetchAuthorization.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Authentication required.'));

    await expect(current()).resolves.toEqual({ status: 'anonymous' });
  });

  it('is PASSWORD-CHANGE-REQUIRED on 403 with that code — NOT anonymous', async () => {
    // The decisive case. The session is alive: the cookie works, `/auth/me`
    // answers, and `POST /auth/password` is reachable. Reporting this as
    // anonymous sends the user to login, where logging in succeeds and lands
    // them right back here — the loop §3b forbids.
    const identity = { id: 'u1', displayName: 'New Joiner', status: 'active' as const };
    fetchAuthorization.mockRejectedValue(
      new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change required.'),
    );
    fetchIdentity.mockResolvedValue(identity);

    const state = await current();

    expect(state).toEqual({ status: 'password-change-required', identity });
    // The identity is fetched because the change-password screen shows who is
    // being changed — proof the session was treated as alive, not ended.
    expect(fetchIdentity).toHaveBeenCalledTimes(1);
  });

  it('RETHROWS a plain 403 — "not allowed" says nothing about the session', async () => {
    const forbidden = new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.');
    fetchAuthorization.mockRejectedValue(forbidden);

    await expect(current()).rejects.toBe(forbidden);
  });

  it('RETHROWS 409, so nothing mistakes a conflict for a session state', async () => {
    const conflict = new ApiError(409, 'CONFLICT', 'That user is already disabled.');
    fetchAuthorization.mockRejectedValue(conflict);

    await expect(current()).rejects.toBe(conflict);
  });

  it('RETHROWS a 500 rather than signing the user out on a blip', async () => {
    const boom = new ApiError(500, undefined, 'Internal server error');
    fetchAuthorization.mockRejectedValue(boom);

    await expect(current()).rejects.toBe(boom);
  });

  it('does not branch on message text, only status and code', async () => {
    // Same code, different wording: the decision must not move.
    fetchIdentity.mockResolvedValue({ id: 'u1', displayName: 'X', status: 'active' as const });
    fetchAuthorization.mockRejectedValue(
      new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'completely different wording'),
    );

    await expect(current()).resolves.toMatchObject({ status: 'password-change-required' });
  });
});
