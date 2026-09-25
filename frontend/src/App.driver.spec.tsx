import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';

/**
 * The application, as a DRIVER sees it.
 *
 * ★ THE OBSERVATION THIS PINS DOWN. A driver test account signed in and was
 * handed the Backoffice sidebar — departments, the dispatch board, the vehicle
 * and customer catalogue, reports — every row of which the server refuses to
 * a driver account. Clicking "Danh mục xe & khách" produced "Không có quyền".
 * Security-correct, navigation-wrong: a menu must not offer what the caller
 * cannot use.
 *
 * ⚠ NAVIGATION, NOT AUTHORIZATION. What this proves is which SHELL renders.
 * That the server refuses a driver every Backoffice route is proved in the
 * backend security specs, and stays true whatever this file draws.
 */
const useSession = vi.fn();
const fetchMyAssignments = vi.fn();
const fetchMyAssignment = vi.fn();

vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
const fetchNotifications = vi.fn();
vi.mock('@/api/notifications', () => ({
  fetchNotifications: (...a: unknown[]) => fetchNotifications(...a),
  markNotificationRead: vi.fn(),
  notificationStreamUrl: () => '/notifications/stream',
}));
vi.mock('@/api/driverPortal', () => ({
  fetchMyAssignments: (...a: unknown[]) => fetchMyAssignments(...a),
  fetchMyAssignment: (...a: unknown[]) => fetchMyAssignment(...a),
  recordExecutionEvent: vi.fn(),
  declareExpense: vi.fn(),
  editExpense: vi.fn(),
  submitCompletion: vi.fn(),
}));

const sessionOf = (accountType: 'driver' | 'employee') => ({
  state: {
    status: 'ready',
    authorization: {
      userId: 'd1',
      username: 'taixe.a',
      accountType,
      role: 'MEMBER',
      departmentIds: [],
      // ★ EXACTLY WHAT THE SERVER LISTS FOR A DRIVER: `trip.read` and
      // `trip.create` are `'any'`, so they appear — and the Backoffice still
      // refuses every route behind them. A shell drawn from this list alone
      // is the bug.
      permissions: ['trip.read', 'trip.create'],
    },
  },
  loading: false,
  signOut: vi.fn(),
  reload: vi.fn(),
  signIn: vi.fn(),
  can: (permission: string) => ['trip.read', 'trip.create'].includes(permission),
});

const renderAt = (path: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

/** The Backoffice rows the driver was shown, none of which may appear. */
const BACKOFFICE_ROWS = [
  /phòng ban/i,
  /quản lý tài xế/i,
  /lịch xe/i,
  /danh mục xe & khách/i,
  /báo cáo/i,
  /ai điều phối/i,
  /phê duyệt/i,
  /yêu cầu/i,
  /tài liệu/i,
];

const driverNav = () => screen.getByRole('navigation', { name: 'Cổng tài xế' });
const navLink = (name: string | RegExp) => within(driverNav()).getByRole('link', { name });

beforeEach(() => {
  useSession.mockReset().mockReturnValue(sessionOf('driver'));
  fetchMyAssignments.mockReset().mockResolvedValue([]);
  // A refusal, so the detail hook's own retry predicate does not retry it.
  fetchMyAssignment.mockReset().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found.'));
  fetchNotifications.mockReset().mockResolvedValue({ items: [], unreadCount: 2 });
});

describe('★ a driver is given the Driver Portal, and only that', () => {
  it.each(['/', '/dispatch/master-data', '/dispatch/trip-schedule', '/organization/departments', '/system/approvals', '/system/drivers'])(
    'lands in the portal from %s, with no Backoffice navigation drawn',
    async (path) => {
      renderAt(path);

      // The portal shell — and the schedule, which asked the server with no
      // parameter, because the scope is the session.
      expect(await screen.findByText('Bạn chưa có chuyến nào hôm nay.')).toBeInTheDocument();
      expect(driverNav()).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Lịch làm việc' })).toBeInTheDocument();
      expect(fetchMyAssignments).toHaveBeenCalledWith();

      for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
      expect(screen.queryByText(/không có quyền/i)).not.toBeInTheDocument();
    },
  );

  it('answers a mistyped portal path with the schedule rather than a refusal page', async () => {
    renderAt('/driver/nonsense');

    expect(await screen.findByText('Bạn chưa có chuyến nào hôm nay.')).toBeInTheDocument();
    expect(screen.queryByText(/không có quyền/i)).not.toBeInTheDocument();
  });

  // ★ The badge is decoration (aria-hidden, capped at 99+); a screen reader
  // hears the real count in the link's name.
  it.each([
    [2, '2'],
    [150, '99+'],
  ])('★ shows %i unread from the API on the notifications tab as "%s", linking to the list', async (unreadCount, badge) => {
    fetchNotifications.mockResolvedValue({ items: [], unreadCount });
    renderAt('/driver');

    expect(await screen.findByTestId('unread-badge')).toHaveTextContent(badge);
    // Matched loosely: jsdom's name computation drops the sr-only span's leading space.
    expect(navLink(new RegExp(String.raw`^Thông báo ?\(${unreadCount} chưa đọc\)$`))).toHaveAttribute(
      'href',
      '/driver/notifications',
    );
  });

  it('draws no badge, and names the tab plainly, when nothing is unread', async () => {
    fetchNotifications.mockResolvedValue({ items: [], unreadCount: 0 });
    // The list page reads the same query, so its empty text means the count is in.
    renderAt('/driver/notifications');
    await screen.findByText('Chưa có thông báo nào.');

    expect(navLink('Thông báo')).toHaveAttribute('href', '/driver/notifications');
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
  });

  it('renders the notification list inside the portal', async () => {
    renderAt('/driver/notifications');

    expect(await screen.findByText('Chưa có thông báo nào.')).toBeInTheDocument();
    expect(driverNav()).toBeInTheDocument();
    for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
  });

  it('renders the password screen inside the portal shell, not the Backoffice one', async () => {
    renderAt('/driver/account/security');

    expect(await screen.findByRole('heading', { level: 1, name: 'Thay đổi mật khẩu' })).toBeInTheDocument();
    expect(navLink('Hồ sơ')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'Backoffice System' })).not.toBeInTheDocument();
    for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
  });

  it('★ does not hand an employee the driver shell on /driver — they go to the Backoffice', async () => {
    useSession.mockReturnValue(sessionOf('employee'));
    renderAt('/driver');

    expect(await screen.findByRole('heading', { name: 'Backoffice System' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Cổng tài xế' })).not.toBeInTheDocument();
    expect(fetchMyAssignments).not.toHaveBeenCalled();
  });
});

/**
 * ★ ITS OWN PHONE-FIRST SHELL, NOT `AppShell` (DL-114). A top bar that says
 * whose portal it is, the driver's three destinations where a thumb reaches
 * them, and nothing the Backoffice offers — no sidebar, no drawer.
 */
describe('★ the driver’s application shell', () => {
  it('draws the driver’s three destinations, and only those', async () => {
    renderAt('/driver');
    await screen.findByText('Bạn chưa có chuyến nào hôm nay.');

    expect(within(driverNav()).getAllByRole('link')).toHaveLength(3);
    expect(navLink('Lịch làm việc')).toHaveAttribute('href', '/driver');
    expect(navLink(/^Thông báo/)).toHaveAttribute('href', '/driver/notifications');
    expect(navLink('Hồ sơ')).toHaveAttribute('href', '/driver/account/security');
  });

  it('says whose portal this is — a phone may be shared between drivers', async () => {
    renderAt('/driver');
    await screen.findByText('Bạn chưa có chuyến nào hôm nay.');

    expect(screen.getByText('Cổng tài xế · taixe.a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
  });

  it('draws none of the Backoffice chrome: no sidebar toggle, no drawer', async () => {
    renderAt('/driver');
    await screen.findByText('Bạn chưa có chuyến nào hôm nay.');

    expect(screen.queryByRole('button', { name: /ẩn\/hiện điều hướng/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  // ★ A trip's detail keeps "Lịch làm việc" lit — the same place, one level down.
  it.each([
    ['/driver', 'Lịch làm việc', 'Bạn chưa có chuyến nào hôm nay.'],
    ['/driver/assignments/a1', 'Lịch làm việc', 'Không tìm thấy chuyến này.'],
    ['/driver/notifications', 'Thông báo', 'Chưa có thông báo nào.'],
    ['/driver/account/security', 'Hồ sơ', 'Thay đổi mật khẩu'],
  ])('on %s lights "%s" and no other destination', async (path, current, settled) => {
    renderAt(path);
    await screen.findAllByText(settled);

    expect(navLink(new RegExp(`^${current}`))).toHaveAttribute('aria-current', 'page');
    const lit = within(driverNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(lit).toHaveLength(1);
  });

  it('signs out and leaves the portal for the login screen', async () => {
    const session = sessionOf('driver');
    // What the real provider does: after sign-out the session is anonymous,
    // so the login screen stays rather than bouncing a live session home.
    session.signOut.mockImplementation(async () => {
      useSession.mockReturnValue({ ...session, state: { status: 'anonymous' } });
    });
    useSession.mockReturnValue(session);
    renderAt('/driver');
    await screen.findByText('Bạn chưa có chuyến nào hôm nay.');

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(session.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('navigation', { name: 'Cổng tài xế' })).not.toBeInTheDocument();
  });
});
