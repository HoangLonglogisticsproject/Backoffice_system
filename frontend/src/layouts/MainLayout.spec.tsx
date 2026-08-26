import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MainLayout from './MainLayout';
import { LanguageProvider } from '@/contexts/LanguageContext';

const signOut = vi.fn();
const useSession = vi.fn();
const useMyDepartments = vi.fn();
const navigate = vi.fn();

vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));
vi.mock('@/hooks/useMyDepartments', () => ({
  useMyDepartments: () => useMyDepartments(),
}));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

/**
 * A session as `GET /authorization/me` returns it, for one role.
 *
 * `can` is a membership test over `permissions`, exactly as `SessionProvider`
 * implements it — faking the two independently would let a test assert a
 * combination the server cannot produce.
 */
const ready = (
  username: string,
  role: 'SUPERADMIN' | 'DEPARTMENT_HEAD' | 'MEMBER' = 'SUPERADMIN',
  departmentIds: string[] = [],
) => {
  // A global caller holds every permission; the others hold no global one.
  const permissions = role === 'SUPERADMIN' ? ['user.write', 'unit.read'] : ['unit.read'];
  return {
    state: { status: 'ready', authorization: { username, role, departmentIds, permissions } },
    signOut,
    can: (permission: string) => permissions.includes(permission),
  };
};

const HEAD_DEPARTMENT = 'd1';
const headSession = (username = 'head') =>
  ready(username, 'DEPARTMENT_HEAD', [HEAD_DEPARTMENT]);
const memberSession = (username = 'member') =>
  ready(username, 'MEMBER', [HEAD_DEPARTMENT]);

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
          authorization: {
            userId: 'u1',
            username: null,
            role: 'MEMBER',
            departmentIds: [],
            permissions: [],
          },
        },
        signOut,
        can: () => false,
      });

      expect(() => renderLayout()).not.toThrow();
      // The absence is shown as an absence: a neutral marker, and no name.
      expect(screen.getByText('?')).toBeInTheDocument();
    });

    it('invents no identity when there is no name', () => {
      useSession.mockReturnValue({
        state: {
          status: 'ready',
          authorization: {
            userId: 'u1',
            username: null,
            role: 'MEMBER',
            departmentIds: [],
            permissions: [],
          },
        },
        signOut,
        can: () => false,
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
      useSession.mockReturnValue({ state: null, signOut, can: () => false });

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

  /**
   * ★ THE TWO ROLES DO NOT SHARE AN INFORMATION ARCHITECTURE.
   *
   * "Phê duyệt" is the deployment-wide decision queue — it approves and rejects
   * across every unit. A head decides nothing: they propose, and a SUPERADMIN
   * decides. Showing them that row offered a screen whose whole purpose is an
   * action they do not have, and made their job look like a smaller copy of the
   * administrator's instead of a different one.
   *
   * ⚠ These assert the MENU, never authorization. Every endpoint behind these
   * links re-decides on its own.
   */
  describe('the menu is split by role, not shared', () => {
    /** The row's DESTINATION, not just its label — a link that reads right and
     *  points nowhere is the failure this is here to catch. */
    const hrefOf = (label: string) => screen.getByText(label).closest('a')?.getAttribute('href');

    it('leaves a SUPERADMIN every global destination they already had', () => {
      useSession.mockReturnValue(ready('boss', 'SUPERADMIN'));
      renderLayout();

      expect(hrefOf('Phê duyệt')).toBe('/system/approvals');
      // ★ THE REGRESSION GUARD. "Phòng ban" is a fixed global row, NOT the
      // session-derived section that was retitled for a head — so retitling
      // that section must never cost an administrator this destination.
      expect(hrefOf('Phòng ban')).toBe('/organization/departments');
      expect(hrefOf('Tổng quan')).toBe('/organization/dashboard');
    });

    it('gives a DEPARTMENT_HEAD a personnel area instead of the approvals queue', () => {
      useSession.mockReturnValue(headSession());
      useMyDepartments.mockReturnValue({
        departments: [
          { id: HEAD_DEPARTMENT, slug: 'ops', name: 'Phòng Vận hành', status: 'active' },
        ],
        loading: false,
      });
      renderLayout();

      // ★ NOT the administrator's queue — no row, and so no destination.
      expect(screen.queryByText('Phê duyệt')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /phê duyệt/i }),
      ).not.toBeInTheDocument();
      // Their own area, named for the work rather than for the unit.
      expect(screen.getByText('NHÂN SỰ')).toBeInTheDocument();
      expect(screen.queryByText('PHÒNG BAN')).not.toBeInTheDocument();
      // And it lands on the roster of the unit they actually lead.
      expect(screen.getByText('Phòng Vận hành').closest('a')).toHaveAttribute(
        'href',
        `/organization/department/${HEAD_DEPARTMENT}/members`,
      );
    });

    /**
     * ⚠ `GET /departments/:id/members` answers 403 to an ordinary member of
     * that very department — the decided default. The menu used to send them
     * there anyway, so the one HR screen a member could reach was a refusal.
     */
    it('offers a MEMBER no approvals queue and no roster to be refused at', () => {
      useSession.mockReturnValue(memberSession());
      useMyDepartments.mockReturnValue({
        departments: [
          { id: HEAD_DEPARTMENT, slug: 'ops', name: 'Phòng Vận hành', status: 'active' },
        ],
        loading: false,
      });
      renderLayout();

      expect(screen.queryByText('Phê duyệt')).not.toBeInTheDocument();
      expect(screen.queryByText('NHÂN SỰ')).not.toBeInTheDocument();
      expect(screen.queryByText('PHÒNG BAN')).not.toBeInTheDocument();
      expect(screen.queryByText('Phòng Vận hành')).not.toBeInTheDocument();
      // No link anywhere points at a roster this account would be refused at.
      const rosterLinks = screen
        .getAllByRole('link')
        .map((link) => link.getAttribute('href') ?? '')
        .filter((href) => href.includes('/members'));
      expect(rosterLinks).toEqual([]);
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
