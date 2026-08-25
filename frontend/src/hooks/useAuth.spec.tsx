import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from './useAuth';
import { SessionGuard } from '@/components/common/SessionGuard';
import { ApiError } from '@/utils/errors';

const fetchAuthorization = vi.fn();
const fetchIdentity = vi.fn();
const sessionContext = vi.fn();

vi.mock('@/api/auth', () => ({
  fetchAuthorization: (...a: unknown[]) => fetchAuthorization(...a),
  fetchIdentity: (...a: unknown[]) => fetchIdentity(...a),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => sessionContext(),
}));

/**
 * THE FIRST-LOGIN STATE MACHINE, and every transition in it is the SERVER's
 * answer rather than a flag this app sets.
 *
 *   200                          → ready
 *   401 UNAUTHORIZED             → anonymous
 *   403 PASSWORD_CHANGE_REQUIRED → password-change-required
 *
 * ⚠ THE 403 IS NOT A LOGOUT. The cookie is alive and the session is real; what
 * is unfinished is provisioning. Collapsing it into `anonymous` would bounce
 * somebody to the login screen where the only credential they hold is the one
 * that put them in this state — a loop with no exit.
 *
 * ⚠ AND `mustChangePassword` FROM `POST /auth/login` IS NOT THE AUTHORITY.
 * It is true on exactly one response; this 403 stays true on every request
 * afterwards, including a page refresh, which is the property a guard needs.
 */
const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const READY = {
  userId: 'u1',
  username: 'newcomer',
  role: 'MEMBER',
  departmentIds: ['d1'],
  permissions: ['unit.read'],
};

describe('session state resolution', () => {
  beforeEach(() => {
    fetchAuthorization.mockReset();
    fetchIdentity.mockReset();
  });

  it('is `ready` when authorization answers 200', async () => {
    fetchAuthorization.mockResolvedValue(READY);

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ status: 'ready', authorization: READY }));
    expect(fetchIdentity).not.toHaveBeenCalled();
  });

  it('is `anonymous` on a 401', async () => {
    fetchAuthorization.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'no session'));

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ status: 'anonymous' }));
  });

  it('is `password-change-required` on the 403 that names it, and keeps the identity', async () => {
    const identity = { id: 'u1', displayName: 'New Comer', status: 'active' };
    fetchAuthorization.mockRejectedValue(
      new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change required.'),
    );
    fetchIdentity.mockResolvedValue(identity);

    const { result } = renderHook(() => useSession(), { wrapper });

    // `GET /auth/me` is one of the four endpoints a temporary credential may
    // still use — which is what makes the change-password screen able to greet
    // somebody by name.
    await waitFor(() =>
      expect(result.current.data).toEqual({ status: 'password-change-required', identity }),
    );
  });

  it('does NOT swallow a plain 403 — that is an error, not a session state', async () => {
    fetchAuthorization.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'nope'));

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

/** The same three states, routed to the three screens they belong to (§3b). */
describe('SessionGuard', () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route path="/change-password" element={<p>change password screen</p>} />
          <Route
            path={path}
            element={
              <SessionGuard>
                <p>the app</p>
              </SessionGuard>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

  beforeEach(() => sessionContext.mockReset());

  it('sends a temporary credential to change-password and nowhere else', () => {
    sessionContext.mockReturnValue({
      state: {
        status: 'password-change-required',
        identity: { id: 'u1', displayName: 'New Comer', status: 'active' },
      },
      loading: false,
    });

    renderAt('/system/approvals');

    expect(screen.getByText('change password screen')).toBeInTheDocument();
    // ⚠ NOT the login screen: the session is real and the cookie works. Sending
    // them there would offer the only credential they hold — the one that put
    // them in this state — as the way out of it.
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
  });

  it('lets a ready session through', () => {
    sessionContext.mockReturnValue({
      state: { status: 'ready', authorization: READY },
      loading: false,
    });

    renderAt('/');

    expect(screen.getByText('the app')).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login', () => {
    sessionContext.mockReturnValue({ state: { status: 'anonymous' }, loading: false });

    renderAt('/system/approvals');

    expect(screen.getByText('login screen')).toBeInTheDocument();
  });

  it('renders nothing while the session is still resolving', () => {
    sessionContext.mockReturnValue({ state: null, loading: true });

    // "Not asked yet" is not "not signed in" — redirecting here would bounce a
    // signed-in user out of the app on every cold load.
    renderAt('/');

    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });
});
