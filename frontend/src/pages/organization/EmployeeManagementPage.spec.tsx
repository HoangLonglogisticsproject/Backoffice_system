import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
/**
 * THE HEAD'S ROSTER — four columns, every one of them read off the API.
 *
 * ⚠ NOTHING HERE IS HARDCODED OR DERIVED IN THE BROWSER. `role`,
 * `membershipStatus` and `joinedAt` arrive from `GET /departments/:id/members`;
 * the screen translates the contract's enums into the words the business uses
 * and does nothing else. These tests feed the response and assert the cells, so
 * a screen that invented a position or defaulted a status would fail.
 */
describe('EmployeeManagementPage — the roster the head reads', () => {
  const rosterRow = (over: Record<string, unknown> = {}) => ({
    id: 'mem-1',
    user: { id: 'user-1', displayName: 'Lê Gia Minh Phú' },
    department: { id: DEPARTMENT, name: 'Sales' },
    role: 'MEMBER',
    membershipStatus: 'active',
    accountStatus: 'active',
    joinedAt: '2026-08-26T03:00:00.000Z',
    endedAt: null,
    ...over,
  });

  beforeEach(() => {
    createUser.mockReset().mockResolvedValue({});
    requestAccountInvitation.mockReset().mockResolvedValue({});
    useSession.mockReset().mockReturnValue(session('DEPARTMENT_HEAD', ['unit.member.read']));
    fetchDepartmentMembers.mockReset().mockResolvedValue({
      items: [rosterRow(), rosterRow({ id: 'mem-2', user: { id: 'u2', displayName: 'Nguyễn Văn A' }, role: 'DEPARTMENT_HEAD', joinedAt: '2026-08-20T03:00:00.000Z' })],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('asks the DEPARTMENT-scoped endpoint for active memberships only', async () => {
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    // ★ The scope is the route's department, and the default filter is stated
    // rather than assumed from whatever the endpoint happens to return.
    expect(fetchDepartmentMembers).toHaveBeenCalledWith(
      DEPARTMENT,
      expect.anything(),
      'active',
    );
  });

  it('draws the four columns the head needs, and no department column', async () => {
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['#', 'Nhân viên', 'Vị trí', 'Trạng thái', 'Ngày vào phòng']);
    // ★ NO "Phòng ban": the head is already inside their own unit, so the
    // column would be the same word repeated down the page.
    expect(headers).not.toContain('Phòng ban');
  });

  it('names the position from the role the server derived', async () => {
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    const rows = screen.getAllByRole('row');
    // MEMBER — the absence of an active head assignment, not a stored value.
    expect(within(rows[1]!).getByText('Nhân viên')).toBeInTheDocument();
    // DEPARTMENT_HEAD — an active assignment on that membership.
    expect(within(rows[2]!).getByText('Trưởng phòng')).toBeInTheDocument();
  });

  /**
   * ★ THE LINK IS KEYED BY THE PERSON. A membership id would open one employment
   * period and hide the rest, which is the opposite of what detail is for.
   */
  it('links each row to the employee detail page by users.id', async () => {
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    expect(screen.getByText('Lê Gia Minh Phú').closest('a')).toHaveAttribute(
      'href',
      '/organization/employee/user-1',
    );
    // ★ NOT the membership id, which is what the row is keyed by in the table.
    expect(screen.getByText('Lê Gia Minh Phú').closest('a')).not.toHaveAttribute(
      'href',
      '/organization/employee/mem-1',
    );
  });

  it('shows the MEMBERSHIP status and the date the membership began', async () => {
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).getByText('Đang làm việc')).toBeInTheDocument();
    expect(within(row).getByText('26/8/2026')).toBeInTheDocument();
  });

  /**
   * ⚠ `accountStatus` IS IN THE RESPONSE AND MUST NOT REACH THIS SCREEN. The
   * head's "Trạng thái" column is the membership's. A row whose account is
   * disabled while the membership is still active must still read
   * "Đang làm việc" — anything else would be the two statuses merged.
   */
  it('never shows the account status in place of the membership status', async () => {
    fetchDepartmentMembers.mockResolvedValue({
      items: [rosterRow({ accountStatus: 'disabled', membershipStatus: 'active' })],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    expect(screen.getByText('Đang làm việc')).toBeInTheDocument();
    expect(screen.queryByText('Đã kết thúc')).not.toBeInTheDocument();
  });

  it('renders an ended membership as resigned when the server sends one', async () => {
    fetchDepartmentMembers.mockResolvedValue({
      items: [rosterRow({ membershipStatus: 'ended', endedAt: '2026-08-27T00:00:00.000Z' })],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    expect(screen.getByText('Đã kết thúc')).toBeInTheDocument();
  });
});

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
