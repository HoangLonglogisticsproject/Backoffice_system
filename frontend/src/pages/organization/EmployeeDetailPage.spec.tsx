import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EmployeeDetailPage from './EmployeeDetailPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

const fetchEmployeeDetail = vi.fn();
const disableUser = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/membership', () => ({
  fetchEmployeeDetail: (...a: unknown[]) => fetchEmployeeDetail(...a),
}));
vi.mock('@/api/users', () => ({
  disableUser: (...a: unknown[]) => disableUser(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const USER = 'aaaa1111-0000-4000-8000-000000000000';

/** A session as `GET /authorization/me` returns it, for one role. */
const session = (role: 'SUPERADMIN' | 'DEPARTMENT_HEAD', departmentIds: string[] = []) => {
  const permissions = role === 'SUPERADMIN' ? ['user.write', 'unit.member.read'] : ['unit.read'];
  return {
    state: {
      status: 'ready' as const,
      authorization: { userId: 'me', username: 'me', role, departmentIds, permissions },
    },
    loading: false,
    can: (permission: string) => permissions.includes(permission),
  };
};

const period = (over: Record<string, unknown> = {}) => ({
  id: 'mem-1',
  user: { id: USER, displayName: 'Lê Gia Minh Phú' },
  department: { id: 'dep-sales', name: 'Sales' },
  role: 'MEMBER',
  membershipStatus: 'active',
  accountStatus: 'active',
  joinedAt: '2026-08-26T03:00:00.000Z',
  endedAt: null,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  user: { id: USER, displayName: 'Lê Gia Minh Phú' },
  accountStatus: 'active',
  memberships: [period()],
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/organization/employee/${USER}`]}>
      <LanguageProvider>
        <Routes>
          <Route path="/organization/employee/:userId" element={<EmployeeDetailPage />} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );

/**
 * EMPLOYEE DETAIL — one person, read only.
 *
 * ⚠ EVERY FIELD COMES FROM THE RESPONSE. Position, work status, joined date and
 * account state are read off what the server sent; nothing is inferred from a
 * department, a date, or the other status. These tests feed the response and
 * assert the rendering, so a page that invented a value would fail.
 */
describe('EmployeeDetailPage', () => {
  beforeEach(() => {
    fetchEmployeeDetail.mockReset().mockResolvedValue(detail());
    disableUser.mockReset().mockResolvedValue(undefined);
    useSession.mockReset().mockReturnValue(session('SUPERADMIN'));
  });

  it('reads the person by users.id from the route', async () => {
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    expect(fetchEmployeeDetail).toHaveBeenCalledWith(USER);
    expect(fetchEmployeeDetail).toHaveBeenCalledTimes(1);
  });

  it('shows the account status under its OWN label, not as a work status', async () => {
    fetchEmployeeDetail.mockResolvedValue(detail({ accountStatus: 'disabled' }));
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    const account = screen.getByText('Trạng thái tài khoản').closest('dl')!;
    expect(within(account).getByText('Đã vô hiệu hóa')).toBeInTheDocument();
    // ★ The account section must never borrow the membership vocabulary.
    expect(within(account).queryByText('Đang làm việc')).not.toBeInTheDocument();
    expect(within(account).queryByText('Đã nghỉ việc')).not.toBeInTheDocument();
  });

  /**
   * ★ THE TWO STATUSES ARE INDEPENDENT, and the page has to be able to show a
   * combination the schema allows: a disabled account on a still-active period.
   */
  it('renders a disabled account beside an active membership without merging them', async () => {
    fetchEmployeeDetail.mockResolvedValue(
      detail({ accountStatus: 'disabled', memberships: [period({ membershipStatus: 'active' })] }),
    );
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    expect(screen.getByText('Đã vô hiệu hóa')).toBeInTheDocument();
    const current = screen.getByText('Trạng thái làm việc').closest('dl')!;
    expect(within(current).getByText('Đang làm việc')).toBeInTheDocument();
  });

  describe('current department', () => {
    it('is the ACTIVE period, not the newest row', async () => {
      fetchEmployeeDetail.mockResolvedValue(
        detail({
          memberships: [
            // Listed first and joined LATER — a page that took "the last row"
            // or "the newest date" would pick this ended one.
            period({
              id: 'mem-old',
              membershipStatus: 'ended',
              department: { id: 'dep-ops', name: 'Operations' },
              joinedAt: '2026-09-01T00:00:00.000Z',
              endedAt: '2026-09-30T00:00:00.000Z',
            }),
            period({
              id: 'mem-now',
              membershipStatus: 'active',
              department: { id: 'dep-sales', name: 'Sales' },
              joinedAt: '2026-08-26T03:00:00.000Z',
            }),
          ],
        }),
      );
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      const current = screen.getByText('Phòng ban hiện tại').closest('section')!;
      expect(within(current).getByText('Sales')).toBeInTheDocument();
      expect(within(current).queryByText('Operations')).not.toBeInTheDocument();
      expect(within(current).getByText('26/8/2026')).toBeInTheDocument();
    });

    it('maps the position from the role the server derived', async () => {
      fetchEmployeeDetail.mockResolvedValue(
        detail({ memberships: [period({ role: 'DEPARTMENT_HEAD' })] }),
      );
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      const current = screen.getByText('Phòng ban hiện tại').closest('section')!;
      expect(within(current).getByText('Trưởng phòng')).toBeInTheDocument();
    });

    it('says so when the person currently belongs nowhere', async () => {
      fetchEmployeeDetail.mockResolvedValue(
        detail({
          memberships: [
            period({ membershipStatus: 'ended', endedAt: '2026-08-30T00:00:00.000Z' }),
          ],
        }),
      );
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      expect(screen.getByText('Nhân viên này hiện không thuộc phòng ban nào.')).toBeInTheDocument();
    });
  });

  describe('department history', () => {
    it('lists every period the server returned, ended ones included', async () => {
      fetchEmployeeDetail.mockResolvedValue(
        detail({
          memberships: [
            period({
              id: 'm1',
              department: { id: 'dep-sales', name: 'Sales' },
              membershipStatus: 'ended',
              joinedAt: '2026-08-01T00:00:00.000Z',
              endedAt: '2026-08-18T00:00:00.000Z',
            }),
            period({
              id: 'm2',
              department: { id: 'dep-ops', name: 'Operations' },
              membershipStatus: 'active',
              role: 'DEPARTMENT_HEAD',
              joinedAt: '2026-08-20T00:00:00.000Z',
            }),
          ],
        }),
      );
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      const history = screen.getByText('Lịch sử phòng ban').closest('section')!;
      const rows = within(history).getAllByRole('row');
      // header + two periods
      expect(rows).toHaveLength(3);
      expect(within(rows[1]!).getByText('Sales')).toBeInTheDocument();
      expect(within(rows[1]!).getByText('Đã nghỉ việc')).toBeInTheDocument();
      expect(within(rows[1]!).getByText('18/8/2026')).toBeInTheDocument();
      expect(within(rows[2]!).getByText('Operations')).toBeInTheDocument();
      expect(within(rows[2]!).getByText('Trưởng phòng')).toBeInTheDocument();
    });

    it('shows an open period as having no end date rather than a blank cell', async () => {
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      const history = screen.getByText('Lịch sử phòng ban').closest('section')!;
      expect(within(history).getByText('—')).toBeInTheDocument();
    });

    /**
     * ⚠ A FILTERED HISTORY MUST NOT LOOK COMPLETE. The server narrows a head's
     * periods to the units they lead; the heading has to say that, or the page
     * asserts something the response cannot back up.
     */
    it('tells a DEPARTMENT_HEAD that the history is scoped to their authority', async () => {
      useSession.mockReturnValue(session('DEPARTMENT_HEAD', ['dep-sales']));
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      expect(
        screen.getByText('Lịch sử phòng ban trong phạm vi được phân quyền'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Chỉ hiển thị các giai đoạn thuộc phòng ban bạn được phân quyền quản lý.'),
      ).toBeInTheDocument();
    });

    it('does not add that caveat for a SUPERADMIN, who sees everything', async () => {
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      expect(screen.getByText('Lịch sử phòng ban')).toBeInTheDocument();
      expect(
        screen.queryByText('Lịch sử phòng ban trong phạm vi được phân quyền'),
      ).not.toBeInTheDocument();
    });
  });

  describe('refusals are outcomes, not failures', () => {
    it('renders a 403 as "not allowed", never as an error', async () => {
      const { ApiError } = await import('@/utils/errors');
      fetchEmployeeDetail.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
      renderPage();

      expect(await screen.findByText('Bạn không có quyền xem nhân viên này.')).toBeInTheDocument();
    });

    it('renders a 404 as "not found"', async () => {
      const { ApiError } = await import('@/utils/errors');
      fetchEmployeeDetail.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'no'));
      renderPage();

      expect(await screen.findByText('Không tìm thấy nhân viên này.')).toBeInTheDocument();
    });

    it('reports a genuine failure as one', async () => {
      fetchEmployeeDetail.mockRejectedValue(new Error('offline'));
      renderPage();

      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });

  /**
   * The ONE account action this phase has. Everything else that would change an
   * employee - editing, transferring, deleting, restoring - still does not exist,
   * and a button for any of them would promise a workflow that is not built.
   */
  it('offers disabling and nothing else', async () => {
    renderPage();
    await screen.findByText('Lê Gia Minh Phú');

    expect(screen.getByRole('button', { name: /vô hiệu hóa tài khoản/i })).toBeInTheDocument();

    for (const absent of [/chỉnh sửa/i, /chuyển phòng ban/i, /^xóa/i, /khôi phục/i, /kích hoạt lại/i]) {
      expect(screen.queryByRole('button', { name: absent })).not.toBeInTheDocument();
    }
  });

  describe('disabling the account', () => {
    const openDialog = async () => {
      await screen.findByText('Lê Gia Minh Phú');
      fireEvent.click(screen.getByRole('button', { name: /vô hiệu hóa tài khoản/i }));
      return screen.findByRole('dialog');
    };

    it('offers the action only to a caller holding user.write', async () => {
      useSession.mockReturnValue(session('DEPARTMENT_HEAD', ['dep-sales']));
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      // Hiding is a courtesy, not the control - the endpoint refuses them too.
      expect(
        screen.queryByRole('button', { name: /vô hiệu hóa tài khoản/i }),
      ).not.toBeInTheDocument();
    });

    it('offers nothing once the account is already disabled', async () => {
      fetchEmployeeDetail.mockResolvedValue(detail({ accountStatus: 'disabled' }));
      renderPage();
      await screen.findByText('Lê Gia Minh Phú');

      expect(screen.getByText('Đã vô hiệu hóa')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /vô hiệu hóa tài khoản/i }),
      ).not.toBeInTheDocument();
      // ★ NO RE-ENABLE. Restoring somebody asks which department they return to,
      // which is a workflow that does not exist; a button would promise one.
      expect(screen.queryByRole('button', { name: /kích hoạt lại/i })).not.toBeInTheDocument();
    });

    it('asks for confirmation before touching anything', async () => {
      renderPage();
      const dialog = await openDialog();

      expect(within(dialog).getByText(/không thể đăng nhập/i)).toBeInTheDocument();
      expect(within(dialog).getByText(/không bị xóa/i)).toBeInTheDocument();
      expect(within(dialog).getByText(/vẫn được giữ lại/i)).toBeInTheDocument();
      expect(within(dialog).getByText(/quyền truy cập hệ thống/i)).toBeInTheDocument();
      // Opening the dialog is not the act.
      expect(disableUser).not.toHaveBeenCalled();
    });

    it('never calls it deletion', async () => {
      renderPage();
      const dialog = await openDialog();

      // ⚠ Nothing is deleted. Wording that said otherwise would describe an
      // operation this system does not have.
      expect(within(dialog).queryByText(/xóa nhân viên/i)).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/xóa tài khoản/i)).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/xóa dữ liệu/i)).not.toBeInTheDocument();
    });

    it('does nothing when the confirmation is dismissed', async () => {
      renderPage();
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: /^hủy bỏ$/i }));

      expect(disableUser).not.toHaveBeenCalled();
    });

    it('disables through the existing endpoint and RE-READS the result', async () => {
      fetchEmployeeDetail
        .mockResolvedValueOnce(detail())
        .mockResolvedValue(detail({ accountStatus: 'disabled' }));
      renderPage();
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: /xác nhận vô hiệu hóa/i }));

      await waitFor(() => expect(disableUser).toHaveBeenCalledWith(USER));
      // ★ The new state comes from the SERVER, not from a local edit: the
      // lifecycle also ended a membership and revoked roles.
      await waitFor(() => expect(fetchEmployeeDetail).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Đã vô hiệu hóa')).toBeInTheDocument();
    });

    it('drops the action and keeps the history after a successful disable', async () => {
      fetchEmployeeDetail.mockResolvedValueOnce(detail()).mockResolvedValue(
        detail({
          accountStatus: 'disabled',
          memberships: [
            period({ membershipStatus: 'ended', endedAt: '2026-08-30T00:00:00.000Z' }),
          ],
        }),
      );
      renderPage();
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: /xác nhận vô hiệu hóa/i }));

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /vô hiệu hóa tài khoản/i }),
        ).not.toBeInTheDocument(),
      );
      // Work history survives - disabling is not deletion.
      const history = screen.getByText('Lịch sử phòng ban').closest('section')!;
      expect(within(history).getByText('Sales')).toBeInTheDocument();
    });

    /**
     * ⚠ THE LAST-SUPERADMIN RULE IS THE BACKEND'S. The frontend does not know
     * how many SuperAdmins exist and must not guess - it shows what the server
     * said and leaves the account alone.
     */
    it('shows the server refusal rather than deciding the rule itself', async () => {
      const { ApiError } = await import('@/utils/errors');
      disableUser.mockRejectedValue(
        new ApiError(409, 'CONFLICT', 'Refusing to leave the deployment with no SuperAdmin.'),
      );
      renderPage();
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: /xác nhận vô hiệu hóa/i }));

      expect(
        await screen.findByText(/Refusing to leave the deployment with no SuperAdmin/i),
      ).toBeInTheDocument();
      // Nothing was re-read, because nothing changed.
      expect(fetchEmployeeDetail).toHaveBeenCalledTimes(1);
    });

    it('reports an authorization refusal from the server', async () => {
      const { ApiError } = await import('@/utils/errors');
      disableUser.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.'));
      renderPage();
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: /xác nhận vô hiệu hóa/i }));

      expect(await screen.findByText(/not allowed to do that/i)).toBeInTheDocument();
    });

    it('reports a network failure in its own words', async () => {
      disableUser.mockRejectedValue(new Error('offline'));
      renderPage();
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: /xác nhận vô hiệu hóa/i }));

      expect(await screen.findByText('Không vô hiệu hóa được tài khoản.')).toBeInTheDocument();
    });

    it('cannot be submitted twice while it is in flight', async () => {
      let release: (() => void) | undefined;
      disableUser.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      renderPage();
      const dialog = await openDialog();

      const confirm = within(dialog).getByRole('button', { name: /xác nhận vô hiệu hóa/i });
      fireEvent.click(confirm);

      await waitFor(() => expect(screen.getByRole('button', { name: /đang vô hiệu hóa/i })).toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: /đang vô hiệu hóa/i }));

      expect(disableUser).toHaveBeenCalledTimes(1);
      release?.();
    });
  });
});
