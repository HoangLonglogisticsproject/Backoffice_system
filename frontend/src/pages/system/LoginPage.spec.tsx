import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './LoginPage';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { AuthorizationMe } from '@/types/auth';

const useSession = vi.fn();
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));

/**
 * ★ WHERE THIS SCREEN SENDS SOMEBODY WHO IS ALREADY SIGNED IN.
 *
 * The observation: pressing F5 on `/dispatch/trip-schedule` landed on `/`. The
 * guard was doing its part — it attached the aimed-at path to the redirect it
 * sent here — and this screen threw it away, because only the sign-in handler
 * read `from`. The already-signed-in exit went to `homeOf()` unconditionally,
 * and a session that resolved a moment after the bounce took exactly that exit.
 *
 * ⚠ NAVIGATION, NOT AUTHORIZATION. Honouring `from` cannot put anyone somewhere
 * they may not be: `SessionGuard` re-decides the shell on arrival, and the
 * server re-decides every request after that.
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

/** Shows where the router ended up, so a redirect is asserted by destination. */
const Landed = () => <p>landed @ {useLocation().pathname}</p>;

const renderSignedIn = (from?: string) =>
  render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: from ? { from } : null }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );

beforeEach(() => {
  useSession.mockReset();
});

describe('a signed-in session that lands on the login screen', () => {
  it('★ returns to the page the guard bounced it from, not to the home screen', () => {
    useSession.mockReturnValue({ state: { status: 'ready', authorization: me() }, signIn: vi.fn() });
    renderSignedIn('/dispatch/trip-schedule');

    expect(screen.getByText('landed @ /dispatch/trip-schedule')).toBeInTheDocument();
  });

  it('falls back to the home screen when no destination was carried', () => {
    useSession.mockReturnValue({ state: { status: 'ready', authorization: me() }, signIn: vi.fn() });
    renderSignedIn();

    expect(screen.getByText('landed @ /')).toBeInTheDocument();
  });

  it('sends a driver to their own portal when no destination was carried', () => {
    useSession.mockReturnValue({
      state: { status: 'ready', authorization: me({ accountType: 'driver' }) },
      signIn: vi.fn(),
    });
    renderSignedIn();

    expect(screen.getByText('landed @ /driver')).toBeInTheDocument();
  });

  it('refuses `/login` as a destination — returning somebody here is a loop', () => {
    useSession.mockReturnValue({ state: { status: 'ready', authorization: me() }, signIn: vi.fn() });
    renderSignedIn('/login');

    expect(screen.getByText('landed @ /')).toBeInTheDocument();
  });

  it('sends an unfinished credential to the password screen, whatever it was aiming at', () => {
    useSession.mockReturnValue({
      state: { status: 'password-change-required', identity: { id: 'u1' } },
      signIn: vi.fn(),
    });
    renderSignedIn('/dispatch/trip-schedule');

    expect(screen.getByText('landed @ /change-password')).toBeInTheDocument();
  });
});
