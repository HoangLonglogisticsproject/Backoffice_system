import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DriverManagementPage from './DriverManagementPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * Driver Management: accounts on, accounts off, and nothing about trips.
 *
 * ★ THE ASSERTIONS THAT MATTER ARE THE NEGATIVE ONES. No password or hash is
 * ever on screen after creation; disabling sends ONE status change and the
 * dialog says the assignments stay; a caller without `user.write` never sees
 * the page at all. The rest is a list with three buttons.
 */
const fetchDrivers = vi.fn();
const fetchDriver = vi.fn();
const createDriver = vi.fn();
const setDriverStatus = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/driverAccounts', () => ({
  fetchDrivers: (...a: unknown[]) => fetchDrivers(...a),
  fetchDriver: (...a: unknown[]) => fetchDriver(...a),
  createDriver: (...a: unknown[]) => createDriver(...a),
  setDriverStatus: (...a: unknown[]) => setDriverStatus(...a),
  requestDriver: vi.fn(),
}));

// ★ THE CREATE DIALOG IS THE APPROVALS SCREEN'S. It reaches for the employee
// endpoints too; they are mocked so the dialog can mount, and none is called.
vi.mock('@/api/users', () => ({ createUser: vi.fn() }));
vi.mock('@/api/department', () => ({ fetchDepartments: vi.fn().mockResolvedValue([]) }));
vi.mock('@/api/department-head', () => ({ assignDepartmentHead: vi.fn() }));
vi.mock('@/api/account-invitation', () => ({ requestAccountInvitation: vi.fn() }));
vi.mock('@/hooks/useMyDepartments', () => ({
  useMyDepartments: () => ({ departments: [], loading: false }),
}));

vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const session = (permissions: string[]) => ({
  state: {
    status: 'ready',
    authorization: { userId: 'u1', username: 'boss', role: 'SUPERADMIN', departmentIds: [], permissions },
  },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

const driver = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  displayName: 'Nguyễn Văn Tài',
  username: 'taixea',
  accountType: 'driver',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/system/drivers']}>
          <Routes>
            <Route path="/system/drivers" element={<DriverManagementPage />} />
            <Route path="/403" element={<p>no-access-page</p>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

const dialog = () => within(screen.getByRole('dialog'));

beforeEach(() => {
  vi.clearAllMocks();
  useSession.mockReturnValue(session(['user.write', 'unit.read']));
  fetchDrivers.mockResolvedValue([driver()]);
  fetchDriver.mockImplementation(async (id: string) => driver({ id }));
});

describe('DriverManagementPage', () => {
  describe('who sees it', () => {
    it('★ sends a caller without user.write away without asking the server', () => {
      useSession.mockReturnValue(session(['unit.read', 'trip.read']));
      renderPage();

      expect(screen.getByText('no-access-page')).toBeInTheDocument();
      expect(fetchDrivers).not.toHaveBeenCalled();
    });

    it('renders for a global administrator, with the title and the request-queue link', async () => {
      renderPage();

      expect(await screen.findByRole('heading', { name: 'Quản lý tài xế' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /đề xuất tài khoản tài xế/i })).toHaveAttribute(
        'href',
        '/organization/driver-requests',
      );
    });
  });

  describe('the list', () => {
    it('shows the loading state, then the drivers', async () => {
      let release: (value: unknown[]) => void = () => {};
      fetchDrivers.mockReturnValue(new Promise((resolve) => (release = resolve)));
      renderPage();

      expect(screen.getByText('Đang tải…')).toBeInTheDocument();
      release([driver()]);

      expect(await screen.findByText('Nguyễn Văn Tài')).toBeInTheDocument();
      expect(screen.getByText('taixea')).toBeInTheDocument();
      expect(screen.getByText('Đang hoạt động')).toBeInTheDocument();
    });

    it('says so when there is nobody', async () => {
      fetchDrivers.mockResolvedValue([]);
      renderPage();

      expect(await screen.findByText('Chưa có tài khoản tài xế nào.')).toBeInTheDocument();
    });

    it('shows the failure and reloads on retry', async () => {
      fetchDrivers.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([driver()]);
      renderPage();

      expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được dữ liệu.');
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

      expect(await screen.findByText('Nguyễn Văn Tài')).toBeInTheDocument();
    });

    it('★ keeps a disabled driver in the list, marked as such, with a re-enable control', async () => {
      fetchDrivers.mockResolvedValue([driver(), driver({ id: 'd2', displayName: 'Trần Văn Nghỉ', username: 'nghi', status: 'disabled' })]);
      renderPage();

      expect(await screen.findByText('Trần Văn Nghỉ')).toBeInTheDocument();
      expect(screen.getByText('Đã vô hiệu hóa')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Kích hoạt lại' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Vô hiệu hóa' })).toBeInTheDocument();
    });
  });

  describe('creating a driver', () => {
    it('★ opens the shared account dialog on "driver", sends the three fields, refreshes the list and never shows the password', async () => {
      createDriver.mockResolvedValue({ userId: 'd9', displayName: 'Lê Văn Mới', username: 'levanmoi' });
      renderPage();
      await screen.findByText('Nguyễn Văn Tài');
      fetchDrivers.mockResolvedValue([driver(), driver({ id: 'd9', displayName: 'Lê Văn Mới', username: 'levanmoi' })]);

      fireEvent.click(screen.getByRole('button', { name: 'Thêm tài xế' }));
      // The approvals screen's dialog, already on the driver kind: no department asked.
      expect(dialog().getByRole('button', { name: 'Tài xế', pressed: true })).toBeInTheDocument();
      expect(dialog().queryByLabelText('Phòng ban *')).toBeNull();
      fireEvent.change(dialog().getByLabelText('Họ và tên *'), { target: { value: 'Lê Văn Mới' } });
      fireEvent.change(dialog().getByLabelText('Email *'), { target: { value: 'levanmoi' } });
      fireEvent.change(dialog().getByLabelText('Mật khẩu tạm *'), { target: { value: 'Tam-2026!' } });
      fireEvent.click(dialog().getByRole('button', { name: 'Lưu nhân viên' }));

      await waitFor(() =>
        expect(createDriver).toHaveBeenCalledWith({
          displayName: 'Lê Văn Mới',
          email: 'levanmoi@hoanglonglti.com',
          initialPassword: 'Tam-2026!',
        }),
      );
      // The notice the approvals screen shows, with the address they sign in with.
      const notice = await screen.findByRole('status');
      expect(notice).toHaveTextContent('Đã tạo tài khoản tài xế.');
      expect(notice).toHaveTextContent('levanmoi@hoanglonglti.com');
      // ★ The typed secret is not on screen anywhere once the account exists.
      expect(document.body.textContent).not.toContain('Tam-2026!');
      expect(screen.queryByRole('dialog')).toBeNull();
      // The list was re-read, and holds the new driver.
      await waitFor(() => expect(fetchDrivers).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Lê Văn Mới', { selector: 'td' })).toBeInTheDocument();
    });

    it('shows the server sentence when creation is refused', async () => {
      const { ApiError } = await import('@/utils/errors');
      createDriver.mockRejectedValue(new ApiError(409, 'CONFLICT', 'That identity is already registered.'));
      renderPage();
      await screen.findByText('Nguyễn Văn Tài');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm tài xế' }));
      fireEvent.change(dialog().getByLabelText('Họ và tên *'), { target: { value: 'X' } });
      fireEvent.change(dialog().getByLabelText('Email *'), { target: { value: 'x' } });
      fireEvent.change(dialog().getByLabelText('Mật khẩu tạm *'), { target: { value: 'Tam-2026!' } });
      fireEvent.click(dialog().getByRole('button', { name: 'Lưu nhân viên' }));

      expect(await dialog().findByText('That identity is already registered.')).toBeInTheDocument();
    });
  });

  describe('disabling', () => {
    it('★ warns that assignments do not change, sends ONE status change, and the badge follows the re-read', async () => {
      setDriverStatus.mockResolvedValue({ id: 'd1', status: 'disabled' });
      renderPage();
      await screen.findByText('Nguyễn Văn Tài');
      fetchDrivers.mockResolvedValue([driver({ status: 'disabled' })]);

      fireEvent.click(screen.getByRole('button', { name: 'Vô hiệu hóa' }));

      expect(dialog().getByRole('alert')).toHaveTextContent(/phân công hiện tại KHÔNG tự động thay đổi/);
      expect(dialog().getByText(/không kết thúc, không thay thế/)).toBeInTheDocument();
      expect(dialog().getByText('Nguyễn Văn Tài')).toBeInTheDocument();
      expect(setDriverStatus).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận vô hiệu hóa' }));

      await waitFor(() => expect(setDriverStatus).toHaveBeenCalledWith('d1', 'disabled'));
      expect(setDriverStatus).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Đã vô hiệu hóa')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('sends nothing when cancelled', async () => {
      renderPage();
      await screen.findByText('Nguyễn Văn Tài');

      fireEvent.click(screen.getByRole('button', { name: 'Vô hiệu hóa' }));
      fireEvent.click(dialog().getByRole('button', { name: 'Hủy bỏ' }));

      expect(setDriverStatus).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the dialog open with the server sentence when refused', async () => {
      const { ApiError } = await import('@/utils/errors');
      setDriverStatus.mockRejectedValue(new ApiError(409, 'CONFLICT', 'That user is already disabled.'));
      renderPage();
      await screen.findByText('Nguyễn Văn Tài');

      fireEvent.click(screen.getByRole('button', { name: 'Vô hiệu hóa' }));
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận vô hiệu hóa' }));

      expect(await dialog().findByText('That user is already disabled.')).toBeInTheDocument();
    });
  });

  describe('re-enabling', () => {
    it('★ confirms, says no assignment is created, sends the status, and the badge follows', async () => {
      fetchDrivers.mockResolvedValue([driver({ status: 'disabled' })]);
      setDriverStatus.mockResolvedValue({ id: 'd1', status: 'active' });
      renderPage();
      await screen.findByText('Đã vô hiệu hóa');
      fetchDrivers.mockResolvedValue([driver({ status: 'active' })]);

      fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt lại' }));

      expect(dialog().getByText(/Không phân công chuyến nào được tạo hay khôi phục/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận kích hoạt' }));

      await waitFor(() => expect(setDriverStatus).toHaveBeenCalledWith('d1', 'active'));
      expect(await screen.findByText('Đang hoạt động')).toBeInTheDocument();
    });
  });

  describe('the detail panel', () => {
    it('★ reads the driver afresh and shows the six fields — and nothing that looks like a secret', async () => {
      fetchDriver.mockResolvedValue(driver({ status: 'disabled' }));
      renderPage();
      await screen.findByText('Nguyễn Văn Tài');

      fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));

      await waitFor(() => expect(fetchDriver).toHaveBeenCalledWith('d1'));
      const panel = dialog();
      expect(await panel.findByText('taixea')).toBeInTheDocument();
      expect(panel.getByText('Nguyễn Văn Tài')).toBeInTheDocument();
      // Once as the row label, once as the account type's value.
      expect(panel.getAllByText('Tài xế')).toHaveLength(2);
      expect(panel.getByText('Đã vô hiệu hóa')).toBeInTheDocument();
      expect(panel.getByText('Ngày tạo')).toBeInTheDocument();
      expect(panel.queryByText(/mật khẩu|password|hash|secret|token/i)).toBeNull();
      // The panel offers the way back for a disabled account.
      expect(panel.getByRole('button', { name: 'Kích hoạt lại' })).toBeInTheDocument();
    });

    it('opens the status confirmation from the panel', async () => {
      renderPage();
      await screen.findByText('Nguyễn Văn Tài');

      fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
      const disable = await dialog().findByRole('button', { name: 'Vô hiệu hóa' });
      fireEvent.click(disable);

      expect(await screen.findByText('Vô hiệu hóa tài khoản tài xế?')).toBeInTheDocument();
    });
  });
});
