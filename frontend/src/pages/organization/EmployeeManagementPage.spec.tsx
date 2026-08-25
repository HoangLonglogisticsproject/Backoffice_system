import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EmployeeManagementPage from './EmployeeManagementPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

const fetchDepartmentMembers = vi.fn();
const createUser = vi.fn();
const requestAccountInvitation = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/membership', () => ({
  fetchDepartmentMembers: (...a: unknown[]) => fetchDepartmentMembers(...a),
}));
vi.mock('@/api/users', () => ({
  createUser: (...a: unknown[]) => createUser(...a),
}));
vi.mock('@/api/account-invitation', () => ({
  requestAccountInvitation: (...a: unknown[]) => requestAccountInvitation(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const DEPARTMENT = '7ce2630e-0000-4000-8000-000000000000';
const OTHER = '11111111-0000-4000-8000-000000000000';

/** A session shaped like `GET /authorization/me` returns it. */
const session = (
  role: 'SUPERADMIN' | 'DEPARTMENT_HEAD' | 'MEMBER',
  permissions: string[],
  departmentIds: string[] = [DEPARTMENT],
) => ({
  state: {
    status: 'ready',
    authorization: { userId: 'u1', username: 'someone', role, departmentIds, permissions },
  },
  can: (p: string) => permissions.includes(p),
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/organization/department/${DEPARTMENT}/members`]}>
      <LanguageProvider>
        <Routes>
          <Route
            path="/organization/department/:departmentId/members"
            element={<EmployeeManagementPage />}
          />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );

/**
 * Who may add somebody to a department — and by which of the two workflows.
 *
 * ★ ONLY ONE OF THE TWO IS A PERMISSION. `user.write` is global-only and gates
 * direct creation. Raising an invitation is gated by no permission at all: the
 * server asks a relational question through `HeadOfRouteDepartmentGuard` — are
 * you the head of the department on this route? Gating the button on
 * `user.write` alone hid the head's workflow completely, which is the defect
 * these tests pin.
 *
 * ⚠ NONE OF THIS IS AUTHORIZATION. The server re-decides every request. These
 * assertions are about what the UI OFFERS, never about what it permits.
 */
describe('EmployeeManagementPage — who can add somebody', () => {
  beforeEach(() => {
    fetchDepartmentMembers.mockReset().mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    createUser.mockReset().mockResolvedValue({});
    requestAccountInvitation.mockReset().mockResolvedValue({});
    useSession.mockReset();
  });

  it('1. a caller with user.write sees the direct-create action', async () => {
    useSession.mockReturnValue(session('SUPERADMIN', ['user.write'], []));
    renderPage();

    expect(await screen.findByRole('button', { name: /thêm nhân viên|add employee/i })).toBeInTheDocument();
  });

  it('2. a department head sees the INVITATION action', async () => {
    useSession.mockReturnValue(session('DEPARTMENT_HEAD', ['unit.member.read']));
    renderPage();

    // Present at all — this is the regression. It used to be absent entirely.
    expect(
      await screen.findByRole('button', { name: /đề nghị mở tài khoản|request an account/i }),
    ).toBeInTheDocument();
  });

  it('3. the head’s action opens the same modal, on the invitation workflow', async () => {
    useSession.mockReturnValue(session('DEPARTMENT_HEAD', ['unit.member.read']));
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: /đề nghị mở tài khoản|request an account/i }),
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Email only: the head names nobody and issues no credential.
    expect(screen.getByLabelText('Email *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gửi đề nghị|submit request/i })).toBeInTheDocument();
  });

  it('4. a department head gains NO direct user-creation UI', async () => {
    useSession.mockReturnValue(session('DEPARTMENT_HEAD', ['unit.member.read']));
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: /đề nghị mở tài khoản|request an account/i }),
    );
    await screen.findByRole('dialog');

    // No name, no password, no department — those belong to `POST /users`,
    // which a head is refused.
    expect(screen.queryByLabelText('Họ và tên *')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mật khẩu tạm *')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lưu nhân viên|save employee/i })).not.toBeInTheDocument();
  });

  it('5. the SUPERADMIN flow is unchanged — same label, same direct-create form', async () => {
    useSession.mockReturnValue(session('SUPERADMIN', ['user.write'], []));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /thêm nhân viên|add employee/i }));
    await screen.findByRole('dialog');

    expect(screen.getByLabelText('Họ và tên *')).toBeInTheDocument();
    expect(screen.getByLabelText('Email *')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu tạm *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lưu nhân viên|save employee/i })).toBeInTheDocument();
  });

  it('offers nothing to an ordinary member', async () => {
    useSession.mockReturnValue(session('MEMBER', ['unit.member.read']));
    renderPage();

    await screen.findByText(/chưa có nhân viên|no members yet/i);
    expect(screen.queryByRole('button', { name: /thêm nhân viên|add employee/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /đề nghị mở tài khoản|request an account/i }),
    ).not.toBeInTheDocument();
  });

  it('offers nothing to a head looking at a department they do not lead', async () => {
    // Their headship is elsewhere, so this route is not theirs to act on — and
    // the server would answer 403 if they tried.
    useSession.mockReturnValue(session('DEPARTMENT_HEAD', ['unit.member.read'], [OTHER]));
    renderPage();

    await screen.findByText(/chưa có nhân viên|no members yet/i);
    expect(
      screen.queryByRole('button', { name: /đề nghị mở tài khoản|request an account/i }),
    ).not.toBeInTheDocument();
  });
});
