import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      expect(await screen.findByText(/cổng tài xế/i)).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: /thông báo/i })).toHaveAttribute('href', '/driver/notifications');
  });

  it('renders the notification list inside the portal', async () => {
    renderAt('/driver/notifications');

    expect(await screen.findByText(/chưa có thông báo nào/i)).toBeInTheDocument();
    for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
  });

  it('offers the one account function a driver has — their password — inside the portal', async () => {
    renderAt('/driver');

    await screen.findByText(/cổng tài xế/i);
    expect(screen.getByRole('link', { name: /thay đổi mật khẩu/i })).toHaveAttribute(
      'href',
      '/driver/account/security',
    );
  });

  it('renders the password screen inside the portal shell, not the Backoffice one', async () => {
    renderAt('/driver/account/security');

    expect(await screen.findByText(/cổng tài xế/i)).toBeInTheDocument();
    expect(screen.getAllByText(/thay đổi mật khẩu/i).length).toBeGreaterThan(0);
    for (const row of BACKOFFICE_ROWS) expect(screen.queryByText(row)).not.toBeInTheDocument();
  });
});
