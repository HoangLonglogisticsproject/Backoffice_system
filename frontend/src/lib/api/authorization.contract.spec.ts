import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();

vi.mock('../http/client', () => ({
  httpClient: { get: (...args: unknown[]) => get(...args) },
}));

const { fetchAuthorization } = await import('./auth.repository');
const { isApiError } = await import('../http/apiError');

/**
 * REGRESSION: the crash when `VITE_API_URL` is unset.
 *
 * With no env file the client falls back to same-origin, which in development
 * is the VITE DEV SERVER, not the API. Vite answers an unknown path with
 * `index.html` and a 200 — so this function returned a string of HTML typed as
 * `AuthorizationMe`, the session repository wrapped it as a READY session, and
 * `MainLayout` crashed on `initialsOf(undefined)`:
 *
 *   TypeError: Cannot read properties of undefined (reading 'split')
 *
 * The generic on `httpClient.get<T>` is a compile-time assertion and checks
 * nothing at runtime, which is why the shape has to be checked here.
 */
describe('fetchAuthorization — the body has to actually be a session', () => {
  const VALID = {
    userId: 'fab71f53-0000-4000-8000-000000000000',
    username: 'boss',
    role: 'SUPERADMIN',
    departmentIds: [],
    permissions: ['user.write'],
  };

  beforeEach(() => get.mockReset());

  it('returns the session when the body is one', async () => {
    get.mockResolvedValue({ data: VALID });
    await expect(fetchAuthorization()).resolves.toEqual(VALID);
  });

  it('accepts a null username, because the server can send one', async () => {
    // An account with no local subject has no local part to derive from.
    get.mockResolvedValue({ data: { ...VALID, username: null } });

    const me = await fetchAuthorization();
    expect(me.username).toBeNull();
  });

  it('★ REFUSES the Vite index.html that a missing VITE_API_URL produces', async () => {
    // The exact failure: HTTP 200, wrong origin, HTML body.
    get.mockResolvedValue({
      data: '<!doctype html><html><head><title>Vite</title></head><body></body></html>',
    });

    await expect(fetchAuthorization()).rejects.toThrow(/did not return a session|VITE_API_URL/);
  });

  it('the refusal is an ApiError, so the session layer can classify it', async () => {
    get.mockResolvedValue({ data: '<!doctype html>' });

    // Not a 401/403, so `current()` rethrows and the provider falls back to
    // anonymous — the normal login redirect — instead of a broken shell.
    await expect(fetchAuthorization()).rejects.toSatisfy(isApiError);
  });

  it.each([
    ['null body', null],
    ['an array', []],
    ['a number', 42],
    ['missing userId', { ...VALID, userId: undefined }],
    ['a non-string userId', { ...VALID, userId: 123 }],
    ['an unknown role', { ...VALID, role: 'ADMIN' }],
    ['departmentIds not an array', { ...VALID, departmentIds: 'none' }],
    ['permissions not an array', { ...VALID, permissions: null }],
    ['username undefined rather than null', { ...VALID, username: undefined }],
  ])('refuses %s', async (_label, body) => {
    get.mockResolvedValue({ data: body });
    await expect(fetchAuthorization()).rejects.toThrow();
  });
});
