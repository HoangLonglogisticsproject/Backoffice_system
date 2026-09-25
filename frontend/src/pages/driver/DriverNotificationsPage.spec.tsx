import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';
import DriverNotificationsPage from './DriverNotificationsPage';
import { destinationOf } from '@/utils/driverNotifications';
import type { Notification, NotificationType } from '@/types/notification';

const fetchNotifications = vi.fn();
const markNotificationRead = vi.fn();

vi.mock('@/api/notifications', () => ({
  fetchNotifications: (...a: unknown[]) => fetchNotifications(...a),
  markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
  notificationStreamUrl: () => '/notifications/stream',
}));

const note = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  recipientUserId: 'd1',
  type: 'TRIP_ASSIGNED',
  tripId: 't1',
  tripScheduledOn: '2026-08-30',
  detail: null,
  readAt: null,
  createdAt: '2026-08-29T10:00:00.000Z',
  ...over,
});

/** Where a tap landed — the schedule's tab lives in the search. */
const Landed = () => {
  const { pathname, search } = useLocation();
  return <p>{`AT ${pathname}${search}`}</p>;
};

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/driver/notifications']}>
          <Routes>
            <Route path="/driver" element={<Landed />} />
            <Route path="/driver/notifications" element={<DriverNotificationsPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  // 10:00 in Ho Chi Minh: business day 2026-08-30, the fixture's trip day.
  vi.setSystemTime(new Date('2026-08-30T03:00:00.000Z'));
  fetchNotifications.mockReset().mockResolvedValue({ items: [], unreadCount: 0 });
  markNotificationRead.mockReset().mockResolvedValue(note({ readAt: '2026-08-29T10:01:00.000Z' }));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The list a driver reads, and where a tap leads.
 *
 * ⚠ A TAP IS A NAVIGATION, NEVER A KEY. Landing on the trip still asks the
 * server, which refuses a driver no longer on it; nothing here proves access.
 */
describe('DriverNotificationsPage', () => {
  it('says so when there is nothing', async () => {
    renderPage();
    expect(await screen.findByText(/chưa có thông báo nào/i)).toBeInTheDocument();
  });

  it('★ renders the sentence from the TYPE, the day from the snapshot, and the reason', async () => {
    fetchNotifications.mockResolvedValue({
      items: [
        note(),
        note({ id: 'n2', type: 'COMPLETION_REJECTED', detail: 'Thiếu hoá đơn dầu', readAt: '2026-08-29T11:00:00.000Z' }),
      ],
      unreadCount: 1,
    });
    renderPage();

    expect(await screen.findByText(/bạn được phân công chuyến/i)).toBeInTheDocument();
    expect(screen.getByText(/bị trả lại/i)).toBeInTheDocument();
    expect(screen.getByText(/lý do: thiếu hoá đơn dầu/i)).toBeInTheDocument();
    expect(screen.getAllByText(/chuyến ngày/i)).toHaveLength(2);
    // Exactly one is marked unread.
    expect(screen.getAllByRole('button', { name: /chưa đọc/i })).toHaveLength(1);
  });

  it('★ marks an unread one read and opens the list — a trip may hold two of the driver’s turns, so the list chooses', async () => {
    fetchNotifications.mockResolvedValue({ items: [note()], unreadCount: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bạn được phân công chuyến/i }));

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(await screen.findByText('AT /driver')).toBeInTheDocument();
  });

  it('does not stamp one that is already read', async () => {
    fetchNotifications.mockResolvedValue({ items: [note({ readAt: '2026-08-29T11:00:00.000Z' })], unreadCount: 0 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bạn được phân công chuyến/i }));

    expect(await screen.findByText('AT /driver')).toBeInTheDocument();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('★ sends a driver taken off a trip to the list, not to a trip they no longer hold', async () => {
    fetchNotifications.mockResolvedValue({ items: [note({ type: 'TRIP_UNASSIGNED' })], unreadCount: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /không còn lái/i }));

    expect(await screen.findByText('AT /driver')).toBeInTheDocument();
  });

  it('still navigates when the read stamp fails — the stamp is a courtesy', async () => {
    fetchNotifications.mockResolvedValue({ items: [note()], unreadCount: 1 });
    markNotificationRead.mockRejectedValue(new ApiError(0, undefined, 'offline'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bạn được phân công chuyến/i }));

    expect(await screen.findByText('AT /driver')).toBeInTheDocument();
  });

  it('shows a driver-worded failure when the list cannot be read', async () => {
    fetchNotifications.mockRejectedValue(new ApiError(0, undefined, 'offline'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/không có kết nối/i);
  });

  it('★ sends a trip on a later day to the schedule on the upcoming tab', async () => {
    fetchNotifications.mockResolvedValue({ items: [note({ tripScheduledOn: '2026-09-01' })], unreadCount: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bạn được phân công chuyến/i }));

    expect(await screen.findByText('AT /driver?view=upcoming')).toBeInTheDocument();
  });
});

const TYPES: NotificationType[] = ['TRIP_ASSIGNED', 'TRIP_UNASSIGNED', 'COMPLETION_REJECTED', 'COMPLETION_APPROVED'];

describe('destinationOf', () => {
  it.each([
    ['2026-08-30', '/driver'],
    ['2026-08-31', '/driver?view=upcoming'],
    ['2026-08-29', '/driver?view=past'],
  ])('a trip on %s, seen on 2026-08-30, leads to %s whatever the type', (tripScheduledOn, destination) => {
    for (const type of TYPES) {
      expect(destinationOf(note({ type, tripScheduledOn }), '2026-08-30'), type).toBe(destination);
    }
  });
});
