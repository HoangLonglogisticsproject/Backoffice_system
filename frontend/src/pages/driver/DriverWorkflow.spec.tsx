import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { queryClient as productionClient } from '@/config/query-client';
import { ApiError } from '@/utils/errors';
import DriverTripPage from './DriverTripPage';
import DriverTripsPage from './DriverTripsPage';

/**
 * The driver's screen as a workflow: what the schedule says, which stage is
 * lit, and what each card says at each point of the trip.
 *
 * The business rules behind every state live in `utils/driverExecution` and
 * `utils/driverSchedule` and are pinned there; these cases pin that the SCREEN
 * reads them correctly — the tabs, the cards, the stepper, the status pill,
 * the milestone cards, the expense lifecycle and the completion summary.
 */
const fetchMyAssignments = vi.fn();
const fetchMyAssignment = vi.fn();

vi.mock('@/api/driverPortal', () => ({
  fetchMyAssignments: (...a: unknown[]) => fetchMyAssignments(...a),
  fetchMyAssignment: (...a: unknown[]) => fetchMyAssignment(...a),
  recordExecutionEvent: vi.fn(),
  declareExpense: vi.fn(),
  editExpense: vi.fn(),
  submitCompletion: vi.fn(),
}));

/** 10:00 on 30 August in Hồ Chí Minh — the business day every fixture is on. */
const NOW = new Date('2026-08-30T03:00:00.000Z');
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

/** An assignment of `trip()` under its own id — the only thing that tells two apart. */
const turn = (id: string, over: Record<string, unknown> = {}) => trip({ assignment: { id, assignedAt: AT }, ...over });

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

/** Where the router is, and how it got there — the only way to see a `replace` that renders nothing new. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  const how = useNavigationType();
  return (
    <>
      <p data-testid="location">{pathname + search}</p>
      <p data-testid="navigation">{how}</p>
    </>
  );
}

const renderAt = (
  path: string,
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
) => {
  const view = render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/driver" element={<DriverTripsPage />} />
            <Route path="/driver/assignments/:assignmentId" element={<DriverTripPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
};

/**
 * A tab by its label. Matched on the start of its name so it holds with or
 * without the count; the count itself is pinned by its own case below.
 */
const tab = (label: string) => screen.getByRole('tab', { name: (name) => name.startsWith(label) });

/**
 * Today's cards, once the schedule has loaded. A card is its list item — the
 * route inside it is a list of its own, so only the outer items count.
 */
const todayCards = async () => {
  const list = await screen.findByRole('list', { name: 'Hôm nay' });
  return within(list)
    .getAllByRole('listitem')
    .filter((item) => item.parentElement === list);
};

/** A card's one link, "Xem chuyến" — `getByRole` throws the day a card grows a second. */
const linkOf = (card: HTMLElement) => within(card).getByRole('link');

const hrefs = (links: HTMLElement[]) => links.map((link) => link.getAttribute('href'));

/** The day headings of the open tab, in the order they are shown. */
const dayHeadings = () =>
  within(screen.getByRole('tabpanel'))
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);

/** The stepper's steps, in order, with whether each is the current one. */
const stepper = () => {
  const list = screen.getByRole('list', { name: 'Tiến trình chuyến' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => ({ label: item.textContent ?? '', current: item.getAttribute('aria-current') === 'step' }));
};

/**
 * A milestone card's header — its title and the pill beside it. The header, not
 * the card: the card's own step rows say "Chưa đến" too.
 */
const cardHeader = (title: string) => screen.getByText(title).parentElement as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  // Date only — fake timers would stall TanStack and RTL's async queries.
  vi.setSystemTime(NOW);
  fetchMyAssignments.mockResolvedValue([]);
  fetchMyAssignment.mockResolvedValue(trip());
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe('★ the work schedule', () => {
  it('shows loading, then today’s assignments as cards: when, from where, to where, in which lorry', async () => {
    let release: (value: unknown[]) => void = () => {};
    fetchMyAssignments.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderAt('/driver');

    expect(screen.getByRole('status')).toHaveTextContent('Đang tải…');
    expect(screen.queryByRole('link')).toBeNull();
    release([trip()]);

    const [card] = await todayCards();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Lịch làm việc' })).toBeInTheDocument();
    // ★ The business day (Asia/Ho_Chi_Minh), named — not the handset's.
    expect(screen.getByText('Chủ Nhật, 30/08/2026')).toBeInTheDocument();
    expect(tab('Hôm nay')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Hôm nay')).toHaveTextContent('Hôm nay 1');

    // ★ THE CARD NAMES THE ASSIGNMENT, NEVER THE TRIP (ADR-0004).
    expect(linkOf(card)).toHaveAttribute('href', '/driver/assignments/a1');
    const facts = ['01:00', 'Giờ lấy hàng', 'Điểm lấy hàng', 'Kho HCM', 'Điểm giao hàng', 'KHO 3SC', 'Xem chuyến'];
    for (const text of facts) {
      expect(within(card).getByText(text)).toBeInTheDocument();
    }
    expect(card).toHaveTextContent('Xe: 51D-65233');
    // The route and the time are the job; the customer is on the detail.
    expect(screen.queryByText('BLUEWATER')).toBeNull();
  });

  it('★ two trips for the same customer on the same day stay two cards, each opening its own assignment', async () => {
    // Nothing forbids this on the server: the trip schedule has no uniqueness
    // on customer + day. Each card is BOUND to its assignment id and nothing else.
    fetchMyAssignments.mockResolvedValue([trip(), turn('a2', { tripId: 't2', pickupAddress: 'Kho Bình Dương' })]);
    fetchMyAssignment.mockImplementation(async (id: string) =>
      turn(id, { tripId: id === 'a2' ? 't2' : 't1', pickupAddress: id === 'a2' ? 'Kho Bình Dương' : 'Kho HCM' }),
    );
    renderAt('/driver');

    const cards = await todayCards();
    expect(hrefs(cards.map(linkOf))).toEqual(['/driver/assignments/a1', '/driver/assignments/a2']);

    // Opening the second card loads the SECOND assignment, by its id.
    expect(within(cards[1]).getByText('Kho Bình Dương')).toBeInTheDocument();
    fireEvent.click(linkOf(cards[1]));
    expect(await screen.findByText('Thông tin chuyến')).toBeInTheDocument();
    expect(fetchMyAssignment).toHaveBeenCalledWith('a2');
    expect(fetchMyAssignment).not.toHaveBeenCalledWith('a1');
    expect(screen.getByText('Kho Bình Dương')).toBeInTheDocument();
  });

  it('★ one driver on two lorries of one trip: two cards, one per assignment (ADR-0004)', async () => {
    // Same trip, same customer, same time — two turns with two timelines. The
    // assignment is the identity, so each lorry is its own card, told apart by
    // its plate and opened by its own assignment id, never the shared trip id.
    fetchMyAssignments.mockResolvedValue([trip(), turn('a2', { vehicle: { id: 'v2', plate: '51D-00002' } })]);
    renderAt('/driver');

    expect(hrefs((await todayCards()).map(linkOf))).toEqual(['/driver/assignments/a1', '/driver/assignments/a2']);
    expect(tab('Hôm nay')).toHaveTextContent('Hôm nay 2');
    expect(screen.getByRole('link', { name: /51D-65233/ })).toHaveAttribute('href', '/driver/assignments/a1');
    expect(screen.getByRole('link', { name: /51D-00002/ })).toHaveAttribute('href', '/driver/assignments/a2');
  });

  it('★ a card’s link is named short — time and lorry — unique per lorry, and never reads the addresses out', async () => {
    // The whole card is one tap target, but a screen reader hears one short
    // link per card; the route is read as the card's own content, not its name.
    fetchMyAssignments.mockResolvedValue([trip(), turn('a2', { vehicle: { id: 'v2', plate: '51D-00002' } })]);
    renderAt('/driver');
    const cards = await todayCards();

    // Found by EXACT name, so each name is unique on the screen.
    expect(screen.getByRole('link', { name: 'Xem chuyến, 01:00, Xe 51D-65233' })).toBe(linkOf(cards[0]));
    expect(screen.getByRole('link', { name: 'Xem chuyến, 01:00, Xe 51D-00002' })).toBe(linkOf(cards[1]));
    for (const card of cards) {
      expect(linkOf(card)).not.toHaveAccessibleName(/Kho HCM|KHO 3SC/);
      // The route is still on the card — beside the link, not inside it.
      expect(within(card).getByText('Kho HCM')).toBeInTheDocument();
      expect(within(card).getByText('KHO 3SC')).toBeInTheDocument();
    }
  });

  it('orders the day by planned pickup, and an assignment with no pickup time yet goes last', async () => {
    fetchMyAssignments.mockResolvedValue([
      turn('a-none', { scheduledPickupAt: null }),
      turn('a-late', { scheduledPickupAt: '2026-08-30T05:00:00.000Z' }),
      turn('a-early', { scheduledPickupAt: '2026-08-30T01:00:00.000Z' }),
    ]);
    renderAt('/driver');

    const cards = await todayCards();
    expect(hrefs(cards.map(linkOf))).toEqual([
      '/driver/assignments/a-early',
      '/driver/assignments/a-late',
      '/driver/assignments/a-none',
    ]);
    expect(within(cards[1]).getByText('05:00')).toBeInTheDocument();
    expect(linkOf(cards[1])).toHaveAccessibleName('Xem chuyến, 05:00, Xe 51D-65233');
    expect(within(cards[2]).getByText('Chưa có giờ lấy hàng')).toBeInTheDocument();
    expect(linkOf(cards[2])).toHaveAccessibleName('Xem chuyến, Chưa có giờ lấy hàng, Xe 51D-65233');
  });

  it('puts later days under “Sắp tới”, one heading per day, the nearest first', async () => {
    fetchMyAssignments.mockResolvedValue([
      trip(),
      turn('a-sep1', { scheduledOn: '2026-09-01' }),
      turn('a-aug31', { scheduledOn: '2026-08-31' }),
    ]);
    renderAt('/driver');

    expect(hrefs((await todayCards()).map(linkOf))).toEqual(['/driver/assignments/a1']);
    expect(tab('Sắp tới')).toHaveTextContent('Sắp tới 2');
    fireEvent.click(tab('Sắp tới'));

    const nextDay = await screen.findByRole('region', { name: 'Thứ Hai, 31/08/2026' });
    expect(tab('Sắp tới')).toHaveAttribute('aria-selected', 'true');
    expect(dayHeadings()).toEqual(['Thứ Hai, 31/08/2026', 'Thứ Ba, 01/09/2026']);
    expect(within(nextDay).getByRole('link')).toHaveAttribute('href', '/driver/assignments/a-aug31');
    expect(hrefs(within(screen.getByRole('tabpanel')).getAllByRole('link'))).toEqual([
      '/driver/assignments/a-aug31',
      '/driver/assignments/a-sep1',
    ]);
  });

  it('★ “Đã qua” reads backward, most recent day first, and never claims the work was finished', async () => {
    // The list carries no completion state (contract §5.4.1): an earlier day
    // is a date, not a verdict — a trip there may still be waiting for review.
    fetchMyAssignments.mockResolvedValue([
      turn('a-28', { scheduledOn: '2026-08-28' }),
      turn('a-29', { scheduledOn: '2026-08-29' }),
    ]);
    renderAt('/driver?view=past');

    await screen.findByRole('region', { name: 'Thứ Bảy, 29/08/2026' });
    expect(tab('Đã qua')).toHaveAttribute('aria-selected', 'true');
    expect(dayHeadings()).toEqual(['Thứ Bảy, 29/08/2026', 'Thứ Sáu, 28/08/2026']);
    const panel = screen.getByRole('tabpanel');
    expect(hrefs(within(panel).getAllByRole('link'))).toEqual(['/driver/assignments/a-29', '/driver/assignments/a-28']);
    expect(within(panel).queryByText(/hoàn thành|hoàn tất/i)).toBeNull();
  });

  it.each([
    ['/driver', 'Hôm nay', 'Bạn chưa có chuyến nào hôm nay.'],
    ['/driver?view=upcoming', 'Sắp tới', 'Chưa có lịch sắp tới.'],
    ['/driver?view=past', 'Đã qua', 'Chưa có chuyến nào đã qua.'],
    ['/driver?view=nonsense', 'Hôm nay', 'Bạn chưa có chuyến nào hôm nay.'],
  ])('opens %s on “%s”, and says so when nothing is assigned there', async (path, label, empty) => {
    renderAt(path);

    expect(await screen.findByText(empty)).toBeInTheDocument();
    expect(tab(label)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('★ each tab says how many assignments it holds — to a screen reader too', async () => {
    fetchMyAssignments.mockResolvedValue([trip(), turn('a2'), turn('a-next', { scheduledOn: '2026-08-31' })]);
    renderAt('/driver');
    await todayCards();

    expect(screen.getAllByRole('tab').map((option) => option.textContent)).toEqual([
      'Hôm nay 2',
      'Sắp tới 1',
      'Đã qua 0',
    ]);
    // The count is part of the name a screen reader announces, as a separate word.
    expect(screen.getByRole('tab', { name: 'Hôm nay 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sắp tới 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Đã qua 0' })).toBeInTheDocument();
  });

  it('selecting a tab rewrites the URL in place, and today is the bare /driver', async () => {
    renderAt('/driver');
    await screen.findByText('Bạn chưa có chuyến nào hôm nay.');

    fireEvent.click(tab('Sắp tới'));
    expect(await screen.findByText('Chưa có lịch sắp tới.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/driver\?view=upcoming$/);
    // ★ Replaced, not pushed: switching tabs is not a place to go back to.
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');

    fireEvent.click(tab('Hôm nay'));
    expect(await screen.findByText('Bạn chưa có chuyến nào hôm nay.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/driver$/);
  });

  it('shows a driver-worded failure with a retry that brings the cards back', async () => {
    fetchMyAssignments.mockRejectedValueOnce(new ApiError(0, undefined, 'down')).mockResolvedValueOnce([trip()]);
    renderAt('/driver');

    expect(await screen.findByRole('alert')).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(hrefs((await todayCards()).map(linkOf))).toEqual(['/driver/assignments/a1']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMyAssignments).toHaveBeenCalledTimes(2);
  });

  it('★ offline, the schedule says so — never “no trips today”', async () => {
    // TanStack would park the read while offline — no data, no error — and the
    // page would read that as an empty day. The read runs and fails instead.
    onlineManager.setOnline(false);
    fetchMyAssignments.mockRejectedValue(new ApiError(0, undefined, 'down'));
    renderAt('/driver');

    expect(await screen.findByRole('alert')).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.queryByText('Bạn chưa có chuyến nào hôm nay.')).toBeNull();
  });

  it('★ offline, the production retry rules give up after three asks — no loop, no endless skeleton', async () => {
    // The app's own query defaults (retry twice on a network failure), with
    // the back-off shortened so the case runs fast. `networkMode: 'always'`
    // means the retries RUN while offline instead of waiting for the network,
    // so the error screen arrives after a bounded number of attempts.
    onlineManager.setOnline(false);
    fetchMyAssignments.mockRejectedValue(new ApiError(0, undefined, 'down'));
    const production = new QueryClient({
      defaultOptions: { queries: { ...productionClient.getDefaultOptions().queries, retryDelay: 0 } },
    });
    renderAt('/driver', production);

    expect(await screen.findByRole('alert')).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    expect(fetchMyAssignments).toHaveBeenCalledTimes(3);
    // And it stays at three: nothing keeps asking behind the error.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(fetchMyAssignments).toHaveBeenCalledTimes(3);
    expect(production.getQueryState(['driver', 'assignments'])?.fetchStatus).toBe('idle');
  });

  it('★ a failed refresh keeps the schedule on screen, and says so above it with a retry', async () => {
    fetchMyAssignments.mockResolvedValueOnce([trip()]).mockRejectedValue(new ApiError(0, undefined, 'down'));
    const { client } = renderAt('/driver');
    const [card] = await todayCards();

    await act(() => client.refetchQueries({ queryKey: ['driver', 'assignments'] }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    // The same card, still mounted, still saying where to go.
    expect(card).toBeInTheDocument();
    expect(within(card).getByText('Kho HCM')).toBeInTheDocument();
    expect(tab('Hôm nay')).toHaveTextContent('Hôm nay 1');
    // Read first: the warning comes before the cards it qualifies.
    expect(alert.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('★ a refusal offers no retry — asking again cannot change it', async () => {
    fetchMyAssignments.mockRejectedValue(new ApiError(403, undefined, 'no'));
    renderAt('/driver');

    expect(await screen.findByRole('alert')).toHaveTextContent('Chuyến này không thuộc về bạn.');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('keeps a long Vietnamese address whole in the card — the clamp is visual only', async () => {
    // The end of the address — ward, district — is what tells two warehouses apart.
    const long =
      'Lô A1-2, Đường số 7, KCN Tân Bình mở rộng, Phường Tây Thạnh, Quận Tân Phú, Thành phố Hồ Chí Minh, Việt Nam';
    fetchMyAssignments.mockResolvedValue([trip({ pickupAddress: long })]);
    renderAt('/driver');

    const [card] = await todayCards();
    expect(within(card).getByText(long)).toBeInTheDocument();
  });

  it('★ the day turns over while the page stays open — tomorrow’s trip becomes today’s without a reload', async () => {
    // 23:59 on 30/08 in Hồ Chí Minh: the phone is locked with tomorrow's trip on it.
    vi.setSystemTime(new Date('2026-08-30T16:59:00.000Z'));
    fetchMyAssignments.mockResolvedValue([turn('a-next', { scheduledOn: '2026-08-31' })]);
    renderAt('/driver');

    expect(await screen.findByText('Bạn chưa có chuyến nào hôm nay.')).toBeInTheDocument();
    expect(screen.getByText('Chủ Nhật, 30/08/2026')).toBeInTheDocument();
    expect(tab('Sắp tới')).toHaveTextContent('Sắp tới 1');

    // 00:01 on 31/08, and the phone is unlocked.
    vi.setSystemTime(new Date('2026-08-30T17:01:00.000Z'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByText('Thứ Hai, 31/08/2026')).toBeInTheDocument();
    expect(hrefs((await todayCards()).map(linkOf))).toEqual(['/driver/assignments/a-next']);
    expect(tab('Hôm nay')).toHaveTextContent('Hôm nay 1');
    expect(tab('Sắp tới')).toHaveTextContent('Sắp tới 0');
  });

  it('★ back from a trip lands on the tab the driver left', async () => {
    // The back link's own target is the bare /driver (today); only returning
    // through history keeps `?view=upcoming`.
    const tomorrow = turn('a-next', { scheduledOn: '2026-08-31' });
    fetchMyAssignments.mockResolvedValue([tomorrow]);
    fetchMyAssignment.mockResolvedValue(tomorrow);
    renderAt('/driver?view=upcoming');

    fireEvent.click(await screen.findByRole('link', { name: /Xem chuyến/ }));
    expect(await screen.findByText('Thứ Hai, 31/08/2026')).toBeInTheDocument();
    expect(fetchMyAssignment).toHaveBeenCalledWith('a-next');

    fireEvent.click(screen.getByRole('link', { name: 'Quay lại' }));

    expect(await screen.findByRole('link', { name: /Xem chuyến/ })).toHaveAttribute('href', '/driver/assignments/a-next');
    expect(tab('Sắp tới')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/driver\?view=upcoming$/);
  });
});

describe('★ the trip detail reads the workflow', () => {
  it('before pickup: pickup is the stage, the pickup card is live and offers the arrival', async () => {
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([true, false, false, false]);
    expect(screen.getByText('Đã phân công')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tôi đã đến điểm lấy hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /giao hàng/i })).toBeNull();
    // Both ends are on screen from the start, with their own addresses.
    expect(screen.getByText('KHO 3SC')).toBeInTheDocument();
    expect(screen.getByText('Hoàn tất các bước vận chuyển ở trên trước')).toBeInTheDocument();
  });

  it.each([
    { at: 'before pickup', events: [], pickup: 'Việc tiếp theo', delivery: 'Chưa đến' },
    { at: 'pickup confirmed', events: JOURNEY.slice(0, 2), pickup: 'Đã xong', delivery: 'Việc tiếp theo' },
    { at: 'delivery confirmed', events: JOURNEY, pickup: 'Đã xong', delivery: 'Đã xong' },
  ])('$at: the pickup card’s pill reads “$pickup”, the delivery card’s “$delivery”', async ({ events, pickup, delivery }) => {
    fetchMyAssignment.mockResolvedValue(trip({ events }));
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(within(cardHeader('Điểm lấy hàng')).getByText(pickup)).toBeInTheDocument();
    expect(within(cardHeader('Điểm giao hàng')).getByText(delivery)).toBeInTheDocument();
  });

  it('pickup confirmed: delivery becomes the stage and the pickup card reads done', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED')] }));
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, true, false, false]);
    expect(screen.getByText('Đang vận chuyển')).toBeInTheDocument();
    expect(screen.getByText('Đã xong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tôi đã đến điểm giao hàng' })).toBeInTheDocument();
  });

  it('delivery confirmed: the expense checkpoint is the stage and the journey is closed', async () => {
    fetchMyAssignment.mockResolvedValue(trip({ events: JOURNEY }));
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, true, false]);
    expect(screen.getByText('Chờ gửi hoàn tất')).toBeInTheDocument();
    expect(screen.getByText('Đã hoàn tất các bước vận chuyển')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tôi đã đến/i })).toBeNull();
    expect(screen.getByText('Chuyến này có phát sinh chi phí không?')).toBeInTheDocument();
    // The summary shows the SERVER's times and the figures — none yet.
    expect(screen.getByText('Lấy hàng lúc')).toBeInTheDocument();
    expect(screen.getByText('Giao hàng lúc')).toBeInTheDocument();
    expect(screen.getByText('Không có khoản chi')).toBeInTheDocument();
  });

  it('completion pending: the review is the stage, figures locked, summary totals the driver’s lines', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: JOURNEY,
        expenses: [cost({ state: 'locked' }), cost({ id: 'c2', category: 'toll', amount: '130000.00', state: 'locked' })],
        accountability: 'DECLARED_WITH_EXPENSE',
        completion: completion('pending'),
      }),
    );
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, false, true]);
    expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('Đã gửi — đang chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('Đã gửi')).toBeInTheDocument();
    expect(screen.getByText('Đang chờ duyệt — chưa sửa được')).toBeInTheDocument();
    expect(screen.getByText('2 khoản · 330,000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
  });

  it.each([
    ['expenses', 'Đã khai: có phát sinh'],
    ['none', 'Đã khai: không phát sinh'],
  ])('completion pending (%s): the caption names the attempt, when it was sent, then what it declared', async (expenseDeclaration, declared) => {
    fetchMyAssignment.mockResolvedValue(trip({ events: JOURNEY, completion: completion('pending', { expenseDeclaration }) }));
    renderAt('/driver/assignments/a1');

    // `submittedAt` on the viewer's clock (TZ=UTC under test), then its date.
    const caption = await screen.findByText(/^Lần gửi 1: /);
    expect(caption).toHaveTextContent('Lần gửi 1: 02:00 · 30/8/2026');
    expect(caption).toHaveTextContent(declared);
  });

  it('★ rejected: the expense card says so with the reason, lines are editable, and resending is a separate tap', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: JOURNEY,
        expenses: [cost()],
        accountability: 'REJECTED_NEEDS_CORRECTION',
        completion: completion('rejected', { decisionReason: 'Thiếu hoá đơn dầu.', decidedBy: 'b1', decidedAt: AT }),
      }),
    );
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, true, false]);
    expect(screen.getByText('Bị trả lại')).toBeInTheDocument();
    expect(screen.getByText('Đã từ chối')).toBeInTheDocument();
    expect(screen.getByText('Bị từ chối — cần sửa')).toBeInTheDocument();
    expect(screen.getAllByText('Thiếu hoá đơn dầu.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chỉnh sửa và gửi lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại' })).toBeInTheDocument();
  });

  it('approved: every stage is done, the status says so, and nothing can be edited or reopened', async () => {
    fetchMyAssignment.mockResolvedValue(
      trip({
        events: JOURNEY,
        expenses: [cost({ state: 'immutable' })],
        accountability: 'APPROVED_IMMUTABLE',
        completion: completion('approved', { decidedBy: 'b1', decidedAt: AT }),
      }),
    );
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(stepper().map((s) => s.current)).toEqual([false, false, false, false]);
    expect(screen.getByText('Lượt xe của bạn đã được duyệt')).toBeInTheDocument();
    expect(screen.queryByText(/chuyến đã hoàn tất/i)).toBeNull();
    // Twice: the status pill, and the expense line's own state.
    expect(screen.getAllByText('Đã duyệt')).toHaveLength(2);
    expect(screen.getByText('Đã duyệt — không sửa được')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
    expect(screen.queryByRole('button', { name: /thêm khoản chi/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /gửi/i })).toBeNull();
    expect(screen.queryByText(/mở lại|reopen/i)).toBeNull();
  });

  /**
   * ★ ONE TURN APPROVED, THE OTHER STILL WAITING (ADR-0004). The trip is not
   * finished, and the driver's screen for the approved turn must not say it is.
   */
  it('★ an approved turn on a trip whose other turn is still pending never reads as "trip completed"', async () => {
    fetchMyAssignments.mockResolvedValue([trip(), turn('a2', { vehicle: { id: 'v2', plate: '51D-00002' } })]);
    fetchMyAssignment.mockImplementation(async (id: string) =>
      id === 'a1'
        ? trip({
            events: JOURNEY,
            accountability: 'APPROVED_IMMUTABLE',
            completion: completion('approved', { decidedBy: 'b1', decidedAt: AT }),
          })
        : turn('a2', {
            events: JOURNEY,
            accountability: 'DECLARED_NO_EXPENSE',
            completion: completion('pending', { id: 'r2', driverAssignmentId: 'a2', expenseDeclaration: 'none' }),
          }),
    );
    renderAt('/driver/assignments/a1');
    await screen.findByText('Kho HCM');

    expect(screen.getByText('Lượt xe của bạn đã được duyệt')).toBeInTheDocument();
    expect(screen.queryByText(/chuyến đã hoàn tất|trip completed/i)).toBeNull();
    // This turn's status, not the sibling's.
    expect(screen.queryByText('Chờ duyệt')).toBeNull();
  });
});
