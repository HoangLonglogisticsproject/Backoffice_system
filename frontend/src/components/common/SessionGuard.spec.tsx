import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequireSession } from './SessionGuard';
import { homeOf, portalOf } from '@/utils/portal';
import type { AuthorizationMe } from '@/types/auth';

const useSession = vi.fn();
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));

/**
 * The guard sends each session to the ONE shell that is its own.
 *
 * ⚠ NAVIGATION, NOT AUTHORIZATION. A driver sent away from `/dispatch/...`
 * was going to be refused there by the server anyway; the redirect spares them
 * a shell of links that all 403. Nothing here proves a route is protected —
 * the backend security specs do that.
 */
const me = (over: Partial<AuthorizationMe> = {}): AuthorizationMe => ({
  userId: 'u1',
  username: 'someone',
  accountType: 'employee',
  role: 'MEMBER',
  departmentIds: [],
  permissions: ['trip.read'],
  ...over,
});

const ready = (over: Partial<AuthorizationMe> = {}) => ({
  state: { status: 'ready', authorization: me(over) },
  loading: false,
});

/** Shows where the router ended up, so a redirect is asserted by destination. */
function Here({ shell }: Readonly<{ shell: string }>) {
  const location = useLocation();
  return (
    <p>
      {shell} @ {location.pathname}
      {location.state?.from ? ` (from ${location.state.from})` : ''}
    </p>
  );
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Here shell="login" />} />
        <Route path="/change-password" element={<Here shell="change-password" />} />
        <Route
          element={
            <RequireSession portal="driver">
              <Here shell="driver" />
            </RequireSession>
          }
        >
          <Route path="/driver" element={null} />
          <Route path="/driver/*" element={null} />
        </Route>
        <Route
          element={
            <RequireSession portal="backoffice">
              <Here shell="backoffice" />
            </RequireSession>
          }
        >
          <Route path="/" element={null} />
          <Route path="/dispatch/*" element={null} />
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useSession.mockReset();
});

describe('portalOf / homeOf', () => {
  it('sends a driver to the portal and everybody else to the Backoffice', () => {
    expect(portalOf(me({ accountType: 'driver' }))).toBe('driver');
    expect(homeOf(me({ accountType: 'driver' }))).toBe('/driver');
    expect(portalOf(me())).toBe('backoffice');
    expect(homeOf(me({ role: 'SUPERADMIN' }))).toBe('/');
  });

  it('★ decides on the account type, never on the permission list', () => {
    // A driver's permissions include `trip.read` — it is `'any'` — and the
    // server still refuses them every Backoffice route. The list is not what
    // picks the shell.
    expect(portalOf(me({ accountType: 'driver', permissions: ['trip.read', 'trip.create'] }))).toBe(
      'driver',
    );
    expect(portalOf(me({ accountType: 'employee', permissions: [] }))).toBe('backoffice');
  });
});

describe('RequireSession', () => {
  it('★ sends a driver holding a Backoffice URL to their own home', () => {
    useSession.mockReturnValue(ready({ accountType: 'driver' }));
    renderAt('/dispatch/master-data');

    expect(screen.getByText('driver @ /driver')).toBeInTheDocument();
  });

  it('★ sends a driver holding an old bookmark anywhere in the Backoffice home too', () => {
    useSession.mockReturnValue(ready({ accountType: 'driver' }));
    renderAt('/organization/departments');

    expect(screen.getByText('driver @ /driver')).toBeInTheDocument();
  });

  it('keeps a driver inside the portal', () => {
    useSession.mockReturnValue(ready({ accountType: 'driver' }));
    renderAt('/driver/trips/t1');

    expect(screen.getByText('driver @ /driver/trips/t1')).toBeInTheDocument();
  });

  it('★ sends an employee who lands on /driver back to the Backoffice', () => {
    useSession.mockReturnValue(ready());
    renderAt('/driver');

    expect(screen.getByText('backoffice @ /')).toBeInTheDocument();
  });

  it('keeps an employee where they were going', () => {
    useSession.mockReturnValue(ready({ role: 'SUPERADMIN' }));
    renderAt('/dispatch/master-data');

    expect(screen.getByText('backoffice @ /dispatch/master-data')).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login, remembering where they aimed', () => {
    useSession.mockReturnValue({ state: { status: 'anonymous' }, loading: false });
    renderAt('/driver/trips/t1');

    expect(screen.getByText('login @ /login (from /driver/trips/t1)')).toBeInTheDocument();
  });

  it('sends an unfinished credential to the password screen, whichever shell it aimed at', () => {
    useSession.mockReturnValue({
      state: { status: 'password-change-required', identity: { id: 'u1' } },
      loading: false,
    });
    renderAt('/driver');

    expect(screen.getByText('change-password @ /change-password')).toBeInTheDocument();
  });

  it('renders nothing while the session is still being asked', () => {
    // Redirecting here would bounce a signed-in user out on every cold load.
    useSession.mockReturnValue({ state: null, loading: true });
    const { container } = renderAt('/driver');

    expect(container).toBeEmptyDOMElement();
  });
});
