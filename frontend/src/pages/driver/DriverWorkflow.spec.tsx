import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';
import DriverTripPage from './DriverTripPage';
import DriverTripsPage from './DriverTripsPage';

/**
 * The driver's screen as a workflow: what the list says, which stage is lit,
 * and what each card says at each point of the trip.
 *
 * The business rules behind every state live in `utils/driverExecution` and
 * are pinned there; these cases pin that the SCREEN reads them correctly —
 * the stepper, the header pill, the milestone cards, the expense lifecycle
 * and the completion summary.
 */
const fetchMyTrips = vi.fn();
const fetchMyTrip = vi.fn();

vi.mock('@/api/driverPortal', () => ({
  fetchMyTrips: (...a: unknown[]) => fetchMyTrips(...a),
  fetchMyTrip: (...a: unknown[]) => fetchMyTrip(...a),
  recordExecutionEvent: vi.fn(),
  declareExpense: vi.fn(),
  editExpense: vi.fn(),
  submitCompletion: vi.fn(),
}));

const AT = '2026-08-30T02:00:00.000Z';

const event = (type: string, over: Record<string, unknown> = {}) => ({
  id: `e-${type}`,
  tripId: 't1',
  driverAssignmentId: 'a1',
  type,
  vehicleId: 'v1',
  vehicleOwnership: 'company',
  scheduledAt: AT,
  actualAt: AT,
  recordedAt: AT,
  deviceReportedAt: null,
  location: null,
  geofencePassed: null,
  distanceM: null,
  recordedBy: 'd1',
  recordedByUser: { id: 'd1', displayName: 'Tài Xế A' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const cost = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  tripId: 't1',
  category: 'fuel',
  amount: '200000.00',
  note: null,
  state: 'editable',
  source: 'driver_portal',
  driverAssignmentId: 'a1',
  vehicleId: 'v1',
  vehicleOwnership: 'company',
  lockedAt: null,
  lockedBy: null,
  createdBy: 'd1',
  createdAt: AT,
  createdByUser: { id: 'd1', displayName: 'Tài Xế A' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const JOURNEY = [
  event('ARRIVED_PICKUP'),
  event('PICKUP_CONFIRMED'),
  event('ARRIVED_DELIVERY'),
  event('DELIVERY_CONFIRMED'),
];

const trip = (over: Record<string, unknown> = {}) => ({
  tripId: 't1',
  scheduledOn: '2026-08-30',
  vehicle: { id: 'v1', plate: '51D-65233' },
  customer: { id: 'c1', name: 'BLUEWATER' },
  pickupAddress: 'Kho HCM',
  pickupContact: '0909 111 222',
  deliveryAddress: 'KHO 3SC',
  deliveryContact: null,
  cargoInfo: '17CTN / 1.22CBM',
  pickupLocation: { latitude: 10.8, longitude: 106.6 },
  deliveryLocation: { latitude: 10.9, longitude: 106.7 },
  scheduledPickupAt: '2026-08-30T01:00:00.000Z',
  scheduledDeliveryAt: '2026-08-30T06:04:00.000Z',
  driverInstructions: null,
  assignment: { id: 'a1', assignedAt: AT },
  events: [],
  expenses: [],
  accountability: 'NOT_DECLARED',
  completion: null,
  ...over,
});

const completion = (state: string, over: Record<string, unknown> = {}) => ({
  id: 'r1',
  tripId: 't1',
  driverAssignmentId: 'a1',
  attemptNo: 1,
  expenseDeclaration: 'expenses',
  state,
  submittedBy: 'd1',
  submittedByUser: { id: 'd1', displayName: 'Tài Xế A' },
  submittedAt: AT,
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  ...over,
});

const renderAt = (path: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/driver" element={<DriverTripsPage />} />
            <Route path="/driver/trips/:tripId" element={<DriverTripPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

/** The stepper's steps, in order, with whether each is the current one. */
const stepper = () => {
  const list = screen.getByRole('list', { name: 'Tiến trình chuyến' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => ({ label: item.textContent ?? '', current: item.getAttribute('aria-current') === 'step' }));
};

const headerPill = () => screen.getByRole('heading', { level: 1 }).parentElement?.parentElement?.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyTrips.mockResolvedValue([]);
  fetchMyTrip.mockResolvedValue(trip());
});

describe('★ the trip list', () => {
  it('shows loading, then a card per trip with where from, where to and when', async () => {
    let release: (value: unknown[]) => void = () => {};
    fetchMyTrips.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderAt('/driver');

    expect(screen.getByText('Đang tải…')).toBeInTheDocument();
    release([trip(), trip({ tripId: 't2', customer: { id: 'c2', name: 'VIỄN ĐẠT' }, scheduledPickupAt: null, scheduledDeliveryAt: null })]);

    expect(await screen.findByText('BLUEWATER')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chuyến của tôi' })).toBeInTheDocument();
    expect(screen.getByText('2 chuyến')).toBeInTheDocument();
    const first = screen.getByText('BLUEWATER').closest('a');
    expect(first).toHaveAttribute('href', '/driver/trips/t1');
    expect(first).toHaveTextContent('Kho HCM');
    expect(first).toHaveTextContent('KHO 3SC');
    expect(first).toHaveTextContent('51D-65233');
    // A time window, not two full timestamps.
    expect(first?.textContent).toMatch(/\d{2}:\d{2} – \d{2}:\d{2}/);
    expect(screen.getByText('VIỄN ĐẠT').closest('a')).toHaveAttribute('href', '/driver/trips/t2');
  });

  it('says so when nothing is assigned', async () => {
    renderAt('/driver');

    expect(await screen.findByText('Bạn chưa được phân công chuyến nào')).toBeInTheDocument();
  });

  it('shows a driver-worded failure with a retry', async () => {
    fetchMyTrips.mockRejectedValueOnce(new ApiError(0, undefined, 'down')).mockResolvedValueOnce([trip()]);
    renderAt('/driver');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Thử lại' }).click();

    expect(await screen.findByText('BLUEWATER')).toBeInTheDocument();
  });
});

describe('★ the trip detail reads the workflow', () => {
  it('before pickup: pickup is the stage, the pickup card is live and offers the arrival', async () => {
    renderAt('/driver/trips/t1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([true, false, false, false]);
    expect(headerPill()).toContain('Lấy hàng');
    expect(screen.getByRole('button', { name: 'Tôi đã đến điểm lấy hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /giao hàng/i })).toBeNull();
    // Both ends are on screen from the start, with their own addresses.
    expect(screen.getByText('KHO 3SC')).toBeInTheDocument();
    expect(screen.getByText('Hoàn tất các bước vận chuyển ở trên trước')).toBeInTheDocument();
  });

  it('pickup confirmed: delivery becomes the stage and the pickup card reads done', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED')] }));
    renderAt('/driver/trips/t1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, true, false, false]);
    expect(headerPill()).toContain('Giao hàng');
    expect(screen.getByText('Đã xong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tôi đã đến điểm giao hàng' })).toBeInTheDocument();
  });

  it('delivery confirmed: the expense checkpoint is the stage and the journey is closed', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: JOURNEY }));
    renderAt('/driver/trips/t1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, true, false]);
    expect(headerPill()).toContain('Chi phí');
    expect(screen.getByText('Đã hoàn tất các bước vận chuyển')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tôi đã đến/i })).toBeNull();
    expect(screen.getByText('Chuyến này có phát sinh chi phí không?')).toBeInTheDocument();
    // The summary shows the SERVER's times and the figures — none yet.
    expect(screen.getByText('Lấy hàng lúc')).toBeInTheDocument();
    expect(screen.getByText('Giao hàng lúc')).toBeInTheDocument();
    expect(screen.getByText('Không có khoản chi')).toBeInTheDocument();
  });

  it('completion pending: the review is the stage, figures locked, summary totals the driver’s lines', async () => {
    fetchMyTrip.mockResolvedValue(
      trip({
        events: JOURNEY,
        expenses: [cost({ state: 'locked' }), cost({ id: 'c2', category: 'toll', amount: '130000.00', state: 'locked' })],
        accountability: 'DECLARED_WITH_EXPENSE',
        completion: completion('pending'),
      }),
    );
    renderAt('/driver/trips/t1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, false, true]);
    expect(headerPill()).toContain('Hoàn thành');
    expect(screen.getByText('Đã gửi — đang chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('Đã gửi')).toBeInTheDocument();
    expect(screen.getByText('Đang chờ duyệt — chưa sửa được')).toBeInTheDocument();
    expect(screen.getByText('2 khoản · 330,000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
  });

  it('★ rejected: the expense card says so with the reason, lines are editable, and resending is a separate tap', async () => {
    fetchMyTrip.mockResolvedValue(
      trip({
        events: JOURNEY,
        expenses: [cost()],
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completion: completion('rejected', { decisionReason: 'Thiếu hoá đơn dầu.', decidedBy: 'b1', decidedAt: AT }),
      }),
    );
    renderAt('/driver/trips/t1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, true, false]);
    expect(screen.getByText('Đã từ chối')).toBeInTheDocument();
    expect(screen.getByText('Bị từ chối — cần sửa')).toBeInTheDocument();
    expect(screen.getAllByText('Thiếu hoá đơn dầu.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chỉnh sửa và gửi lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại' })).toBeInTheDocument();
  });

  it('approved: every stage is done, the header says so, and nothing can be edited or reopened', async () => {
    fetchMyTrip.mockResolvedValue(
      trip({
        events: JOURNEY,
        expenses: [cost({ state: 'immutable' })],
        accountability: 'APPROVED_IMMUTABLE',
        completion: completion('approved', { decidedBy: 'b1', decidedAt: AT }),
      }),
    );
    renderAt('/driver/trips/t1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, false, false]);
    expect(screen.getByText('Chuyến đã hoàn tất')).toBeInTheDocument();
    expect(screen.getByText('Đã duyệt')).toBeInTheDocument();
    expect(screen.getByText('Đã duyệt — không sửa được')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
    expect(screen.queryByRole('button', { name: /thêm khoản chi/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /gửi/i })).toBeNull();
    expect(screen.queryByText(/mở lại|reopen/i)).toBeNull();
  });
});
