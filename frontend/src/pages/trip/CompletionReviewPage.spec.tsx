import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';
import CompletionReviewPage from './CompletionReviewPage';

/**
 * The office side of completion, as a reviewer uses it.
 *
 * ★ THE PROPERTY THIS FILE EXISTS TO PIN DOWN: THE CLIENT DECIDES NOTHING.
 *
 * Approving closes a trip permanently — a database trigger makes it
 * irreversible — so every case here asserts that the screen waits for the
 * server, sends it no opinion about who decided or when, and shows the truth
 * rather than an optimistic guess when two reviewers race.
 */
const fetchCompletionReviewQueue = vi.fn();
const fetchCompletionRequests = vi.fn();
const fetchExecutionEvents = vi.fn();
const approveCompletion = vi.fn();
const rejectCompletion = vi.fn();
const fetchTripCosts = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/tripCompletion', () => ({
  fetchOperationalBoard: vi.fn(),
  fetchCompletionReviewQueue: (...a: unknown[]) => fetchCompletionReviewQueue(...a),
  fetchCompletionRequests: (...a: unknown[]) => fetchCompletionRequests(...a),
  fetchExecutionEvents: (...a: unknown[]) => fetchExecutionEvents(...a),
  approveCompletion: (...a: unknown[]) => approveCompletion(...a),
  rejectCompletion: (...a: unknown[]) => rejectCompletion(...a),
}));
vi.mock('@/api/tripCost', () => ({
  fetchTripCosts: (...a: unknown[]) => fetchTripCosts(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));

const TRIP = 't1';
const SERVER_TIME = '2026-08-30T02:31:00.000Z';

const session = (permissions: string[]) => ({
  state: { status: 'ready', authorization: { userId: 'u1', username: 'boss', role: 'SUPERADMIN', departmentIds: [], permissions } },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

const row = (over: Record<string, unknown> = {}) => ({
  tripId: TRIP,
  // ★ ONE ROW PER LORRY (ADR-0004): the turn and its pending request.
  assignmentId: 'a1',
  completionRequestId: 'r1',
  scheduledOn: '2026-08-30',
  vehicle: { id: 'v1', plate: '51D-65233' },
  customer: { id: 'c1', name: 'VIỄN ĐẠT' },
  driver: { id: 'd1', displayName: 'Tài Xế A' },
  scheduledPickupAt: '2026-08-30T02:00:00.000Z',
  scheduledDeliveryAt: '2026-08-30T09:00:00.000Z',
  arrivedPickupAt: SERVER_TIME,
  pickupConfirmedAt: SERVER_TIME,
  arrivedDeliveryAt: SERVER_TIME,
  deliveryConfirmedAt: SERVER_TIME,
  stage: 'COMPLETION_PENDING',
  pickupDelayMinutes: 31,
  deliveryDelayMinutes: 0,
  expenseDeclaration: 'expenses',
  accountability: 'DECLARED_WITH_EXPENSE',
  completionAttempts: 1,
  completionRejectionReason: null,
  ...over,
});

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  tripId: TRIP,
  driverAssignmentId: 'a1',
  attemptNo: 1,
  expenseDeclaration: 'expenses',
  state: 'pending',
  submittedBy: 'd1',
  submittedByUser: { id: 'd1', displayName: 'Tài Xế A' },
  submittedAt: SERVER_TIME,
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  ...over,
});

const event = (type: string, over: Record<string, unknown> = {}) => ({
  id: `e-${type}`,
  tripId: TRIP,
  driverAssignmentId: 'a1',
  type,
  vehicleId: 'v1',
  vehicleOwnership: 'company',
  scheduledAt: '2026-08-30T02:00:00.000Z',
  actualAt: SERVER_TIME,
  recordedAt: SERVER_TIME,
  deviceReportedAt: null,
  recordedBy: 'd1',
  recordedByUser: { id: 'd1', displayName: 'Tài Xế A' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter>
          <CompletionReviewPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

/** Opens the queue's first row. */
const openReview = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /xem hồ sơ/i }));
  await screen.findByText(/tiến trình tài xế báo/i);
};

beforeEach(() => {
  vi.clearAllMocks();
  useSession.mockReturnValue(session(['trip.read', 'trip.complete.review', 'cost.read']));
  fetchCompletionReviewQueue.mockResolvedValue([row()]);
  fetchCompletionRequests.mockResolvedValue([request()]);
  fetchExecutionEvents.mockResolvedValue([
    event('ARRIVED_PICKUP'),
    event('PICKUP_CONFIRMED'),
    event('ARRIVED_DELIVERY'),
    event('DELIVERY_CONFIRMED'),
  ]);
  fetchTripCosts.mockResolvedValue({
    items: [{ id: 'c1', driverAssignmentId: 'a1', category: 'fuel', amount: '1500000.00', state: 'locked' }],
    total: '1500000.00',
  });
  approveCompletion.mockResolvedValue(request({ state: 'approved' }));
  rejectCompletion.mockResolvedValue(request({ state: 'rejected', decisionReason: 'x' }));
});

describe('the review queue', () => {
  it('lists a trip whose completion is waiting', async () => {
    renderPage();

    expect(await screen.findByText('VIỄN ĐẠT')).toBeInTheDocument();
    expect(screen.getByText('Tài Xế A')).toBeInTheDocument();
    expect(screen.getByText(/chờ duyệt/i)).toBeInTheDocument();
  });

  it('★ lists a trip that was sent back — it is still outstanding work', async () => {
    fetchCompletionReviewQueue.mockResolvedValue([row({ stage: 'COMPLETION_REJECTED' })]);
    renderPage();

    expect(await screen.findByText(/đã từ chối/i)).toBeInTheDocument();
  });

  it('shows the empty state when nothing is outstanding', async () => {
    fetchCompletionReviewQueue.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/không có chuyến nào chờ duyệt/i)).toBeInTheDocument();
  });

  it('★ asks for outstanding work, with no date range to lose a trip behind', async () => {
    // The whole reason this is its own endpoint. A completion submitted on the
    // 30th and undecided on the 1st fell outside a month range and vanished —
    // so the client now sends no range at all, and no browser clock decides
    // which business month it is.
    renderPage();

    await screen.findByText('VIỄN ĐẠT');
    expect(fetchCompletionReviewQueue).toHaveBeenCalledWith();
    expect(fetchCompletionReviewQueue.mock.calls[0]).toHaveLength(0);
  });

  it('★ renders exactly what the server returned, filtering nothing itself', async () => {
    // The rule about what is "outstanding" lives on the server now. A client
    // filter would be a second definition, and the two would drift.
    fetchCompletionReviewQueue.mockResolvedValue([
      row({ tripId: 'a', customer: { id: 'c1', name: 'ALPHA' } }),
      row({ tripId: 'b', customer: { id: 'c2', name: 'BETA' }, stage: 'COMPLETION_REJECTED' }),
    ]);
    renderPage();

    expect(await screen.findByText('ALPHA')).toBeInTheDocument();
    expect(screen.getByText('BETA')).toBeInTheDocument();
  });

  it('shows what the driver declared, and no amount', async () => {
    renderPage();

    expect(await screen.findByText(/đã khai: có phát sinh/i)).toBeInTheDocument();
    expect(screen.queryByText('1,500,000')).not.toBeInTheDocument();
  });
});

describe('the evidence', () => {
  it('shows the four steps with the server’s own timestamps', async () => {
    await openReview();

    expect(screen.getByText(/đến điểm lấy hàng/i)).toBeInTheDocument();
    expect(screen.getByText(/xác nhận giao hàng/i)).toBeInTheDocument();
    // ★ `recordedAt` is labelled and shown — it is the figure a reviewer trusts.
    expect(screen.getAllByText(/máy chủ ghi/i)).toHaveLength(4);
  });

  it('★ labels the handset clock as diagnostic, never as a fact', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP', { deviceReportedAt: '2021-01-01T00:00:00.000Z' }),
    ]);
    await openReview();

    expect(screen.getByText(/đồng hồ thiết bị \(tham khảo\)/i)).toBeInTheDocument();
  });

  it('marks a step the driver never reported', async () => {
    fetchExecutionEvents.mockResolvedValue([event('ARRIVED_PICKUP')]);
    await openReview();

    expect(screen.getAllByText(/chưa báo/i)).toHaveLength(3);
  });

  it('shows a withdrawn event with its reason rather than hiding it', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP', { voidedAt: SERVER_TIME, voidReason: 'Ghi nhầm chuyến' }),
    ]);
    await openReview();

    expect(screen.getByText(/ghi nhầm chuyến/i)).toBeInTheDocument();
  });

  it('★ renders the delay the SERVER computed, with no threshold applied', async () => {
    await openReview();

    // 31 minutes, exactly as sent. No "late"/"on time" verdict anywhere.
    expect(screen.getByText(/trễ lấy hàng: 31 phút/i)).toBeInTheDocument();
  });

  it('shows the driver’s figures when the reviewer holds cost.read', async () => {
    await openReview();

    expect(screen.getByText('1,500,000')).toBeInTheDocument();
  });

  it('★ says so, and asks for nothing, when the reviewer lacks cost.read', async () => {
    useSession.mockReturnValue(session(['trip.read', 'trip.complete.review']));
    await openReview();

    expect(screen.getByText(/không có quyền xem số tiền/i)).toBeInTheDocument();
    expect(fetchTripCosts).not.toHaveBeenCalled();
  });

  it('shows every attempt with its declaration and reason', async () => {
    fetchCompletionRequests.mockResolvedValue([
      request({ id: 'r2', attemptNo: 2, state: 'pending' }),
      request({ id: 'r1', attemptNo: 1, state: 'rejected', decisionReason: 'Số tiền dầu sai.' }),
    ]);
    await openReview();

    expect(screen.getByText('Số tiền dầu sai.')).toBeInTheDocument();
  });
});

describe('★ approve', () => {
  it('sends no body the server could take an opinion from', async () => {
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));

    await waitFor(() => expect(approveCompletion).toHaveBeenCalledWith(TRIP, 'r1'));
    // ★ The trip id and nothing else. No decidedBy, no decidedAt, no state.
    expect(approveCompletion.mock.calls[0]).toEqual([TRIP, 'r1']);
  });

  it('★ warns that it cannot be undone, before the click', async () => {
    await openReview();

    expect(screen.getByText(/không thể mở lại/i)).toBeInTheDocument();
  });

  it('★ never renders DONE before the server confirms it', async () => {
    // A promise that never resolves: whatever the screen shows now is what it
    // shows on an optimistic implementation, and it must not be "completed".
    approveCompletion.mockReturnValue(new Promise(() => {}));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));

    await waitFor(() => expect(approveCompletion).toHaveBeenCalled());
    expect(screen.queryByText(/chuyến đã hoàn tất/i)).not.toBeInTheDocument();
  });

  it('refetches the queue once the server has agreed', async () => {
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));

    await waitFor(() => expect(fetchCompletionReviewQueue.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('★ reject', () => {
  it('refuses to send with an empty reason', async () => {
    await openReview();

    const button = screen.getByRole('button', { name: /^từ chối$/i });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(rejectCompletion).not.toHaveBeenCalled();
  });

  it('refuses a reason that is only whitespace', async () => {
    await openReview();

    fireEvent.change(screen.getByLabelText(/lý do từ chối/i), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: /^từ chối$/i })).toBeDisabled();
  });

  it('sends the trimmed reason and nothing else', async () => {
    await openReview();

    fireEvent.change(screen.getByLabelText(/lý do từ chối/i), {
      target: { value: '  Số tiền dầu sai.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^từ chối$/i }));

    await waitFor(() =>
      expect(rejectCompletion).toHaveBeenCalledWith(TRIP, 'r1', 'Số tiền dầu sai.'),
    );
    expect(rejectCompletion.mock.calls[0]).toHaveLength(3);
  });
});

describe('★ a decided trip offers nothing further', () => {
  it('shows an approved trip as closed, with no reopen and no buttons', async () => {
    fetchCompletionReviewQueue.mockResolvedValue([row({ stage: 'COMPLETION_REJECTED' })]);
    fetchCompletionRequests.mockResolvedValue([
      request({ state: 'approved', decidedAt: SERVER_TIME }),
    ]);
    await openReview();

    expect(screen.getByText(/lượt xe này đã được duyệt/i)).toBeInTheDocument();
    expect(screen.queryByText(/chuyến đã hoàn tất/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /duyệt lượt xe này/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^từ chối$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mở lại|reopen/i })).not.toBeInTheDocument();
  });

  /**
   * ★ ONE LORRY APPROVED, THE OTHER STILL WAITING (ADR-0004). The trip is not
   * finished — the server's status says so, and this screen must not claim
   * otherwise on the strength of one assignment's approval. Opening A says A is
   * approved; opening B still offers the decision.
   */
  it('★ never calls the trip completed while a second assignment is still pending', async () => {
    const rowA = row({ assignmentId: 'a1', completionRequestId: 'r1', stage: 'DONE', driver: { id: 'd1', displayName: 'Tài Xế A' } });
    const rowB = row({ assignmentId: 'a2', completionRequestId: 'r2', stage: 'COMPLETION_PENDING', driver: { id: 'd2', displayName: 'Tài Xế B' } });
    fetchCompletionReviewQueue.mockResolvedValue([rowA, rowB]);
    fetchCompletionRequests.mockResolvedValue([
      request({ id: 'r2', driverAssignmentId: 'a2', submittedBy: 'd2', state: 'pending' }),
      request({ id: 'r1', driverAssignmentId: 'a1', state: 'approved', decidedAt: SERVER_TIME }),
    ]);
    renderPage();

    const [openA, openB] = await screen.findAllByRole('button', { name: /xem hồ sơ/i });
    fireEvent.click(openA!);
    await screen.findByText(/tiến trình tài xế báo/i);
    expect(screen.getByText(/lượt xe này đã được duyệt/i)).toBeInTheDocument();
    expect(screen.queryByText(/chuyến đã hoàn tất|trip completed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^từ chối$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /đóng/i }));
    fireEvent.click(openB!);
    await screen.findByText(/tiến trình tài xế báo/i);
    expect(screen.queryByText(/lượt xe này đã được duyệt/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^từ chối$/i })).toBeInTheDocument();
  });

  it('offers no decision when nothing is pending', async () => {
    fetchCompletionReviewQueue.mockResolvedValue([row({ stage: 'COMPLETION_REJECTED' })]);
    fetchCompletionRequests.mockResolvedValue([
      request({ state: 'rejected', decisionReason: 'Sai số.', decidedAt: SERVER_TIME }),
    ]);
    await openReview();

    expect(screen.getByText(/không có yêu cầu nào đang chờ duyệt/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /duyệt lượt xe này/i })).not.toBeInTheDocument();
  });
});

describe('★ permission', () => {
  it('hides both decisions from somebody without trip.complete.review', async () => {
    // `trip.write` is deliberately NOT enough — a dispatcher may correct a trip
    // and may not close its books.
    useSession.mockReturnValue(session(['trip.read', 'trip.write', 'cost.read']));
    await openReview();

    expect(screen.getAllByText(/không có quyền duyệt hoàn tất/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /duyệt lượt xe này/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^từ chối$/i })).not.toBeInTheDocument();
  });

  it('★ is a courtesy, not the boundary — the server still decides', async () => {
    // Holding the permission in the client is not what allows the call; the
    // route re-checks. This case only pins that the UI stops offering it.
    useSession.mockReturnValue(session(['trip.read']));
    await openReview();

    expect(approveCompletion).not.toHaveBeenCalled();
    expect(rejectCompletion).not.toHaveBeenCalled();
  });
});

describe('★ two reviewers at once', () => {
  it('turns a 409 into "decided elsewhere" and keeps the panel open', async () => {
    approveCompletion.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Already decided.'));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/vừa được xử lý ở nơi khác/i);
    // Not closed on a decision that did not land.
    expect(screen.getByText(/tiến trình tài xế báo/i)).toBeInTheDocument();
  });

  it('does the same for a rejection that lost the race', async () => {
    rejectCompletion.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Already decided.'));
    await openReview();

    fireEvent.change(screen.getByLabelText(/lý do từ chối/i), { target: { value: 'Sai số.' } });
    fireEvent.click(screen.getByRole('button', { name: /^từ chối$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/vừa được xử lý ở nơi khác/i);
  });

  it('★ shows no DONE state after a conflict', async () => {
    approveCompletion.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Already decided.'));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));
    await screen.findByRole('alert');

    expect(screen.queryByText(/chuyến đã hoàn tất/i)).not.toBeInTheDocument();
  });
});

describe('other failures', () => {
  it('explains a lost connection', async () => {
    approveCompletion.mockRejectedValue(new ApiError(0, undefined, 'Network error'));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không kết nối được/i);
  });

  it('explains an expired session', async () => {
    approveCompletion.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Authentication required.'));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/hết hạn/i);
  });

  it('★ explains a server refusal without claiming the click failed locally', async () => {
    approveCompletion.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed.'));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /duyệt lượt xe này/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không có quyền thực hiện/i);
  });

  it('explains a validation failure', async () => {
    rejectCompletion.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'Bad reason'));
    await openReview();

    fireEvent.change(screen.getByLabelText(/lý do từ chối/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^từ chối$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/chưa hợp lệ/i);
  });

  it('shows a failed queue read without an empty-state that lies', async () => {
    fetchCompletionReviewQueue.mockRejectedValue(new ApiError(0, undefined, 'Network error'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/không kết nối được/i);
  });
});

/**
 * ★ WHAT THE SERVER SAID ABOUT WHERE THE HANDSET WAS, SHOWN AS SAID.
 *
 * Every assertion here reads a value the mocked API returned — a verdict, a
 * distance, an accuracy — and none of them is computed by the screen. An
 * event with nothing on it is shown as having nothing, never as a failure.
 * `\s` in the patterns because `Intl` may set the unit off with a
 * non-breaking space.
 */
describe('★ location evidence', () => {
  const reading = (accuracyM: number) => ({
    latitude: 10.8188,
    longitude: 106.6564,
    accuracyM,
    capturedAt: SERVER_TIME,
  });

  it('shows a verified pickup with the server’s distance and the handset’s accuracy', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP'),
      event('PICKUP_CONFIRMED', { location: reading(18), geofencePassed: true, distanceM: 42.37 }),
    ]);
    await openReview();

    expect(screen.getByText('Đã xác minh')).toBeInTheDocument();
    // The label and the figure are sibling nodes, so the paragraph is read whole.
    expect(screen.getByText(/khoảng cách tới điểm/i).parentElement).toHaveTextContent(/42\sm/);
    expect(screen.getByText(/độ chính xác gps/i).parentElement).toHaveTextContent(/18\sm/);
  });

  it('shows a verified delivery, in kilometres when the server’s figure is that large', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP'),
      event('PICKUP_CONFIRMED', { location: reading(12), geofencePassed: true, distanceM: 8 }),
      event('ARRIVED_DELIVERY'),
      event('DELIVERY_CONFIRMED', { location: reading(14), geofencePassed: true, distanceM: 1234 }),
    ]);
    await openReview();

    expect(screen.getAllByText('Đã xác minh')).toHaveLength(2);
    const distances = screen
      .getAllByText(/khoảng cách tới điểm/i)
      .map((label) => label.parentElement?.textContent ?? '');
    expect(distances[0]).toMatch(/8\sm/);
    expect(distances[1]).toMatch(/1,2\skm/);
  });

  it('★ says an event without evidence has none — neither verified nor failed', async () => {
    // The default fixtures carry no location fields at all, as pre-0019 rows do.
    await openReview();

    expect(screen.getAllByText('Không có dữ liệu xác minh vị trí')).toHaveLength(2);
    expect(screen.queryByText('Đã xác minh')).toBeNull();
    expect(screen.queryByText('Không xác minh được')).toBeNull();
    expect(screen.queryByText(/khoảng cách tới điểm/i)).toBeNull();
  });

  it('treats an explicit null verdict with no reading the same way', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP'),
      event('PICKUP_CONFIRMED', { location: null, geofencePassed: null, distanceM: null }),
    ]);
    await openReview();

    expect(screen.getByText('Không có dữ liệu xác minh vị trí')).toBeInTheDocument();
    expect(screen.queryByText('Đã xác minh')).toBeNull();
  });

  it('shows a reading that carries no verdict as exactly that, with its accuracy', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP'),
      event('PICKUP_CONFIRMED', { location: reading(25), geofencePassed: null, distanceM: null }),
    ]);
    await openReview();

    expect(screen.getByText(/chưa có kết luận xác minh/i)).toBeInTheDocument();
    expect(screen.getByText(/độ chính xác gps/i).parentElement).toHaveTextContent(/25\sm/);
    expect(screen.queryByText(/khoảng cách tới điểm/i)).toBeNull();
  });

  it('★ renders a false verdict as the server’s word, never as verified', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP'),
      event('PICKUP_CONFIRMED', { location: reading(9), geofencePassed: false, distanceM: 640 }),
    ]);
    await openReview();

    expect(screen.getByText('Không xác minh được')).toBeInTheDocument();
    expect(screen.queryByText('Đã xác minh')).toBeNull();
    expect(screen.getByText(/khoảng cách tới điểm/i).parentElement).toHaveTextContent(/640\sm/);
  });

  it('★ renders the distance the server sent, rounded for reading and never recomputed', async () => {
    // A reading 5 km from the stored point with a "passed" verdict is
    // contradictory on purpose: the screen must show both as sent.
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP'),
      event('PICKUP_CONFIRMED', { location: reading(30), geofencePassed: true, distanceM: 5000.49 }),
    ]);
    await openReview();

    expect(screen.getByText('Đã xác minh')).toBeInTheDocument();
    expect(screen.getByText(/khoảng cách tới điểm/i).parentElement).toHaveTextContent(/5\skm/);
  });

  it('attaches no location block to the two arrivals', async () => {
    fetchExecutionEvents.mockResolvedValue([
      event('ARRIVED_PICKUP', { location: reading(10) }),
      event('PICKUP_CONFIRMED', { location: reading(10), geofencePassed: true, distanceM: 20 }),
      event('ARRIVED_DELIVERY', { location: reading(10) }),
      event('DELIVERY_CONFIRMED', { location: reading(10), geofencePassed: true, distanceM: 30 }),
    ]);
    await openReview();

    expect(screen.getAllByText('Xác minh vị trí')).toHaveLength(2);
  });
});
