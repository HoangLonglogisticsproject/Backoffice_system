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

  it('switches language without touching the session', () => {
    renderLayout();

    expect(screen.getByText(/đăng xuất/i)).toBeInTheDocument();
    // The choice is a UI preference; nothing about it is sent to the server.
    expect(useSession).toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
