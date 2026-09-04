import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { LanguageProvider } from '@/contexts/LanguageContext';

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
const fetchMyTrips = vi.fn();

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
  fetchMyTrips: (...a: unknown[]) => fetchMyTrips(...a),
  fetchMyTrip: vi.fn(),
  recordExecutionEvent: vi.fn(),
  declareExpense: vi.fn(),
  editExpense: vi.fn(),
  submitCompletion: vi.fn(),
}));

const driverSession = () => ({
  state: {
    status: 'ready',
    authorization: {
      userId: 'd1',
      username: 'taixe.a',
      accountType: 'driver',
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

beforeEach(() => {
  useSession.mockReset().mockReturnValue(driverSession());
  fetchMyTrips.mockReset().mockResolvedValue([]);
  fetchNotifications.mockReset().mockResolvedValue({ items: [], unreadCount: 2 });
});

describe('★ a driver is given the Driver Portal, and only that', () => {
  it.each(['/', '/dispatch/master-data', '/dispatch/trip-schedule', '/organization/departments', '/system/approvals', '/system/drivers'])(
    'lands in the portal from %s, with no Backoffice navigation drawn',
    async (path) => {
      renderAt(path);

      // The portal shell — and the trip list, which asked the server with no
      // parameter, because the scope is the session.
      expect(await screen.findByRole('heading', { name: /cổng tài xế/i })).toBeInTheDocument();
      expect(await screen.findByText(/chưa được phân công/i)).toBeInTheDocument();
      expect(fetchMyTrips).toHaveBeenCalledWith();

      for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
      expect(screen.queryByText(/không có quyền/i)).not.toBeInTheDocument();
    },
  );

  it('answers a mistyped portal path with the trip list rather than a refusal page', async () => {
    renderAt('/driver/nonsense');

    expect(await screen.findByText(/chưa được phân công/i)).toBeInTheDocument();
    expect(screen.queryByText(/không có quyền/i)).not.toBeInTheDocument();
  });

  it('★ shows the unread count from the API on the bell, linking to the list', async () => {
    renderAt('/driver');

    expect(await screen.findByTestId('unread-badge')).toHaveTextContent('2');
    // The bell in the top bar and the row in the sidebar — both to the list.
    const links = screen.getAllByRole('link', { name: /thông báo/i });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/driver/notifications');
  });

  it('renders the notification list inside the portal', async () => {
    renderAt('/driver/notifications');

    expect(await screen.findByText(/chưa có thông báo nào/i)).toBeInTheDocument();
    for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
  });

  it('offers the one account function a driver has — their password — inside the portal', async () => {
    renderAt('/driver');

    await screen.findByRole('heading', { name: /cổng tài xế/i });
    expect(screen.getByRole('link', { name: /thay đổi mật khẩu/i })).toHaveAttribute(
      'href',
      '/driver/account/security',
    );
  });

  it('renders the password screen inside the portal shell, not the Backoffice one', async () => {
    renderAt('/driver/account/security');

    expect(await screen.findByRole('heading', { name: /cổng tài xế/i })).toBeInTheDocument();
    expect(screen.getAllByText(/thay đổi mật khẩu/i).length).toBeGreaterThan(0);
    for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
  });
});

/**
 * ★ THE PORTAL IS AN APPLICATION, NOT A PAGE. The same shell as the
 * Backoffice — sidebar, top bar, drawer on a phone — with the driver's own
 * three destinations and nothing the Backoffice offers.
 */
describe('★ the driver’s application shell', () => {
  const nav = () => within(screen.getByRole('navigation'));

  it('draws the driver’s destinations in the sidebar, and only those', async () => {
    renderAt('/driver');
    await screen.findByText(/chưa được phân công/i);

    expect(nav().getByRole('link', { name: /chuyến của tôi/i })).toHaveAttribute('href', '/driver');
    expect(nav().getByRole('link', { name: /thông báo/i })).toHaveAttribute('href', '/driver/notifications');
    expect(nav().getByRole('link', { name: /hồ sơ/i })).toHaveAttribute('href', '/driver/account/security');
    expect(nav().getAllByRole('link')).toHaveLength(3);
    // Who is signed in, and the way out, in the sidebar.
    expect(screen.getByText('taixe.a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /đăng xuất/i })).toBeInTheDocument();
  });

  it('lights "my trips" on the list AND on a trip’s detail — the same application, a different page', async () => {
    renderAt('/driver');
    await screen.findByText(/chưa được phân công/i);
    expect(nav().getByRole('link', { name: /chuyến của tôi/i })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: /thông báo/i })).not.toHaveAttribute('aria-current');

    cleanup();
    renderAt('/driver/trips/t1');
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expect(nav().getByRole('link', { name: /chuyến của tôi/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: /cổng tài xế/i })).toBeInTheDocument();
  });

  it('lights "notifications" on the list of what the driver was told', async () => {
    renderAt('/driver/notifications');
    await screen.findByText(/chưa có thông báo nào/i);

    expect(nav().getByRole('link', { name: /thông báo/i })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: /chuyến của tôi/i })).not.toHaveAttribute('aria-current');
  });

  it('★ on a phone the sidebar is a drawer: the menu opens it, choosing a destination closes it', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      renderAt('/driver');
      await screen.findByText(/chưa được phân công/i);
      const drawer = screen.getByRole('navigation').closest('aside')!;
      const menu = screen.getByRole('button', { name: /ẩn\/hiện điều hướng/i });

      expect(drawer).toHaveAttribute('data-state', 'closed');
      fireEvent.click(menu);
      expect(drawer).toHaveAttribute('data-state', 'open');
      expect(screen.getByRole('button', { name: /đóng điều hướng/i })).toBeInTheDocument();

      fireEvent.click(nav().getByRole('link', { name: /thông báo/i }));
      expect(drawer).toHaveAttribute('data-state', 'closed');
      expect(await screen.findByText(/chưa có thông báo nào/i)).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
