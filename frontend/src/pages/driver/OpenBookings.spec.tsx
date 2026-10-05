import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';
import DriverTripsPage from './DriverTripsPage';

const fetchOpenBookings = vi.fn();
const fetchMyAssignmentRequests = vi.fn();
const requestOpenBooking = vi.fn();
const withdrawAssignmentRequest = vi.fn();
const notifyError = vi.fn();

vi.mock('@/api/driverPortal', () => ({ fetchMyAssignments: vi.fn().mockResolvedValue([]) }));
vi.mock('@/api/openBooking', () => ({
  fetchOpenBookings: (...a: unknown[]) => fetchOpenBookings(...a),
  fetchMyAssignmentRequests: (...a: unknown[]) => fetchMyAssignmentRequests(...a),
  requestOpenBooking: (...a: unknown[]) => requestOpenBooking(...a),
  withdrawAssignmentRequest: (...a: unknown[]) => withdrawAssignmentRequest(...a),
}));
vi.mock('@/utils/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/toast')>()),
  notifySuccess: vi.fn(),
  notifyError: (...a: unknown[]) => notifyError(...a),
}));

const booking = (over: Record<string, unknown> = {}) => ({
  tripId: 't1',
  scheduledOn: '2026-10-07',
  scheduledPickupAt: '2026-10-07T01:30:00.000Z',
  scheduledDeliveryAt: null,
  pickup: { name: 'Kho OSC', area: 'Phường 2, TP Hồ Chí Minh' },
  delivery: { name: 'TCS Tân Sơn Nhất', area: null },
  cargoInfo: '17CTN / 1.22CBM',
  driverInstructions: 'Gọi trước 30 phút',
  myPendingRequestId: null,
  ...over,
});

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  state: 'pending',
  requestedAt: '2026-10-05T03:00:00.000Z',
  resolvedAt: null,
  rejectionReason: null,
  supersededBecause: null,
  assignmentId: null,
  booking: booking(),
  ...over,
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/driver" element={<DriverTripsPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );

describe('★ open bookings — the driver asks, Dispatch assigns (0035)', () => {
  beforeEach(() => {
    fetchOpenBookings.mockReset().mockResolvedValue([booking()]);
    fetchMyAssignmentRequests.mockReset().mockResolvedValue([]);
    requestOpenBooking.mockReset().mockResolvedValue(request());
    withdrawAssignmentRequest.mockReset().mockResolvedValue(request({ state: 'withdrawn' }));
    notifyError.mockReset();
  });

  it('★ offers three labelled sections, and "Chuyến của tôi" is the bare /driver', async () => {
    renderAt('/driver');
    const sections = screen.getByRole('tablist', { name: 'Lịch làm việc' });
    expect(within(sections).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Chuyến của tôi',
      'Booking đang mở',
      'Yêu cầu của tôi',
    ]);
    fireEvent.click(within(sections).getByRole('tab', { name: 'Booking đang mở' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/driver?section=open');
    fireEvent.click(within(sections).getByRole('tab', { name: 'Chuyến của tôi' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/driver$/);
  });

  it('shows when, from where to where and what — by place name and area, and nothing commercial', async () => {
    renderAt('/driver?section=open');
    await screen.findByText('Kho OSC');
    // The card is the list's own item; the route stops inside it are an <ol> of their own.
    const card = screen.getByRole('tabpanel').querySelector('ul > li') as HTMLElement;
    for (const shown of ['Phường 2, TP Hồ Chí Minh', 'TCS Tân Sơn Nhất', '17CTN / 1.22CBM', 'Gọi trước 30 phút']) {
      expect(card).toHaveTextContent(shown);
    }
    // No figure in any shape money takes on this app: no price word, no grouped amount.
    expect(card).not.toHaveTextContent(/giá|VND|\d{1,3}(,\d{3})+/i);
    expect(fetchMyAssignmentRequests).not.toHaveBeenCalled();
  });

  it('★ "Xin nhận chuyến" asks for THAT booking, then reads the lists again', async () => {
    renderAt('/driver?section=open');
    fireEvent.click(await screen.findByRole('button', { name: 'Xin nhận chuyến' }));
    await waitFor(() => expect(requestOpenBooking).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(fetchOpenBookings).toHaveBeenCalledTimes(2));
  });

  it('shows a pending ask as waiting, and offers to withdraw it — not to ask twice', async () => {
    fetchOpenBookings.mockResolvedValue([booking({ myPendingRequestId: 'r1' })]);
    renderAt('/driver?section=open');
    expect(await screen.findByText('Đang chờ duyệt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xin nhận chuyến' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rút yêu cầu' }));
    await waitFor(() => expect(withdrawAssignmentRequest).toHaveBeenCalledWith('r1'));
  });

  it('★ says in words that a booking was taken — a toast, because the card goes away', async () => {
    requestOpenBooking.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'That booking is no longer open.', { booking: 'BOOKING_NOT_OPEN' }),
    );
    renderAt('/driver?section=open');
    fireEvent.click(await screen.findByRole('button', { name: 'Xin nhận chuyến' }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('driverErrBookingNotOpen'));
    await waitFor(() => expect(fetchOpenBookings).toHaveBeenCalledTimes(2));
  });

  it('says so when nothing is open', async () => {
    fetchOpenBookings.mockResolvedValue([]);
    renderAt('/driver?section=open');
    expect(await screen.findByText('Hiện chưa có booking nào đang mở.')).toBeInTheDocument();
  });

  it('★ "Yêu cầu của tôi" says where each ask stands — and an approved one opens the trip', async () => {
    fetchMyAssignmentRequests.mockResolvedValue([
      request({ id: 'r-pending' }),
      request({ id: 'r-approved', state: 'approved', assignmentId: 'a9' }),
      request({ id: 'r-rejected', state: 'rejected', rejectionReason: 'Đã đủ xe' }),
      request({ id: 'r-withdrawn', state: 'withdrawn' }),
      request({ id: 'r-taken', state: 'superseded', supersededBecause: 'trip_assigned' }),
      request({ id: 'r-closed', state: 'superseded', supersededBecause: 'trip_archived' }),
    ]);
    renderAt('/driver?section=requests');
    await screen.findByText('Đã rút');
    // The cards are the list's own items — the route stops inside them are lists too.
    const list = screen.getByRole('tabpanel').querySelector('ul') as HTMLElement;
    const cards = [...list.children].map((item) => item.textContent ?? '');
    expect(cards[0]).toContain('Đang chờ duyệt');
    expect(cards[1]).toContain('Đã được nhận');
    expect(cards[2]).toMatch(/Bị từ chối.*Đã đủ xe/);
    expect(cards[3]).toContain('Đã rút');
    expect(cards[4]).toContain('Đã có tài xế khác nhận');
    expect(cards[5]).toContain('Booking đã đóng');
    expect(screen.getByRole('link', { name: /Xem chuyến/ })).toHaveAttribute('href', '/driver/assignments/a9');
    expect(screen.getAllByRole('button', { name: 'Rút yêu cầu' })).toHaveLength(1);
  });

  it('a decided ask answers 409 — said as "already decided", and the list is read again', async () => {
    fetchMyAssignmentRequests.mockResolvedValue([request()]);
    withdrawAssignmentRequest.mockRejectedValue(new ApiError(409, 'CONFLICT', 'That request is no longer pending.'));
    renderAt('/driver?section=requests');
    fireEvent.click(await screen.findByRole('button', { name: 'Rút yêu cầu' }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('driverErrRequestResolved'));
    await waitFor(() => expect(fetchMyAssignmentRequests).toHaveBeenCalledTimes(2));
  });
});
