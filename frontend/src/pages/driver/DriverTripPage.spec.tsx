import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
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
const fetchMyTrips = vi.fn();
const fetchMyTrip = vi.fn();
const recordExecutionEvent = vi.fn();
const declareExpense = vi.fn();
const editExpense = vi.fn();
const submitCompletion = vi.fn();

vi.mock('@/api/driverPortal', () => ({
  fetchMyTrips: (...a: unknown[]) => fetchMyTrips(...a),
  fetchMyTrip: (...a: unknown[]) => fetchMyTrip(...a),
  recordExecutionEvent: (...a: unknown[]) => recordExecutionEvent(...a),
  declareExpense: (...a: unknown[]) => declareExpense(...a),
  editExpense: (...a: unknown[]) => editExpense(...a),
  submitCompletion: (...a: unknown[]) => submitCompletion(...a),
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

const renderDetail = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/driver/trips/t1']}>
          <Routes>
            <Route path="/driver" element={<DriverTripsPage />} />
            <Route path="/driver/trips/:tripId" element={<DriverTripPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
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
  fetchMyTrips.mockResolvedValue([]);
  fetchMyTrip.mockResolvedValue(trip());
  recordExecutionEvent.mockResolvedValue(event('ARRIVED_PICKUP'));
  declareExpense.mockResolvedValue(cost());
  editExpense.mockResolvedValue(cost({ amount: '1550000.00' }));
  submitCompletion.mockResolvedValue({ id: 'r1', attemptNo: 1, state: 'pending' });
});

describe('★ a driver sees only their own trips', () => {
  it('asks for the list with no parameter at all', async () => {
    // The scope IS the session. A parameter here would be something a client
    // could change.
    fetchMyTrips.mockResolvedValue([trip()]);
    renderList();

    await screen.findByText('VIỄN ĐẠT');
    expect(fetchMyTrips).toHaveBeenCalledWith();
    expect(fetchMyTrips.mock.calls[0]).toHaveLength(0);
  });

  it('says so plainly when nothing is assigned', async () => {
    renderList();

    expect(await screen.findByText(/chưa được phân công/i)).toBeInTheDocument();
  });

  it('★ shows a refusal as "not yours" and nothing more', async () => {
    // Never whether the trip exists, never whose it is.
    fetchMyTrip.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.'));
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
    fetchMyTrip.mockResolvedValue(trip({ expenses: [cost()] }));
    const { container } = renderDetail();

    await screen.findByText('51D-65233');

    expect(container.textContent).not.toMatch(/tổng|total|margin|lợi nhuận/i);
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
    fetchMyTrip.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP')] }));
    renderDetail();

    expect(await screen.findByRole('button', { name: /đã lấy hàng xong/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /đã đến điểm lấy hàng/i })).not.toBeInTheDocument();
  });

  it('offers nothing once all four are reported', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    expect(await screen.findByText(/đã hoàn tất các bước vận chuyển/i)).toBeInTheDocument();
  });

  it('★ sends the type, an instant and an idempotency id — and nothing else', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /đã đến điểm lấy hàng/i }));

    await waitFor(() => expect(recordExecutionEvent).toHaveBeenCalled());

    const [tripId, body] = recordExecutionEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(tripId).toBe('t1');
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
    fetchMyTrip.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP')] }));
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
    fetchMyTrip.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP')] }));
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

    const [tripId, body] = declareExpense.mock.calls[0] as [string, Record<string, unknown>];
    expect(tripId).toBe('t1');
    expect(body.amount).toBe('1500000');
    expect(body).not.toHaveProperty('declaredBy');
    expect(body).not.toHaveProperty('tripId');
  });

  it('★ does not offer fuel or tolls on a hired lorry', async () => {
    fetchMyTrip.mockResolvedValue(
      trip({ events: [event('ARRIVED_PICKUP', { vehicleOwnership: 'outsourced' })] }),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.queryByRole('button', { name: /^dầu$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cầu trạm/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /phí kho/i })).toBeInTheDocument();
  });

  it('corrects an editable figure', async () => {
    fetchMyTrip.mockResolvedValue(trip({ expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText(/số tiền/i), { target: { value: '1550000' } });
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    // ★ ALL THREE FIELDS. The form used to offer only the amount, so a driver
    // who picked the wrong heading had to ask the office to withdraw the line.
    await waitFor(() =>
      expect(editExpense).toHaveBeenCalledWith('t1', 'c1', {
        category: 'fuel',
        amount: '1550000',
        note: null,
      }),
    );
  });

  it('★ offers no correction on a locked figure', async () => {
    fetchMyTrip.mockResolvedValue(trip({ expenses: [cost({ state: 'locked' })] }));
    renderDetail();

    // Twice now: once on the line, once in the total the driver reviews.
    expect((await screen.findAllByText('1.500.000')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument();
  });

  it('★ offers no correction once approved, and says why', async () => {
    fetchMyTrip.mockResolvedValue(
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
    fetchMyTrip.mockResolvedValue(trip({ vehicle: null }));
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
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    expect(await screen.findByText(/có phát sinh chi phí không/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /không phát sinh chi phí/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^có phát sinh chi phí$/i })).toBeInTheDocument();
  });

  it('sends the declaration the driver chose', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /có phát sinh chi phí/i }));
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('t1', 'expenses'));
  });

  it('sends "none" when the driver says there was nothing', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('t1', 'none'));
  });

  it('shows the waiting state after sending', async () => {
    fetchMyTrip.mockResolvedValue(
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
    fetchMyTrip.mockResolvedValue(
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
    expect(screen.getByText('Số tiền dầu sai.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /chỉnh sửa và gửi lại/i })).toBeInTheDocument();
  });

  it('★ reopens the figures for correction after a rejection', async () => {
    fetchMyTrip.mockResolvedValue(
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
    fetchMyTrip.mockResolvedValue(
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
    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('t1', 'expenses'));
  });

  it('★ shows a completed trip as closed, with NO way to reopen it', async () => {
    // Approval is terminal — a trigger makes it irreversible — so a control
    // that appeared to undo it would be a lie.
    fetchMyTrip.mockResolvedValue(
      trip({
        events: ALL_REPORTED,
        accountability: 'APPROVED_IMMUTABLE',
        completion: { id: 'r1', attemptNo: 2, state: 'approved', decisionReason: null },
      }),
    );
    renderDetail();

    expect(await screen.findByText(/chuyến đã hoàn tất/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gửi hoàn tất/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mở lại|reopen/i })).not.toBeInTheDocument();
  });
});

describe('★ failures a driver can act on', () => {
  it('turns a 409 into one sentence, and re-reads the trip', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED }));
    submitCompletion.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Already submitted.'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /gửi hoàn tất chuyến/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/chuyến vừa thay đổi/i);
    // A stale screen is the reason for the conflict, so it refetches.
    await waitFor(() => expect(fetchMyTrip.mock.calls.length).toBeGreaterThan(1));
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
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /có phát sinh chi phí/i }));

    expect(screen.getByLabelText(/số tiền/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^dầu$/i })).toBeInTheDocument();
  });

  it('does not reopen the form when figures already stand', async () => {
    // There is nothing to add — the driver is confirming what is on screen.
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /có phát sinh chi phí/i }));

    expect(screen.queryByLabelText(/số tiền/i)).not.toBeInTheDocument();
  });

  it('★ "no expenses" with figures on the trip asks before sending', async () => {
    // The server refuses this pairing. Asking turns a guaranteed rejection into
    // a question the driver can answer.
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));

    expect(screen.getByText(/bạn chắc chắn là không phát sinh/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i })).toBeDisabled();
    expect(submitCompletion).not.toHaveBeenCalled();
  });

  it('lets the driver keep "no expenses" after being asked', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED, expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));
    fireEvent.click(screen.getByRole('button', { name: /vẫn chọn không phát sinh/i }));
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('t1', 'none'));
  });

  it('sends "no expenses" without asking when the trip really has none', async () => {
    fetchMyTrip.mockResolvedValue(trip({ events: ALL_REPORTED }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /không phát sinh chi phí/i }));

    expect(screen.queryByText(/bạn chắc chắn là không phát sinh/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /gửi hoàn tất chuyến/i }));

    await waitFor(() => expect(submitCompletion).toHaveBeenCalledWith('t1', 'none'));
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
    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('1500000');
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

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('1500000');
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

  it('survives malformed storage without breaking the screen', async () => {
    sessionStorage.setItem('driver-expense-draft:t1', '{not json');
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));

    expect(screen.getByLabelText(/số tiền/i)).toHaveValue('');
  });
});

describe('the expense panel tells the driver where they stand', () => {
  it('says nothing has been declared yet', async () => {
    renderDetail();

    expect(await screen.findByText(/chưa khai khoản chi nào/i)).toBeInTheDocument();
  });

  it('★ counts the lines and totals them EXACTLY', async () => {
    // Summed as integer minor units, never through a float.
    fetchMyTrip.mockResolvedValue(
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
    expect(screen.getByText('1.700.000,30')).toBeInTheDocument();
  });

  it('shows a hint that belongs to the chosen heading', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /thêm khoản chi/i }));
    fireEvent.click(screen.getByRole('button', { name: /phí kho/i }));

    expect(screen.getByPlaceholderText(/kho nào/i)).toBeInTheDocument();
  });

  it('lets the driver correct the heading, not just the amount', async () => {
    fetchMyTrip.mockResolvedValue(trip({ expenses: [cost()] }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: /bốc xếp/i }));
    fireEvent.click(screen.getByRole('button', { name: /^lưu$/i }));

    await waitFor(() =>
      expect(editExpense).toHaveBeenCalledWith(
        't1',
        'c1',
        expect.objectContaining({ category: 'loading' }),
      ),
    );
  });
});
