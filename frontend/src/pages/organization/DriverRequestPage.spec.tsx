import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DriverRequestPage from './DriverRequestPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * Driver account requests, drawn by the queue shell every other request uses.
 *
 * ★ WHAT THESE CASES PIN. The administrator gets the same table, the same
 * two row actions and the same confirmation as the membership and invitation
 * queues; a rejection cannot be sent without a reason; approving hands over
 * the one-time credential through the same dialog the invitation queue uses;
 * a head gets the read-only history with the status as a column.
 */
const fetchPendingDriverRequests = vi.fn();
const fetchMyDriverRequests = vi.fn();
const approveDriverRequest = vi.fn();
const rejectDriverRequest = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/driverAccounts', () => ({
  fetchPendingDriverRequests: (...a: unknown[]) => fetchPendingDriverRequests(...a),
  fetchMyDriverRequests: (...a: unknown[]) => fetchMyDriverRequests(...a),
  approveDriverRequest: (...a: unknown[]) => approveDriverRequest(...a),
  rejectDriverRequest: (...a: unknown[]) => rejectDriverRequest(...a),
}));

vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const session = (permissions: string[]) => ({
  state: { status: 'ready', authorization: { userId: 'me', username: 'me', role: 'SUPERADMIN', departmentIds: [], permissions } },
  loading: false,
  can: (p: string) => permissions.includes(p),
});

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  email: 'taixea@hoanglonglti.com',
  displayName: 'Tài Xế A',
  status: 'pending',
  requestedBy: 'h1',
  requestedAt: '2026-08-18T08:34:23.633Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  createdUserId: null,
  requester: { id: 'h1', displayName: 'Trưởng Phòng' },
  decider: null,
  ...over,
});

const renderPage = () =>
  render(
    <LanguageProvider>
      <MemoryRouter>
        <DriverRequestPage />
      </MemoryRouter>
    </LanguageProvider>,
  );

const dialog = () => within(screen.getByRole('dialog'));

beforeEach(() => {
  vi.clearAllMocks();
  useSession.mockReturnValue(session(['user.write']));
  fetchPendingDriverRequests.mockResolvedValue([request()]);
  fetchMyDriverRequests.mockResolvedValue([]);
});

describe('DriverRequestPage', () => {
  describe('the administrator’s queue', () => {
    it('★ is the shared queue table: the request’s columns plus the actions column', async () => {
      renderPage();

      expect(await screen.findByText('Tài Xế A')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Đề xuất tài khoản tài xế' })).toBeInTheDocument();
      for (const heading of ['Tài xế', 'Email', 'Người yêu cầu', 'Thời điểm', 'Thao tác']) {
        expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
      }
      expect(screen.getByText('taixea@hoanglonglti.com')).toBeInTheDocument();
      expect(screen.getByText('Trưởng Phòng')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Từ chối' })).toBeInTheDocument();
      expect(fetchPendingDriverRequests).toHaveBeenCalledTimes(1);
      expect(fetchMyDriverRequests).not.toHaveBeenCalled();
    });

    it('says so when nothing is waiting', async () => {
      fetchPendingDriverRequests.mockResolvedValue([]);
      renderPage();

      expect(await screen.findByText('Không có đề xuất nào đang chờ.')).toBeInTheDocument();
    });

    it('★ approves through the confirmation, then hands over the generated credential once', async () => {
      approveDriverRequest.mockResolvedValue({
        request: request({ status: 'approved' }),
        driver: { userId: 'd1', displayName: 'Tài Xế A', username: 'taixea', temporaryPassword: 'Gen-Secret-1' },
      });
      renderPage();
      await screen.findByText('Tài Xế A');

      fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
      expect(approveDriverRequest).not.toHaveBeenCalled();
      const confirms = screen.getAllByRole('button', { name: 'Duyệt' });
      fireEvent.click(confirms[confirms.length - 1]!);

      await waitFor(() => expect(approveDriverRequest).toHaveBeenCalledWith('r1'));
      const handover = await screen.findByText('Gen-Secret-1');
      expect(handover).toBeInTheDocument();
      // The full address, which is what they sign in with.
      expect(dialog().getByText('taixea@hoanglonglti.com')).toBeInTheDocument();
      // The queue re-read after the decision.
      await waitFor(() => expect(fetchPendingDriverRequests).toHaveBeenCalledTimes(2));
    });

    it('★ will not send a rejection without a reason, and sends the reason when there is one', async () => {
      rejectDriverRequest.mockResolvedValue(request({ status: 'rejected' }));
      renderPage();
      await screen.findByText('Tài Xế A');

      fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
      const confirm = dialog().getByRole('button', { name: 'Từ chối' });
      expect(confirm).toBeDisabled();
      expect(dialog().getByLabelText('Lý do *')).toBeRequired();

      fireEvent.change(dialog().getByLabelText('Lý do *'), { target: { value: 'Chưa có giấy phép.' } });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);

      await waitFor(() => expect(rejectDriverRequest).toHaveBeenCalledWith('r1', 'Chưa có giấy phép.'));
    });
  });

  describe('a head’s own proposals', () => {

    beforeEach(() => {
      useSession.mockReturnValue(session(['driver.account.request']));
      fetchMyDriverRequests.mockResolvedValue([
        request({ id: 'r2', status: 'rejected', decider: { id: 'b1', displayName: 'Giám Đốc' }, decisionReason: 'Sai email.' }),
        request({ id: 'r3', displayName: 'Tài Xế B' }),
      ]);
    });

    it('says they have proposed nobody — not that nothing is waiting', async () => {
      fetchMyDriverRequests.mockResolvedValue([]);
      renderPage();

      expect(await screen.findByText('Bạn chưa gửi đề xuất tài khoản tài xế nào.')).toBeInTheDocument();
      expect(screen.queryByText('Không có đề xuất nào đang chờ.')).toBeNull();
    });

    it('★ reads only their own, as history with the status and the reason, and offers no decision', async () => {
      renderPage();

      expect(await screen.findByText('Tài Xế B')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Đề xuất của tôi' })).toBeInTheDocument();
      expect(fetchMyDriverRequests).toHaveBeenCalledTimes(1);
      expect(fetchPendingDriverRequests).not.toHaveBeenCalled();
      expect(screen.getByText('Từ chối')).toBeInTheDocument();
      expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
      expect(screen.getByText('Giám Đốc')).toBeInTheDocument();
      expect(screen.getByText('Sai email.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Từ chối' })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: 'Thao tác' })).toBeNull();
    });
  });
});
