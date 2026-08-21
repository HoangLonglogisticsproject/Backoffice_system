import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MainLayout from './MainLayout';
import { LanguageProvider } from '@/contexts/LanguageContext';

const signOut = vi.fn();
const useSession = vi.fn();
const useMyDepartments = vi.fn();
const navigate = vi.fn();

vi.mock('@/lib/session/SessionProvider', () => ({
  useSession: () => useSession(),
}));
vi.mock('@/lib/api/useMyDepartments', () => ({
  useMyDepartments: () => useMyDepartments(),
}));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const ready = (username: string) => ({
  state: { status: 'ready', authorization: { username, departmentIds: [] } },
  signOut,
});

const renderLayout = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <MainLayout />
      </LanguageProvider>
    </MemoryRouter>,
  );

/**
 * The shell says who you are and where you may go.
 *
 * ⚠ NAVIGATION IS NOT AUTHORIZATION. These tests check that the menu reflects
 * the session — they must never be read as proof that hiding a link protects
 * anything. The server re-decides every request regardless of what was drawn.
 */
describe('MainLayout', () => {
  beforeEach(() => {
    signOut.mockReset().mockResolvedValue(undefined);
    navigate.mockReset();
    useSession.mockReset().mockReturnValue(ready('boss'));
    useMyDepartments.mockReset().mockReturnValue({ departments: [], loading: false });
  });

  it('shows the real signed-in user, not a placeholder', () => {
    useSession.mockReturnValue(ready('head.person'));
    renderLayout();

    expect(screen.getByText('head.person')).toBeInTheDocument();
    // Phú's mock shipped a hardcoded "Admin User" / "AD" avatar.
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
  });

  it('derives initials from the actual username', () => {
    useSession.mockReturnValue(ready('head.person'));
    renderLayout();

    expect(screen.getByText('HP')).toBeInTheDocument();
  });

  it('ends the real session and leaves for login', async () => {
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: /đăng xuất|logout/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  describe('★ REGRESSION: the header must not crash on a session without a name', () => {
    // `username` is the local part of a login email. An account with no local
    // subject has none, and the server sends `null` — which the frontend type
    // used to deny, so nothing forced anyone to handle it. The first component
    // to read it crashed:
    //
    //   TypeError: Cannot read properties of undefined (reading 'split')
    //     at initialsOf (MainLayout.tsx:136)
    it('renders with username = null instead of throwing', () => {
      useSession.mockReturnValue({
        state: {
          status: 'ready',
          authorization: { userId: 'u1', username: null, role: 'MEMBER', departmentIds: [] },
        },
        signOut,
      });

      expect(() => renderLayout()).not.toThrow();
      // The absence is shown as an absence: a neutral marker, and no name.
      expect(screen.getByText('?')).toBeInTheDocument();
    });

    it('invents no identity when there is no name', () => {
      useSession.mockReturnValue({
        state: {
          status: 'ready',
          authorization: { userId: 'u1', username: null, role: 'MEMBER', departmentIds: [] },
        },
        signOut,
      });
      renderLayout();

      // No stand-in, no placeholder person, no echo of the raw user id.
      expect(screen.queryByText(/admin user/i)).not.toBeInTheDocument();
      expect(screen.queryByText('u1')).not.toBeInTheDocument();
      // The rest of the shell still works — sign-out is still reachable.
      expect(screen.getByRole('button', { name: /đăng xuất|logout/i })).toBeInTheDocument();
    });

    it('still renders while the session is not ready', () => {
      // `RequireSession` routes this case, but the shell must not be the thing
      // that explodes on the way there.
      useSession.mockReturnValue({ state: null, signOut });

      expect(() => renderLayout()).not.toThrow();
      expect(screen.getByText('?')).toBeInTheDocument();
    });
  });

  describe('department navigation comes from the session', () => {
    it('lists only the departments this account may reach', () => {
      useMyDepartments.mockReturnValue({
        departments: [
          { id: 'd1', slug: 'ops', name: 'Phòng Vận hành', status: 'active' },
          { id: 'd2', slug: 'it', name: 'Phòng IT', status: 'active' },
        ],
        loading: false,
      });
      renderLayout();

      expect(screen.getByText('Phòng Vận hành')).toBeInTheDocument();
      expect(screen.getByText('Phòng IT')).toBeInTheDocument();
    });

    it('offers no department section at all when the account belongs to none', () => {
      renderLayout();

      // Better than offering a destination the server would refuse. The six
      // hardcoded departments in the mock (Sales, Marketing, Legal…) are gone.
      for (const fake of ['Marketing', 'Legal', 'Finance']) {
        expect(screen.queryByText(fake)).not.toBeInTheDocument();
      }
    });

    it('links a department at its own id, never a guessed slug', () => {
      useMyDepartments.mockReturnValue({
        departments: [{ id: 'd1', slug: 'ops', name: 'Phòng Vận hành', status: 'active' }],
        loading: false,
      });
      renderLayout();

      expect(screen.getByText('Phòng Vận hành').closest('a')).toHaveAttribute(
        'href',
        '/organization/department/d1/members',
      );
    });
  });

  it('marks unbuilt modules as coming soon rather than pretending', () => {
    renderLayout();

    // Approvals is real; the rest of the system section is not yet.
    expect(screen.getAllByText(/sắp có|coming soon/i).length).toBeGreaterThanOrEqual(4);
  });

  describe('language', () => {
    beforeEach(() => localStorage.clear());

    it('starts in Vietnamese', () => {
      renderLayout();
      expect(screen.getByText('Đăng xuất')).toBeInTheDocument();
    });

    it('renders English once English is chosen, and signs nobody out', async () => {
      // Driven through the provider's own persistence rather than by fighting
      // the Select's pointer behaviour in jsdom — the assertion that matters is
      // that the whole shell re-renders translated.
      localStorage.setItem('language', 'en');
      renderLayout();

      expect(await screen.findByText('Logout')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Toggle navigation' })).toBeInTheDocument();
      expect(screen.queryByText('Đăng xuất')).not.toBeInTheDocument();

      // A language change is a UI preference. It must never end the session.
      expect(signOut).not.toHaveBeenCalled();
    });

    it('labels the language control for a screen reader', () => {
      renderLayout();
      expect(screen.getByRole('combobox', { name: 'Ngôn ngữ' })).toBeInTheDocument();
    });
  });
});
