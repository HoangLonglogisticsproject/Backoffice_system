import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';
import DriverNotificationsPage from './DriverNotificationsPage';
import { destinationOf } from '@/utils/driverNotifications';
import type { Notification } from '@/types/notification';

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

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/driver/notifications']}>
          <Routes>
            <Route path="/driver" element={<p>TRIP LIST</p>} />
            <Route path="/driver/notifications" element={<DriverNotificationsPage />} />
            <Route path="/driver/trips/:tripId" element={<p>TRIP PAGE</p>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchNotifications.mockReset().mockResolvedValue({ items: [], unreadCount: 0 });
  markNotificationRead.mockReset().mockResolvedValue(note({ readAt: '2026-08-29T10:01:00.000Z' }));
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
    expect(screen.getAllByText(/chuyến ngày/i).length).toBe(2);
    // Exactly one is marked unread.
    expect(screen.getAllByRole('button', { name: /chưa đọc/i })).toHaveLength(1);
  });

  it('★ marks an unread one read and opens the trip', async () => {
    fetchNotifications.mockResolvedValue({ items: [note()], unreadCount: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bạn được phân công chuyến/i }));

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(await screen.findByText('TRIP PAGE')).toBeInTheDocument();
  });

  it('does not stamp one that is already read', async () => {
    fetchNotifications.mockResolvedValue({ items: [note({ readAt: '2026-08-29T11:00:00.000Z' })], unreadCount: 0 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bạn được phân công chuyến/i }));

    expect(await screen.findByText('TRIP PAGE')).toBeInTheDocument();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('★ sends a driver taken off a trip to the list, not to a trip they no longer hold', async () => {
    fetchNotifications.mockResolvedValue({ items: [note({ type: 'TRIP_UNASSIGNED' })], unreadCount: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /không còn lái/i }));

    expect(await screen.findByText('TRIP LIST')).toBeInTheDocument();
  });

  it('still navigates when the read stamp fails — the stamp is a courtesy', async () => {
    fetchNotifications.mockResolvedValue({ items: [note()], unreadCount: 1 });
    markNotificationRead.mockRejectedValue(new ApiError(0, undefined, 'offline'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bạn được phân công chuyến/i }));

    expect(await screen.findByText('TRIP PAGE')).toBeInTheDocument();
  });

  it('shows a driver-worded failure when the list cannot be read', async () => {
    fetchNotifications.mockRejectedValue(new ApiError(0, undefined, 'offline'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/không có kết nối/i);
  });

  it('maps every type to a destination', () => {
    expect(destinationOf(note())).toBe('/driver/trips/t1');
    expect(destinationOf(note({ type: 'COMPLETION_REJECTED' }))).toBe('/driver/trips/t1');
    expect(destinationOf(note({ type: 'COMPLETION_APPROVED' }))).toBe('/driver/trips/t1');
    expect(destinationOf(note({ type: 'TRIP_UNASSIGNED' }))).toBe('/driver');
  });
});
