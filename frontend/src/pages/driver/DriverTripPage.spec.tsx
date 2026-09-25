import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { driverKeys } from '@/hooks/driver';
import { ApiError } from '@/utils/errors';
import DriverTripPage from './DriverTripPage';
import DriverTripsPage from './DriverTripsPage';

/**
 * The Driver Portal, as a driver uses it.
 *
 * ★ THESE ARE BEHAVIOUR CASES, NOT SNAPSHOTS. Every one asserts something a
 * driver would notice going wrong: an action offered out of order, a locked
 * figure that still looks editable, a rejection with no reason on screen, a
 * completed trip that appears to offer a way back.
 *
 * ★ AND THE API IS MOCKED AT THE MODULE, NOT THE TRANSPORT. What matters is
 * which call the screen makes and with what — particularly what it does NOT
 * send: no `tripId` in a body, no `recordedBy`, no `recordedAt`.
 */
const fetchMyAssignments = vi.fn();
const fetchMyAssignment = vi.fn();
const recordExecutionEvent = vi.fn();
const declareExpense = vi.fn();
const editExpense = vi.fn();
const submitCompletion = vi.fn();

vi.mock('@/api/driverPortal', () => ({
  fetchMyAssignments: (...a: unknown[]) => fetchMyAssignments(...a),
  fetchMyAssignment: (...a: unknown[]) => fetchMyAssignment(...a),
  recordExecutionEvent: (...a: unknown[]) => recordExecutionEvent(...a),
  declareExpense: (...a: unknown[]) => declareExpense(...a),
  editExpense: (...a: unknown[]) => editExpense(...a),
  submitCompletion: (...a: unknown[]) => submitCompletion(...a),
}));

// Only the receipt is observed; `setToastLanguage` and the rest stay real.
const notifySuccess = vi.fn();

vi.mock('@/utils/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/toast')>()),
  notifySuccess: (...a: unknown[]) => notifySuccess(...a),
}));

const EARLIER = '2026-08-30T02:00:00.000Z';

const event = (type: string, over: Record<string, unknown> = {}) => ({
  id: `e-${type}`,
  tripId: 't1',
  driverAssignmentId: 'a1',
  type,
  vehicleId: 'v1',
  vehicleOwnership: 'company',
  scheduledAt: EARLIER,
  actualAt: EARLIER,
  recordedAt: EARLIER,
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
  amount: '1500000.00',
  note: null,
  state: 'editable',
  source: 'driver_portal',
  driverAssignmentId: 'a1',
  vehicleId: 'v1',
  vehicleOwnership: 'company',
  lockedAt: null,
  lockedBy: null,
  createdBy: 'd1',
  createdAt: EARLIER,
  createdByUser: { id: 'd1', displayName: 'Tài Xế A' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const ALL_REPORTED = [
  event('ARRIVED_PICKUP'),
  event('PICKUP_CONFIRMED'),
  event('ARRIVED_DELIVERY'),
  event('DELIVERY_CONFIRMED'),
];

const trip = (over: Record<string, unknown> = {}) => ({
  tripId: 't1',
  scheduledOn: '2026-08-30',
  vehicle: { id: 'v1', plate: '51D-65233' },
  customer: { id: 'c1', name: 'VIỄN ĐẠT' },
  pickupAddress: 'BÃI XE MIỀN NAM',
  pickupContact: '0909 111 222',
  deliveryAddress: 'TCS',
  deliveryContact: null,
  cargoInfo: '17CTN / 1.22CBM',
  pickupLocation: { latitude: 10.8188, longitude: 106.6564 },
  deliveryLocation: null,
  scheduledPickupAt: EARLIER,
  scheduledDeliveryAt: '2026-08-30T09:00:00.000Z',
  driverInstructions: 'Gọi kho trước 30 phút.',
  assignment: { id: 'a1', assignedAt: EARLIER },
  events: [],
  expenses: [],
  accountability: 'NOT_DECLARED',
  completion: null,
  ...over,
});

const renderDetail = (path = '/driver/assignments/a1') => {
  const client = new QueryClient({
    // ★ `retryDelay: 0`: the detail query retries a non-refusal twice on its
    // own (see `useMyAssignment`); the backoff between attempts is not what
    // any case here is about, and seconds of it would be.
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });

  // The client too: a case that refreshes the trip does it through the cache,
  // the way the app does, rather than by remounting the page.
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/driver" element={<DriverTripsPage />} />
              <Route path="/driver/assignments/:assignmentId" element={<DriverTripPage />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </QueryClientProvider>,
    ),
  };
};

const renderList = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/driver']}>
          <Routes>
            <Route path="/driver" element={<DriverTripsPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyAssignments.mockResolvedValue([]);
  fetchMyAssignment.mockResolvedValue(trip());
  recordExecutionEvent.mockResolvedValue(event('ARRIVED_PICKUP'));
  declareExpense.mockResolvedValue(cost());
  editExpense.mockResolvedValue(cost({ amount: '1550000.00' }));
  submitCompletion.mockResolvedValue({ id: 'r1', attemptNo: 1, state: 'pending' });
});

describe('★ a driver sees only their own trips', () => {
  // The fixture is on 2026-08-30: pin the business day to it so the card lands
  // on "Hôm nay", the tab the schedule opens on.
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-08-30T03:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for the list with no parameter at all', async () => {
    // The scope IS the session. A parameter here would be something a client
    // could change.
    fetchMyAssignments.mockResolvedValue([trip()]);
    renderList();

    await screen.findByRole('link', { name: /xem chuyến/i });
    expect(fetchMyAssignments).toHaveBeenCalledWith();
    expect(fetchMyAssignments.mock.calls[0]).toHaveLength(0);
  });

  it('says so plainly when nothing is assigned', async () => {
    renderList();

    expect(await screen.findByText('Bạn chưa có chuyến nào hôm nay.')).toBeInTheDocument();
  });

  it('★ shows a refusal as "not yours" and nothing more', async () => {
    // Never whether the trip exists, never whose it is.
    fetchMyAssignment.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.'));
    renderDetail();

    expect(await screen.findByText(/không thuộc về bạn/i)).toBeInTheDocument();
    expect(screen.queryByText('VIỄN ĐẠT')).not.toBeInTheDocument();
  });
});

describe('the trip detail', () => {
  it('shows the facts the driver needs', async () => {
    renderDetail();

    expect(await screen.findByText('51D-65233')).toBeInTheDocument();
    expect(screen.getByText('BÃI XE MIỀN NAM')).toBeInTheDocument();
    expect(screen.getByText('TCS')).toBeInTheDocument();
    expect(screen.getByText('0909 111 222')).toBeInTheDocument();
    expect(screen.getByText('17CTN / 1.22CBM')).toBeInTheDocument();
    expect(screen.getByText('Gọi kho trước 30 phút.')).toBeInTheDocument();
  });

  it('★ shows no money of the company anywhere on the screen', async () => {
    // The server sends none; this asserts the screen invents none either — no
    // total, no hire price, no margin.
    fetchMyAssignment.mockResolvedValue(trip({ expenses: [cost()] }));
    const { container } = renderDetail();

    await screen.findByText('51D-65233');

    expect(container.textContent).not.toMatch(/tổng|total|margin|lợi nhuận/i);
  });
});

/**
 * ★ THE DETAIL, TOP TO BOTTOM, AS THE DRIVER READS IT: where this turn stands,
 * when and in which lorry, the two ends, then what else to know. A fact the
 * office has not set says "Chưa có" in words — never a blank, never a `null`.
 */
describe('★ the assignment detail, read first', () => {
  /** A label and its value: `FactRow` puts the two in one block. */
  const fact = (label: HTMLElement) => label.parentElement as HTMLElement;

  const request = (state: string, decisionReason: string | null = null) => ({
    id: 'r1',
    attemptNo: 1,
    state,
    expenseDeclaration: 'none',
    submittedAt: EARLIER,
    decisionReason,
  });

  // ★ The card links with `encodeURIComponent`; the route must hand the API the
  // id it started as, or an unusual id opens somebody's 404.
  it.each(['a1', 'lô 7/2'])('asks for exactly the assignment the route names: %s', async (id) => {
    renderDetail(`/driver/assignments/${encodeURIComponent(id)}`);

    await screen.findByText('51D-65233');
    expect(fetchMyAssignment).toHaveBeenCalledTimes(1);
    expect(fetchMyAssignment).toHaveBeenCalledWith(id);
  });

  it('says it is loading while the assignment is on its way', () => {
    fetchMyAssignment.mockReturnValue(new Promise(() => undefined));
    renderDetail();

    expect(screen.getByRole('status')).toHaveTextContent('Đang tải…');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('heads the screen with the trip’s own day and a way back to the schedule', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: 'Chi tiết chuyến' })).toBeInTheDocument();
    // `scheduledOn`, the business day — not the day the phone thinks it is.
    expect(screen.getByText('Chủ Nhật, 30/08/2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quay lại' })).toHaveAttribute('href', '/driver');
  });

  it('★ goes back to the schedule when opened directly rather than from a card', async () => {
    // A shared link or a notification has no schedule behind it in history;
    // "back" must still land somewhere the driver can use.
    renderDetail('/driver/assignments/a1');

    fireEvent.click(await screen.findByRole('link', { name: 'Quay lại' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Lịch làm việc' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Chi tiết chuyến' })).not.toBeInTheDocument();
  });

  it('leads with where the turn stands, when to load, and in which lorry', async () => {
    renderDetail();

    expect(await screen.findByText('Đã phân công')).toBeInTheDocument();
    // An instant on the viewer's clock (TZ=UTC under test), then its date.
    expect(fact(screen.getByText('Dự kiến lấy hàng'))).toHaveTextContent('02:00 · 30/8/2026');
    expect(fact(screen.getByText('Xe'))).toHaveTextContent('51D-65233');
    const stages = within(screen.getByRole('list', { name: 'Tiến trình chuyến' })).getAllByRole('listitem');
    expect(stages[0]).toHaveAttribute('aria-current', 'step');
  });

  it('gives each end its own address and contact', async () => {
    renderDetail();

    await screen.findByText('51D-65233');
    // Pickup first, delivery second: the order they are driven.
    const [pickupAddress, deliveryAddress] = screen.getAllByText('Địa chỉ').map(fact);
    const [pickupContact, deliveryContact] = screen.getAllByText('Liên hệ').map(fact);
    expect(pickupAddress).toHaveTextContent('BÃI XE MIỀN NAM');
    expect(pickupContact).toHaveTextContent('0909 111 222');
    expect(deliveryAddress).toHaveTextContent('TCS');
    expect(deliveryContact).toHaveTextContent('Chưa có');
  });

  it('says whose goods, what goods, and what the office wrote for the driver', async () => {
    renderDetail();

    expect(await screen.findByText('Thông tin chuyến')).toBeInTheDocument();
    expect(fact(screen.getByText('Khách hàng'))).toHaveTextContent('VIỄN ĐẠT');
    expect(fact(screen.getByText('Hàng hoá'))).toHaveTextContent('17CTN / 1.22CBM');
    expect(fact(screen.getByText('Chỉ dẫn cho tài xế'))).toHaveTextContent('Gọi kho trước 30 phút.');
  });

  it('★ reads every unset fact as "Chưa có" and leaks no null', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        scheduledPickupAt: null,
        scheduledDeliveryAt: null,
        vehicle: null,
        customer: null,
        cargoInfo: null,
        driverInstructions: null,
        pickupContact: null,
        deliveryContact: null,
      }),
    );
    renderDetail();

    await screen.findByText('Thông tin chuyến');
    for (const label of ['Dự kiến lấy hàng', 'Xe', 'Khách hàng', 'Hàng hoá']) {
      expect(fact(screen.getByText(label))).toHaveTextContent('Chưa có');
    }
    for (const contact of screen.getAllByText('Liên hệ').map(fact)) {
      expect(contact).toHaveTextContent('Chưa có');
    }
    // No note from the office: no empty box headed as if there were one.
    expect(screen.queryByText('Chỉ dẫn cho tài xế')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined|null|NaN/);
  });

  it('★ rides out a dropped connection, then offers a retry that works', async () => {
    const offline = new ApiError(0, undefined, 'Network error');
    fetchMyAssignment
      .mockRejectedValueOnce(offline)
      .mockRejectedValueOnce(offline)
      .mockRejectedValueOnce(offline);
    renderDetail();

    expect(await screen.findByRole('alert')).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    // Tried twice more before saying so: one lost packet is not an error screen.
    expect(fetchMyAssignment).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('51D-65233')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    { status: 403, code: 'FORBIDDEN', message: 'Chuyến này không thuộc về bạn.' },
    { status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy chuyến này.' },
  ])('★ a $status is final: no retry, only the way back', async ({ status, code, message }) => {
    fetchMyAssignment.mockRejectedValue(new ApiError(status, code, 'Refused.'));
    renderDetail();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('heading', { level: 1, name: 'Chi tiết chuyến' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về lịch làm việc' })).toHaveAttribute('href', '/driver');
    // ★ Asked once: the same question again only reads as probing in the server's log.
    expect(fetchMyAssignment).toHaveBeenCalledTimes(1);
  });

  it.each([
    { reads: 'Đang ở điểm lấy hàng', over: { events: [event('ARRIVED_PICKUP')] } },
    {
      reads: 'Đang ở điểm giao hàng',
      over: { events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED'), event('ARRIVED_DELIVERY')] },
    },
    // ★ The request outranks the journey: sent from a gate with no signal, two
    // steps short, the review is still what the driver is waiting on.
    {
      reads: 'Chờ duyệt',
      over: { events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED')], completion: request('pending') },
    },
    {
      reads: 'Bị trả lại',
      over: {
        events: ALL_REPORTED,
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completion: request('rejected', 'Số tiền dầu sai.'),
      },
    },
  ])('leads with "$reads" when the turn is there', async ({ reads, over }) => {
    fetchMyAssignment.mockResolvedValue(trip(over));
    renderDetail();

    expect(await screen.findByText(reads)).toBeInTheDocument();
  });
});

/**
 * ★ A REFRESH THAT FAILS DOES NOT TAKE THE TRIP AWAY — unless the server's
 * answer is final. A weak signal on the road is a sentence above the page; a
 * 403 or 404 is the page.
 */
describe('★ the detail when a read fails', () => {
  const refreshFailsWith = async (client: QueryClient, error: ApiError) => {
    fetchMyAssignment.mockRejectedValue(error);
    await act(() => client.refetchQueries({ queryKey: driverKeys.assignment('a1') }));
  };

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('★ keeps the trip on screen when a refresh fails, and offers a retry that works', async () => {
    const { client } = renderDetail();
    await screen.findByText('Đã phân công');

    await refreshFailsWith(client, new ApiError(0, undefined, 'down'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    // Everything the driver was reading is still there.
    expect(screen.getByText('Đã phân công')).toBeInTheDocument();
    expect(screen.getByText('Dự kiến lấy hàng')).toBeInTheDocument();
    expect(screen.getByText('BÃI XE MIỀN NAM')).toBeInTheDocument();
    expect(screen.getByText('Chi phí tôi đã khai')).toBeInTheDocument();
    // The refresh rode out the drop like the first read did: tried twice more.
    expect(fetchMyAssignment).toHaveBeenCalledTimes(4);

    fetchMyAssignment.mockResolvedValue(trip());
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText('BÃI XE MIỀN NAM')).toBeInTheDocument();
  });

  it.each([
    { status: 403, code: 'FORBIDDEN', message: 'Chuyến này không thuộc về bạn.' },
    { status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy chuyến này.' },
  ])('★ a $status on refresh takes the trip away: the answer is final', async ({ status, code, message }) => {
    const { client } = renderDetail();
    await screen.findByText('Đã phân công');

    await refreshFailsWith(client, new ApiError(status, code, 'x'));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Đã phân công')).not.toBeInTheDocument();
    expect(screen.queryByText('BÃI XE MIỀN NAM')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    // Not retried: once for the first read, once for the refresh.
    expect(fetchMyAssignment).toHaveBeenCalledTimes(2);
  });

  it('★ a server fault on the read — what a malformed id can draw — is worded plainly, with a retry and a way out', async () => {
    // The portal never builds an id itself: it only follows links the list
    // gave it. A hand-typed or truncated URL can still reach the server, which
    // may answer 5xx; the screen must not crash or show the server's words.
    fetchMyAssignment.mockRejectedValue(new ApiError(500, 'INTERNAL', 'invalid input syntax for type uuid'));
    renderDetail('/driver/assignments/not-a-uuid');

    expect(await screen.findByRole('alert')).toHaveTextContent('Có lỗi xảy ra. Thử lại, nếu vẫn lỗi hãy báo văn phòng.');
    expect(fetchMyAssignment).toHaveBeenCalledWith('not-a-uuid');
    expect(document.body).not.toHaveTextContent(/invalid input|uuid|500|INTERNAL/i);
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về lịch làm việc' })).toHaveAttribute('href', '/driver');
  });

  it('★ offline on first open says "no connection" and offers a retry', async () => {
    // TanStack would otherwise PARK the read while the browser says offline —
    // no data, no error, not loading — which this page words as "something
    // went wrong".
    onlineManager.setOnline(false);
    fetchMyAssignment.mockRejectedValue(new ApiError(0, undefined, 'Network error'));
    renderDetail();

    expect(await screen.findByRole('alert')).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    expect(screen.queryByText(/có lỗi xảy ra/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    // Asked, not parked — the first ask and its two retries, then it stops.
    expect(fetchMyAssignment).toHaveBeenCalledTimes(3);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(fetchMyAssignment).toHaveBeenCalledTimes(3);
  });
});

describe('★ execution progresses one step at a time', () => {
  it('offers only the first step on a trip with nothing reported', async () => {
    renderDetail();

    expect(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /đã lấy hàng xong/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /đã giao hàng xong/i })).not.toBeInTheDocument();
  });

  it('offers the next step once the first is reported', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP')] }));
    renderDetail();

    expect(await screen.findByRole('button', { name: /đã lấy hàng xong/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /đã đến điểm lấy hàng/i })).not.toBeInTheDocument();
  });

  it('offers nothing once all four are reported', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    expect(await screen.findByText(/đã hoàn tất các bước vận chuyển/i)).toBeInTheDocument();
  });

  it('★ sends the type, an instant and an idempotency id — and nothing else', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i }));

    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalled());

    const [assignmentId, body] = recordExecutionEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(assignmentId).toBe('a1');
    expect(body.type).toBe('ARRIVED_PICKUP');
    expect(body.clientEventId).toBeTruthy();
    // ★ The server owns identity and its own clock.
    expect(body).not.toHaveProperty('recordedBy');
    expect(body).not.toHaveProperty('recordedAt');
    expect(body).not.toHaveProperty('tripId');
    // ★ AND `actualAt` MOST OF ALL. It is what every delay is measured from;
    // a handset whose clock is an hour out would write an hour of lateness
    // nobody caused. The server stamps it when the tap arrives.
    expect(body).not.toHaveProperty('actualAt');
  });

  it('★ a retried arrival carries the same clientEventId as the attempt that failed', async () => {
    // One id per INTENT: the retry must collide with its own first attempt on
    // the server, so one bar of signal never records the arrival twice.
    recordExecutionEvent.mockRejectedValueOnce(new ApiError(0, undefined, 'Network error'));
    renderDetail();
    const arrival = await screen.findByRole('button', { name: 'Tôi đã đến điểm lấy hàng' });

    fireEvent.click(arrival);
    expect(await screen.findByRole('alert')).toHaveTextContent(/không có kết nối/i);
    await waitFor(() => expect(arrival).toBeEnabled());
    fireEvent.click(arrival);

    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalledTimes(2));
    const [[firstId, first], [secondId, second]] = recordExecutionEvent.mock.calls as [string, { clientEventId: string }][];
    expect([firstId, secondId]).toEqual(['a1', 'a1']);
    expect(first.clientEventId).toBe('a1:ARRIVED_PICKUP');
    expect(second.clientEventId).toBe(first.clientEventId);
  });

  it('★ a wrong device clock changes nothing the business reads', async () => {
    // The phone is five years behind. The only field that carries it is the
    // DIAGNOSTIC one, and the server ignores it for every computation.
    const wrong = new Date('2021-01-01T00:00:00.000Z');
    vi.setSystemTime(wrong);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i }));
    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalled());

    const [, body] = recordExecutionEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('actualAt');
    expect(body['deviceReportedAt']).toBe(wrong.toISOString());
    vi.useRealTimers();
  });

  it('★ the overdue marker is presentation only — it sends nothing', async () => {
    // Moving the client clock changes what the screen SAYS and never what it
    // stores: no request is made by rendering.
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    renderDetail();

    expect((await screen.findAllByText(/đã quá giờ dự kiến/i)).length).toBeGreaterThan(0);
    expect(recordExecutionEvent).not.toHaveBeenCalled();
    expect(declareExpense).not.toHaveBeenCalled();
    expect(submitCompletion).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('★ renders the times the SERVER recorded, not the browser’s clock', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP')] }));
    vi.setSystemTime(new Date('2030-06-06T06:06:00.000Z'));
    renderDetail();

    // The event's own `actualAt`, unchanged by the browser being in 2030.
    await screen.findByText(/thực tế:/i);
    expect(screen.getByText(/thực tế:.*2026/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('★ marks a step whose planned time has passed', async () => {
    // A fact from the clock, not a threshold: the pickup was due and has not
    // been reported.
    renderDetail();

    // Every unreported step whose time has passed is marked, so there is one
    // per outstanding step rather than exactly one on the page.
    expect((await screen.findAllByText(/đã quá giờ dự kiến/i)).length).toBeGreaterThan(0);
  });

  it('shows the plan and the fact on separate lines', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP')] }));
    renderDetail();

    expect((await screen.findAllByText(/dự kiến:/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/thực tế:/i).length).toBeGreaterThan(0);
  });
});

describe('expenses', () => {
  it('declares one without sending an author', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    await waitFor(() => expect(declareExpense).toHaveBeenCalled());

    const [assignmentId, body] = declareExpense.mock.calls[0] as [string, Record<string, unknown>];
    expect(assignmentId).toBe('a1');
    expect(body.amount).toBe('1500000');
    expect(body).not.toHaveProperty('declaredBy');
    expect(body).not.toHaveProperty('tripId');
  });

  it('★ does not offer fuel or tolls on a hired lorry', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({ events: [event('ARRIVED_PICKUP', { vehicleOwnership: 'outsourced' })] }),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.queryByRole('button', { name: /^dầu$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cầu trạm/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /phí kho/i })).toBeInTheDocument();
  });

  it('corrects an editable figure', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1550000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    // ★ ALL THREE FIELDS. The form used to offer only the amount, so a driver
    // who picked the wrong heading had to ask the office to withdraw the line.
    await waitFor(() =>
      expect(editExpense).toHaveBeenCalledWith('a1', 'c1', {
        category: 'fuel',
        amount: '1550000',
        note: null,
      }),
    );
  });

  /**
   * ★ THE CORRECTION FORM CLOSES ON A YES, AND ONLY ON A YES.
   *
   * It used to fire the request and close in the same breath. A 409 or a dead
   * network then left the driver looking at the OLD figure with an error above
   * it and their retyped one gone — and a correction keeps NO draft, by design,
   * so there was nothing anywhere to restore it from. The declare path already
   * waited; this one did not.
   */
  it('★ closes the correction form once the server accepts', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ expenses: [cost()] }));
    editExpense.mockResolvedValue(cost({ amount: '1550000.00' }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1550000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    await waitFor(() => expect(editExpense).toHaveBeenCalled());
    // Back to the row, so the form is gone.
    await waitFor(() => expect(screen.queryByLabelText(/số tiền/i)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  });

  it('★ keeps the correction form open and filled when the server refuses it', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ expenses: [cost()] }));
    editExpense.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Cost is locked.'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1550000' } });
    fireEvent.change(screen.getByLabelText(/ghi chú/i), { target: { value: 'Đổ thêm ở Dầu Giây' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // The form is still there, and so is every keystroke.
    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('1,550,000');
    expect(screen.getByLabelText(/ghi chú/i)).toHaveValue('Đổ thêm ở Dầu Giây');
    expect(screen.getByRole('button', { name: /^lưu$/i })).toBeInTheDocument();
  });

  it('★ keeps the correction form open and filled when the connection dies', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ expenses: [cost()] }));
    editExpense.mockRejectedValue(new ApiError(0, undefined, 'Network error'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1550000' } });
    // The heading the driver corrected must survive too, not just the figure.
    fireEvent.click(screen.getByRole('button', { name: /phí kho/i }));
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không có kết nối/i);

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('1,550,000');
    expect(screen.getByRole('button', { name: /phí kho/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('★ offers no correction on a locked figure', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ expenses: [cost({ state: 'locked' })] }));
    renderDetail();

    // Twice now: once on the line, once in the total the driver reviews.
    expect((await screen.findAllByText('1,500,000')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument();
  });

  it('★ offers no correction once approved, and says why', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        expenses: [cost({ state: 'immutable' })],
        accountability: 'APPROVED_IMMUTABLE',
        completion: { id: 'r1', attemptNo: 1, state: 'approved', decisionReason: null },
      }),
    );
    renderDetail();

    expect((await screen.findAllByText(/đã duyệt — không sửa được/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /thêm khoản chi/i })).not.toBeInTheDocument();
  });

  it('★ refuses to offer expenses before a lorry is assigned', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ vehicle: null }));
    renderDetail();

    expect(await screen.findByText(/chưa có xe/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /thêm khoản chi/i })).not.toBeInTheDocument();
  });
});

describe('★ completion', () => {
  it('is not offered while journey steps remain', async () => {
    renderDetail();

    expect(await screen.findByText(/hoàn tất các bước vận chuyển ở trên trước/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gửi hoàn tất chuyến/i })).not.toBeInTheDocument();
  });

  it('★ asks the declaration question rather than assuming an answer', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    expect(await screen.findByText(/có phát sinh chi phí không/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /không phát sinh chi phí/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^có phát sinh chi phí$/i })).toBeInTheDocument();
  });

  it('sends the declaration the driver chose', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /có phát sinh chi phí/i }));
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('a1', 'expenses'));
  });

  it('sends "none" when the driver says there was nothing', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('a1', 'none'));
  });

  it('shows the waiting state after sending', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        completion: {
          id: 'r1',
          attemptNo: 1,
          state: 'pending',
          expenseDeclaration: 'expenses',
          submittedAt: EARLIER,
          decisionReason: null,
        },
      }),
    );
    renderDetail();

    expect(await screen.findByText('Đã gửi — đang chờ duyệt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gửi hoàn tất chuyến/i })).not.toBeInTheDocument();
  });

  it('★ shows the rejection reason and offers a resubmission', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        expenses: [cost()],
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completion: {
          id: 'r1',
          attemptNo: 1,
          state: 'rejected',
          expenseDeclaration: 'expenses',
          submittedAt: EARLIER,
          decisionReason: 'Số tiền dầu sai.',
        },
      }),
    );
    renderDetail();

    expect(await screen.findByText(/yêu cầu bị từ chối/i)).toBeInTheDocument();
    // The one thing the driver has to act on.
    // ★ ONCE AT THE FIGURES, ONCE AT THE REQUEST: the driver reads why on the
    // panel they have to correct and on the one they have to resend.
    expect(screen.getAllByText('Số tiền dầu sai.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /chỉnh sửa và gửi lại/i })).toBeInTheDocument();
  });

  it('★ reopens the figures for correction after a rejection', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        expenses: [cost({ state: 'editable' })],
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completion: {
          id: 'r1',
          attemptNo: 1,
          state: 'rejected',
          expenseDeclaration: 'expenses',
          submittedAt: EARLIER,
          decisionReason: 'Số tiền dầu sai.',
        },
      }),
    );
    renderDetail();

    // `Sửa` exactly — `Chỉnh sửa và gửi lại` also contains it.
    expect(await screen.findByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  });

  it('resubmits through the same call, and the server numbers the attempt', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        expenses: [cost()],
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completion: {
          id: 'r1',
          attemptNo: 1,
          state: 'rejected',
          expenseDeclaration: 'expenses',
          submittedAt: EARLIER,
          decisionReason: 'Số tiền dầu sai.',
        },
      }),
    );
    renderDetail();

    // ★ THE BUTTON NO LONGER SUBMITS. Resubmitting without changing anything is
    // the one thing a rejected driver should not do, so it takes them to the
    // figures and the send is a separate, deliberate tap.
    fireEvent.click(await screen.findByRole('button', { name: /chỉnh sửa và gửi lại/i }));
    expect(submitCompletion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^gửi lại$/i }));
    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('a1', 'expenses'));
  });

  it('★ shows a completed trip as closed, with NO way to reopen it', async () => {
    // Approval is terminal — a trigger makes it irreversible — so a control
    // that appeared to undo it would be a lie.
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        accountability: 'APPROVED_IMMUTABLE',
        completion: { id: 'r1', attemptNo: 2, state: 'approved', decisionReason: null },
      }),
    );
    renderDetail();

    expect(await screen.findByText(/lượt xe của bạn đã được duyệt/i)).toBeInTheDocument();
    // ★ NEVER "the trip is done": another lorry on the same trip may still be running.
    expect(screen.queryByText(/chuyến đã hoàn tất|trip completed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gửi hoàn tất/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mở lại|reopen/i })).not.toBeInTheDocument();
  });
});

describe('★ failures a driver can act on', () => {
  it('turns a 409 into one sentence, and re-reads the trip', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED }));
    submitCompletion.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Already submitted.'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /gửi hoàn tất chuyến/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/chuyến vừa thay đổi/i);
    // A stale screen is the reason for the conflict, so it refetches.
    await waitFor(() => expect(fetchMyAssignment.mock.calls.length).toBeGreaterThan(1));
  });

  it('★ a write answered 404 re-reads, and the final 404 takes the page away', async () => {
    const gone = new ApiError(404, 'NOT_FOUND', 'x');
    fetchMyAssignment.mockResolvedValueOnce(trip()).mockRejectedValue(gone);
    recordExecutionEvent.mockRejectedValue(gone);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Tôi đã đến điểm lấy hàng' }));

    expect(await screen.findByRole('link', { name: 'Về lịch làm việc' })).toHaveAttribute('href', '/driver');
    expect(screen.getByRole('alert')).toHaveTextContent('Không tìm thấy chuyến này.');
    expect(screen.queryByText('Đã phân công')).not.toBeInTheDocument();
    expect(screen.queryByText('BÃI XE MIỀN NAM')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tôi đã đến điểm lấy hàng' })).not.toBeInTheDocument();
  });

  it('re-reads the trip when a declared expense is refused with a 409', async () => {
    declareExpense.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Cost is locked.'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/chuyến vừa thay đổi/i);
    await waitFor(() => expect(fetchMyAssignment.mock.calls.length).toBeGreaterThan(1));
  });

  it('explains a lost connection without a status code', async () => {
    recordExecutionEvent.mockRejectedValue(new ApiError(0, undefined, 'Network error'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không có kết nối/i);
  });

  it('explains an expired session', async () => {
    recordExecutionEvent.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Authentication required.'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/hết hạn/i);
  });

  it('explains a rejected amount as a field problem, not a server fault', async () => {
    declareExpense.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'Bad amount'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '10.005' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/chưa hợp lệ/i);
  });

  it('★ never shows a raw status code or an English server message', async () => {
    recordExecutionEvent.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'That trip already has a completion request waiting.'),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/409|CONFLICT|completion request waiting/);
  });
});

describe('★ the completion checkpoint cannot be walked past', () => {
  it('★ "there were expenses" with nothing declared OPENS THE FORM', async () => {
    // The bug this replaces: the choice set a variable, the screen did not
    // change, and the driver's eventual tap came back as a 409.
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /có phát sinh chi phí/i }));

    expect(screen.getByLabelText(/số tiền/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^dầu$/i })).toBeInTheDocument();
  });

  it('★ opens the form again when chosen again after the driver cancelled it', async () => {
    // The checkpoint's "open" is a one-shot signal the form hands back on
    // closing; a second choice must be able to send it again.
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Có phát sinh chi phí' }));
    expect(screen.getByLabelText('Số tiền')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByLabelText('Số tiền')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Có phát sinh chi phí' }));
    expect(screen.getByLabelText('Số tiền')).toBeInTheDocument();
  });

  it('does not reopen the form when figures already stand', async () => {
    // There is nothing to add — the driver is confirming what is on screen.
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /có phát sinh chi phí/i }));

    expect(screen.queryByLabelText(/số tiền/i)).not.toBeInTheDocument();
  });

  it('★ "no expenses" with figures on the trip asks before sending', async () => {
    // The server refuses this pairing. Asking turns a guaranteed rejection into
    // a question the driver can answer.
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));

    expect(screen.getByText(/bạn chắc chắn là không phát sinh/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i })).toBeDisabled();
    expect(submitCompletion).not.toHaveBeenCalled();
  });

  it('lets the driver keep "no expenses" after being asked', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));
    fireEvent.click(screen.getByRole('button', { name: /vẫn chọn không phát sinh/i }));
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('a1', 'none'));
  });

  it('sends "no expenses" without asking when the trip really has none', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));

    expect(screen.queryByText(/bạn chắc chắn là không phát sinh/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('a1', 'none'));
  });
});

describe('★ the draft survives, and the request is idempotent', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('★ sends a clientRequestId, so a retry cannot double the fuel bill', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    await waitFor(() => expect(declareExpense).toHaveBeenCalled());

    const [, body] = declareExpense.mock.calls[0] as [string, Record<string, unknown>];
    expect(typeof body['clientRequestId']).toBe('string');
    expect((body['clientRequestId'] as string).length).toBeGreaterThan(0);
  });

  it('keeps one id across re-renders, so the id is per INTENT not per tap', async () => {
    declareExpense.mockRejectedValueOnce(new ApiError(0, undefined, 'Network error'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });

    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    await waitFor(() => expect(declareExpense).toHaveBeenCalledTimes(2));

    const calls = declareExpense.mock.calls as [string, Record<string, unknown>][];
    // ★ The retry reuses the first attempt's id — which is what makes the
    // server answer with the original row instead of writing a second one.
    expect(calls[0]![1]['clientRequestId']).toBe(calls[1]![1]['clientRequestId']);
  });

  it('★ a typed figure survives a reload', async () => {
    const { unmount } = renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });
    fireEvent.change(screen.getByLabelText(/ghi chú/i), { target: { value: 'Đổ ở Long An' } });

    unmount();
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    // Grouped on screen, plain underneath: `MoneyInput` puts the commas in for
    // reading and keeps `1500000` in state, so what was persisted is still the
    // string the server takes.
    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('1,500,000');
    expect(screen.getByLabelText(/ghi chú/i)).toHaveValue('Đổ ở Long An');
  });

  it('★ keeps the draft when the server refuses', async () => {
    // A network error is exactly when the driver retries, and throwing the
    // figure away then is the one moment it must not happen.
    declareExpense.mockRejectedValue(new ApiError(0, undefined, 'Network error'));
    const { unmount } = renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));
    await screen.findByRole('alert');

    unmount();
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('1,500,000');
  });

  it('forgets the draft once the server has accepted', async () => {
    const { unmount } = renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));
    await waitFor(() => expect(declareExpense).toHaveBeenCalled());

    unmount();
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('');
  });

  it('★ never leaks a draft between two trips', async () => {
    sessionStorage.setItem(
      'driver-expense-draft:another-trip',
      JSON.stringify({ category: 'fuel', amount: '9999', note: 'x', clientRequestId: 'r' }),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('');
  });

  it('★ keys the draft by the assignment — a draft under the TRIP’s id is not picked up', async () => {
    // Two lorries of one trip share `t1`; a trip-keyed draft would put one
    // lorry's half-typed fuel on the other's form (ADR-0004).
    sessionStorage.setItem(
      'driver-expense-draft:t1',
      JSON.stringify({ category: 'fuel', amount: '4242000', note: 'lorry B', clientRequestId: 'r-t1' }),
    );
    renderDetail('/driver/assignments/a1');

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('');
    expect(screen.getByLabelText(/ghi chú/i)).toHaveValue('');
  });

  it('survives malformed storage without breaking the screen', async () => {
    // Under the key the page actually reads (the assignment's), or the parse
    // this case is about never runs.
    sessionStorage.setItem('driver-expense-draft:a1', '{not json');
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('');
  });
});

describe('★ a rejection leads the driver to the figures', () => {
  const scrollIntoView = vi.fn();
  // jsdom has none of its own — see `goToExpenses` — so this puts back "none".
  const original = Element.prototype.scrollIntoView;

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it('★ "Chỉnh sửa và gửi lại" scrolls the expense panel into view — and sends nothing', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        expenses: [cost()],
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completion: {
          id: 'r1',
          attemptNo: 1,
          state: 'rejected',
          expenseDeclaration: 'expenses',
          submittedAt: EARLIER,
          decisionReason: 'Số tiền dầu sai.',
        },
      }),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa và gửi lại' }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const scrolled = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(scrolled).toHaveAttribute('id', 'driver-expenses');
    expect(scrolled).toHaveTextContent('Chi phí tôi đã khai');
    expect(submitCompletion).not.toHaveBeenCalled();
  });
});

/**
 * ★ THE FOUR WRITES, each made the way a driver makes it. One table because
 * they share one shape in `useDriverActions`: the button that sent it is busy
 * while it travels, and a yes raises a receipt and re-reads the whole turn.
 */
const WRITES = [
  {
    write: 'an arrival',
    api: recordExecutionEvent,
    fixture: {},
    button: 'Tôi đã đến điểm lấy hàng',
    toast: 'toastEventReported',
  },
  {
    write: 'a declared expense',
    api: declareExpense,
    fixture: {},
    prepare: async () => {
      fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
      fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1500000' } });
    },
    button: 'Lưu',
    toast: 'toastExpenseDeclared',
  },
  {
    write: 'a corrected expense',
    api: editExpense,
    fixture: { expenses: [cost()] },
    prepare: async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
      fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1550000' } });
    },
    button: 'Lưu',
    toast: 'toastExpenseCorrected',
  },
  {
    write: 'a submitted completion',
    api: submitCompletion,
    fixture: { events: ALL_REPORTED },
    button: 'Gửi hoàn tất chuyến',
    toast: 'toastCompletionSubmitted',
  },
];

/** Makes the write and hands back the button that sent it. */
const send = async ({ prepare, button }: (typeof WRITES)[number]) => {
  await prepare?.();
  const sender = await screen.findByRole('button', { name: button });
  fireEvent.click(sender);
  return sender;
};

describe('★ every write: busy while it travels, then a receipt and a re-read of the whole turn', () => {
  it.each(WRITES)('$write: the button it was sent from is disabled until the server answers', async (write) => {
    write.api.mockReturnValue(new Promise(() => undefined));
    fetchMyAssignment.mockResolvedValue(trip(write.fixture));
    renderDetail();

    const sender = await send(write);

    await waitFor(() => expect(sender).toBeDisabled());
    // A second tap on a slow connection sends nothing.
    fireEvent.click(sender);
    expect(write.api).toHaveBeenCalledTimes(1);
  });

  it.each(WRITES)('$write: once accepted, invalidates this assignment and the schedule', async (write) => {
    fetchMyAssignment.mockResolvedValue(trip(write.fixture));
    const { client } = renderDetail();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await send(write);

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: driverKeys.assignment('a1') }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: driverKeys.assignments() });
  });

  it.each(WRITES)('$write: once accepted, says so with $toast', async (write) => {
    fetchMyAssignment.mockResolvedValue(trip(write.fixture));
    renderDetail();

    await send(write);

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith(write.toast));
    expect(notifySuccess).toHaveBeenCalledTimes(1);
  });
});

describe('the expense panel tells the driver where they stand', () => {
  it('says nothing has been declared yet', async () => {
    renderDetail();

    expect(await screen.findByText(/chưa khai khoản chi nào/i)).toBeInTheDocument();
  });

  it('★ counts the lines and totals them EXACTLY', async () => {
    // Summed as integer minor units, never through a float.
    fetchMyAssignment.mockResolvedValue(
      trip({
        expenses: [
          cost({ id: 'c1', amount: '1500000.10' }),
          cost({ id: 'c2', category: 'loading', amount: '200000.20' }),
        ],
      }),
    );
    renderDetail();

    expect(await screen.findByText(/2 khoản/i)).toBeInTheDocument();
    // ★ 0.10 + 0.20 = 0.30 — the classic float trap, exact here because the
    // sum runs through integer minor units rather than `parseFloat`.
    expect(screen.getByText('1,700,000.30')).toBeInTheDocument();
  });

  it('shows a hint that belongs to the chosen heading', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.click(screen.getByRole('button', { name: /phí kho/i }));

    expect(screen.getByPlaceholderText(/kho nào/i)).toBeInTheDocument();
  });

  it('lets the driver correct the heading, not just the amount', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: /bốc xếp/i }));
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    await waitFor(() =>
      expect(editExpense).toHaveBeenCalledWith(
        'a1',
        'c1',
        expect.objectContaining({ category: 'loading' }),
      ),
    );
  });
});

/**
 * ★ CONFIRMING A PICKUP ASKS THE PHONE, SENDS THE READING, AND LETS THE
 * SERVER DECIDE. Every case below pins one side of that: what the screen sends
 * (a reading, never a verdict), what it does when the phone cannot answer
 * (nothing — no request), and how it words each refusal the server can give.
 */
describe('★ confirming a pickup with the phone’s location', () => {
  const FIX = {
    coords: { latitude: 10.8188, longitude: 106.6564, accuracy: 12 },
    timestamp: new Date('2026-08-30T02:30:55.000Z').getTime(),
  };

  const geolocation = { getCurrentPosition: vi.fn() };

  const phoneSays = (position: typeof FIX) =>
    geolocation.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok(position as unknown as GeolocationPosition),
    );

  const phoneFails = (code: number) =>
    geolocation.getCurrentPosition.mockImplementation(
      (_ok: PositionCallback, fail?: PositionErrorCallback) =>
        fail?.({ code } as GeolocationPositionError),
    );

  const arrived = () => fetchMyAssignment.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP')] }));

  const confirm = async () =>
    fireEvent.click(await screen.findByRole('button', { name: /đã lấy hàng xong/i }));

  beforeEach(() => {
    geolocation.getCurrentPosition.mockReset();
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: geolocation,
      configurable: true,
    });
    recordExecutionEvent.mockResolvedValue(event('PICKUP_CONFIRMED'));
  });

  it('says the check is coming before the tap', async () => {
    arrived();
    renderDetail();

    expect(await screen.findByText(/dùng vị trí GPS/i)).toBeInTheDocument();
  });

  it('★ sends the reading as the phone gave it — and no verdict of its own', async () => {
    arrived();
    phoneSays(FIX);
    renderDetail();

    await confirm();
    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalled());

    const [assignmentId, body] = recordExecutionEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(assignmentId).toBe('a1');
    expect(body.type).toBe('PICKUP_CONFIRMED');
    expect(body.location).toEqual({
      latitude: 10.8188,
      longitude: 106.6564,
      accuracyM: 12,
      capturedAt: '2026-08-30T02:30:55.000Z',
    });
    // The browser is a sensor. It does not say whether it is inside.
    expect(body).not.toHaveProperty('geofencePassed');
    expect(body).not.toHaveProperty('distanceM');
    expect(body).not.toHaveProperty('actualAt');
    expect(Object.keys(body.location as object)).not.toContain('isInside');
  });

  it('★ asks for a FRESH fix, never a cached one', async () => {
    arrived();
    phoneSays(FIX);
    renderDetail();

    await confirm();
    await waitFor(() => expect(geolocation.getCurrentPosition).toHaveBeenCalled());

    const [, , options] = geolocation.getCurrentPosition.mock.calls[0] as [
      unknown,
      unknown,
      PositionOptions,
    ];
    expect(options.maximumAge).toBe(0);
    expect(options.enableHighAccuracy).toBe(true);
  });

  it('shows that it is locating while the phone thinks', async () => {
    arrived();
    // Never answers: the button stays in its locating state.
    geolocation.getCurrentPosition.mockImplementation(() => undefined);
    renderDetail();

    await confirm();

    expect(await screen.findByRole('button', { name: /đang xác định vị trí/i })).toBeDisabled();
    expect(recordExecutionEvent).not.toHaveBeenCalled();
  });

  it('★ makes NO request when permission is denied, and says what to enable', async () => {
    arrived();
    phoneFails(1);
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/bật quyền vị trí/i);
    expect(recordExecutionEvent).not.toHaveBeenCalled();
    // The button is back, so the driver can retry once they have.
    expect(screen.getByRole('button', { name: /đã lấy hàng xong/i })).toBeEnabled();
  });

  it('names a phone that cannot get a fix', async () => {
    arrived();
    phoneFails(2);
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/không lấy được vị trí/i);
    expect(recordExecutionEvent).not.toHaveBeenCalled();
  });

  it('names a fix that took too long', async () => {
    arrived();
    phoneFails(3);
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/quá lâu/i);
  });

  it('names a browser with no geolocation at all', async () => {
    arrived();
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true });
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/không hỗ trợ định vị/i);
    expect(recordExecutionEvent).not.toHaveBeenCalled();
  });

  it('★ words "outside the geofence" as where to go, with no distance and no radius', async () => {
    arrived();
    phoneSays(FIX);
    recordExecutionEvent.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'That position is not at the pickup point.', {
        location: 'OUTSIDE_GEOFENCE',
      }),
    );
    renderDetail();

    await confirm();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/chưa ở đúng điểm/i);
    expect(alert.textContent).not.toMatch(/\d+\s*m\b|mét|radius|bán kính/i);
  });

  it('tells the driver to move to open sky on a poor reading', async () => {
    arrived();
    phoneSays(FIX);
    recordExecutionEvent.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Not sure enough.', { location: 'ACCURACY_INSUFFICIENT' }),
    );
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/chưa đủ chính xác/i);
  });

  it('tells the driver to retry on a stale fix', async () => {
    arrived();
    phoneSays(FIX);
    recordExecutionEvent.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Too old.', { location: 'LOCATION_STALE' }),
    );
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/vị trí đã cũ/i);
  });

  it('★ says it is the office’s problem when the pickup point has no coordinates, and offers no tap', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({ events: [event('ARRIVED_PICKUP')], pickupLocation: null }),
    );
    phoneSays(FIX);
    renderDetail();

    // Said before any tap…
    expect(await screen.findByText(/chưa có toạ độ/i)).toBeInTheDocument();

    // …and the button cannot be tapped: the server refuses this without
    // exception, so asking the phone and sending a request would only teach
    // the driver to retry something that cannot succeed.
    const button = screen.getByRole('button', { name: /đã lấy hàng xong/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(recordExecutionEvent).not.toHaveBeenCalled();
  });

  it('words the server’s "no coordinates" refusal the same way — the office cleared them after the screen loaded', async () => {
    arrived();
    phoneSays(FIX);
    recordExecutionEvent.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'No coordinates.', { location: 'DESTINATION_MISSING' }),
    );
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/liên hệ điều độ/i);
  });

  it('keeps a plain validation failure worded generically', async () => {
    arrived();
    phoneSays(FIX);
    recordExecutionEvent.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Request failed validation.', { clientEventId: 'x' }),
    );
    renderDetail();

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/chưa hợp lệ/i);
  });

  it('falls back to the generic message on a server fault, with no internals', async () => {
    arrived();
    phoneSays(FIX);
    recordExecutionEvent.mockRejectedValue(new ApiError(500, undefined, 'boom'));
    renderDetail();

    await confirm();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/có lỗi xảy ra/i);
    expect(alert.textContent).not.toMatch(/boom/);
  });

  it('does not ask the phone for an ARRIVAL — only the confirmation is geofenced', async () => {
    phoneSays(FIX);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i }));
    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalled());

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    const [, body] = recordExecutionEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('location');
  });
});

/**
 * ★ THE DELIVERY IS CONFIRMED THE SAME WAY THE PICKUP IS: the phone is asked,
 * the reading is sent, the server measures it against the DELIVERY point.
 */
describe('★ confirming a delivery with the phone’s location', () => {
  const FIX = {
    coords: { latitude: 10.7769, longitude: 106.7009, accuracy: 9 },
    timestamp: new Date('2026-08-30T09:30:55.000Z').getTime(),
  };
  const geolocation = { getCurrentPosition: vi.fn() };

  const atDelivery = () =>
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED'), event('ARRIVED_DELIVERY')],
        deliveryLocation: { latitude: 10.7769, longitude: 106.7009 },
      }),
    );

  beforeEach(() => {
    geolocation.getCurrentPosition.mockReset().mockImplementation((ok: PositionCallback) =>
      ok(FIX as unknown as GeolocationPosition),
    );
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: geolocation, configurable: true });
    recordExecutionEvent.mockResolvedValue(event('DELIVERY_CONFIRMED'));
  });

  it('★ asks the phone and sends the reading with DELIVERY_CONFIRMED', async () => {
    atDelivery();
    renderDetail();

    expect(await screen.findByText(/dùng vị trí GPS/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /đã giao hàng xong/i }));
    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalled());

    const [, body] = recordExecutionEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.type).toBe('DELIVERY_CONFIRMED');
    expect(body.location).toEqual({
      latitude: 10.7769,
      longitude: 106.7009,
      accuracyM: 9,
      capturedAt: '2026-08-30T09:30:55.000Z',
    });
    expect(body).not.toHaveProperty('geofencePassed');
  });

  it('★ offers no tap while the delivery point has no coordinates', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED'), event('ARRIVED_DELIVERY')],
        deliveryLocation: null,
      }),
    );
    renderDetail();

    expect(await screen.findByText(/chưa có toạ độ/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /đã giao hàng xong/i })).toBeDisabled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not ask the phone for the arrival at delivery', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({ events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED')], deliveryLocation: null }),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm giao hàng/i }));
    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalled());

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('words a delivery refused outside the geofence as where to go', async () => {
    atDelivery();
    recordExecutionEvent.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Not there.', { location: 'OUTSIDE_GEOFENCE' }),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã giao hàng xong/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/chưa ở đúng điểm/i);
  });
});
