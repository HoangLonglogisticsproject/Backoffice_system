import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TripSchedulePage from './TripSchedulePage';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Toaster } from '@/components/ui/sonner';
import { ApiError } from '@/utils/errors';

const fetchTripSchedules = vi.fn();
const archiveTripSchedule = vi.fn();
const updateTripStatus = vi.fn();
const updateTripSchedule = vi.fn();
const fetchTripVehicles = vi.fn();
const fetchTripCustomers = vi.fn();
const useSession = vi.fn();

const createTripSchedule = vi.fn();
const fetchAllTripSchedules = vi.fn();
vi.mock('@/api/tripSchedule', () => ({
  fetchTripSchedules: (...a: unknown[]) => fetchTripSchedules(...a),
  fetchAllTripSchedules: (...a: unknown[]) => fetchAllTripSchedules(...a),
  archiveTripSchedule: (...a: unknown[]) => archiveTripSchedule(...a),
  createTripSchedule: (...a: unknown[]) => createTripSchedule(...a),
  updateTripSchedule: (...a: unknown[]) => updateTripSchedule(...a),
  updateTripStatus: (...a: unknown[]) => updateTripStatus(...a),
}));
const fetchEligibleDrivers = vi.fn();
const assignDriver = vi.fn();
const replaceDriver = vi.fn();
vi.mock('@/api/tripAssignment', () => ({
  fetchEligibleDrivers: (...a: unknown[]) => fetchEligibleDrivers(...a),
  fetchDriverAssignments: vi.fn(),
  assignDriver: (...a: unknown[]) => assignDriver(...a),
  replaceDriver: (...a: unknown[]) => replaceDriver(...a),
  endDriverAssignment: vi.fn(),
}));
const fetchTripLocations = vi.fn();
const createTripLocation = vi.fn();
vi.mock('@/api/tripCatalogue', () => ({
  fetchTripVehicles: (...a: unknown[]) => fetchTripVehicles(...a),
  fetchTripCustomers: (...a: unknown[]) => fetchTripCustomers(...a),
  createTripVehicle: vi.fn(),
  createTripCustomer: vi.fn(),
  fetchTripLocations: (...a: unknown[]) => fetchTripLocations(...a),
  createTripLocation: (...a: unknown[]) => createTripLocation(...a),
  updateTripLocation: vi.fn(),
  archiveTripLocation: vi.fn(),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const session = (permissions: string[]) => ({
  state: {
    status: 'ready',
    authorization: {
      userId: 'u1',
      username: 'dispatch',
      role: 'MEMBER',
      departmentIds: [],
      permissions,
    },
  },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

const trip = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  scheduledOn: '2026-08-04',
  vehicleId: 'v1',
  vehicle: { id: 'v1', plate: '50H-49266' },
  customerId: 'c1',
  customer: { id: 'c1', name: 'WWL' },
  cargoInfo: '17CTN / 1.22CBM',
  pickupAddress: 'BÃI XE MIỀN NAM',
  deliveryAddress: 'TCS',
  pickupContact: null,
  deliveryContact: null,
  pickupAt: null,
  deliveryAt: null,
  price: null,
  note: null,
  status: 'confirmed',
  createdBy: 'u9',
  createdByUser: { id: 'u9', displayName: 'Điều Độ' },
  driver: null,
  pickupLocationId: null,
  deliveryLocationId: null,
  pickupLocation: null,
  deliveryLocation: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

/**
 * A FRESH CACHE PER TEST, and retries off.
 *
 * The trip hooks are TanStack queries now, so a client shared between tests
 * would let one test's cached page satisfy the next test's read — and the
 * assertion "the first request is bounded to this month" would pass without a
 * request being made at all. Retries off because two of these tests assert on
 * an error state, and the default policy would make them wait out the backoff.
 */
const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dispatch/trip-schedule']}>
        <LanguageProvider>
          <TripSchedulePage />
          {/* The status control has no error line of its own: a refusal is
              announced by `useUpdateTripStatus` as a toast, the way it is in the
              real app (`main.tsx`). Mounted here so the test still asserts what
              a dispatcher actually reads. */}
          <Toaster />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/**
 * What the dispatch board OFFERS, and what it says.
 *
 * ⚠ NONE OF THIS IS AUTHORIZATION. The server re-decides every request, and a
 * 403 is a state this page renders rather than an accident. These assertions
 * are about the buttons drawn and the values sent — never about what is
 * permitted.
 */
describe('TripSchedulePage', () => {
  beforeEach(() => {
    fetchTripSchedules.mockReset().mockResolvedValue({
      items: [trip()],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    archiveTripSchedule.mockReset().mockResolvedValue(trip());
    updateTripStatus.mockReset().mockResolvedValue(trip({ status: 'finished' }));
    updateTripSchedule.mockReset().mockResolvedValue(trip());
    createTripSchedule.mockReset().mockResolvedValue(trip());
    fetchTripVehicles.mockReset().mockResolvedValue([]);
    fetchTripCustomers.mockReset().mockResolvedValue([]);
    fetchTripLocations.mockReset().mockResolvedValue([]);
    createTripLocation.mockReset();
    fetchEligibleDrivers.mockReset().mockResolvedValue([
      { id: 'd1', displayName: 'Tài Xế A' },
      { id: 'd2', displayName: 'Tài Xế B' },
    ]);
    assignDriver.mockReset().mockResolvedValue({ id: 'a1', driverUserId: 'd1' });
    replaceDriver.mockReset().mockResolvedValue({ id: 'a2', driverUserId: 'd2' });
    useSession.mockReset().mockReturnValue(session(['trip.read', 'trip.create']));
  });

  /**
   * ★ WHO IS DRIVING, AND WHO DECIDES. The column reads the board; the button
   * is drawn for `trip.write` and never for a driver — the portal has no such
   * control at all, and the server refuses a driver account the route.
   */
  /** The dialog's submit shares its label with the row button; the dialog renders last. */
  const last = (elements: HTMLElement[]): HTMLElement => elements[elements.length - 1]!;

  /**
   * The reads that fetch the LIST, not the badge.
   *
   * ★ THE BOARD MAKES TWO READS PER SETTLED FILTER NOW. One is the page the
   * table shows; the other asks for a single row with `assignment: 'unassigned'`
   * purely to read `total` for the count on the tab. Counting raw calls would
   * make every assertion below about the debounce and the re-read pass — or
   * fail — for a reason that has nothing to do with what it is testing.
   */
  const listCalls = () =>
    fetchTripSchedules.mock.calls.filter(
      ([request]) => (request as { limit?: number }).limit !== 1,
    );

  describe('driver assignment', () => {
    it('shows "not assigned" and no control to a reader', async () => {
      renderPage();

      expect(await screen.findByText(/chưa phân công/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^phân công$/i })).not.toBeInTheDocument();
    });

    it('shows the driver on the row', async () => {
      fetchTripSchedules.mockResolvedValue({
        items: [trip({ driver: { id: 'd1', displayName: 'Tài Xế A' } })],
        page: 1, limit: 20, total: 1, totalPages: 1,
      });
      renderPage();

      expect(await screen.findByText('Tài Xế A')).toBeInTheDocument();
    });

    it('★ assigns from the eligible list, sending the id and nothing else', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.write']));
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /^phân công$/i }));
      const select = await screen.findByLabelText(/chọn tài xế/i);
      await waitFor(() => expect(fetchEligibleDrivers).toHaveBeenCalled());
      await screen.findByRole('option', { name: 'Tài Xế B' });
      fireEvent.change(select, { target: { value: 'd2' } });
      fireEvent.click(last(screen.getAllByRole('button', { name: /^phân công$/i })));

      await waitFor(() => expect(assignDriver).toHaveBeenCalledWith('t1', 'd2'));
      // The board is re-read; the server's row is what the screen shows next.
      await waitFor(() => expect(listCalls().length).toBeGreaterThan(1));
    });

    it('★ replaces with a reason, and offers only the OTHER drivers', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.write']));
      fetchTripSchedules.mockResolvedValue({
        items: [trip({ driver: { id: 'd1', displayName: 'Tài Xế A' } })],
        page: 1, limit: 20, total: 1, totalPages: 1,
      });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /thay đổi/i }));
      await screen.findByRole('option', { name: 'Tài Xế B' });
      expect(screen.queryByRole('option', { name: 'Tài Xế A' })).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/chọn tài xế/i), { target: { value: 'd2' } });
      fireEvent.change(screen.getByLabelText(/lý do/i), { target: { value: 'đổi ca' } });
      fireEvent.click(last(screen.getAllByRole('button', { name: /thay đổi/i })));

      await waitFor(() =>
        expect(replaceDriver).toHaveBeenCalledWith('t1', { driverUserId: 'd2', reason: 'đổi ca' }),
      );
    });

    it('★ tells the dispatcher the board moved on a 409, and re-reads it', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.write']));
      assignDriver.mockRejectedValue(new ApiError(409, 'CONFLICT', 'That trip already has a driver.'));
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /^phân công$/i }));
      await screen.findByRole('option', { name: 'Tài Xế B' });
      fireEvent.change(screen.getByLabelText(/chọn tài xế/i), { target: { value: 'd2' } });
      fireEvent.click(last(screen.getAllByRole('button', { name: /^phân công$/i })));

      expect(await screen.findByRole('alert')).toHaveTextContent(/vừa thay đổi/i);
      await waitFor(() => expect(listCalls().length).toBeGreaterThan(1));
    });

    it('offers no assignment control on a finished trip', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.write']));
      fetchTripSchedules.mockResolvedValue({
        items: [trip({ status: 'finished', driver: { id: 'd1', displayName: 'Tài Xế A' } })],
        page: 1, limit: 20, total: 1, totalPages: 1,
      });
      renderPage();

      expect(await screen.findByText('Tài Xế A')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /thay đổi/i })).not.toBeInTheDocument();
    });
  });

  it('opens on the current month, so the first request is already bounded', async () => {
    // The bounded range is not cosmetic: it is the premise ADR-0003 attaches to
    // using offset pagination here at all. A first render that asked for the
    // list unbounded would break that premise on page load.
    renderPage();

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));

    const [request] = listCalls()[0] as [{ from: string; to: string }];
    expect(request.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(request.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    expect(request.from).toBe(`${now.getFullYear()}-${month}-01`);
  });

  it('★ renders the trip date as the calendar day it is, without shifting it', async () => {
    // `new Date('2026-08-04')` is midnight UTC, so a naive render shows 3 August
    // to every viewer west of UTC. The day is `04` and must stay `04`.
    renderPage();

    const cell = await screen.findByText(/2026|4\/8|8\/4|04/);
    expect(cell).toBeTruthy();
    expect(screen.queryByText(/2026-08-03/)).toBeNull();
  });

  it('shows the row, its vehicle, its customer and who entered it', async () => {
    renderPage();

    expect(await screen.findByText('50H-49266')).toBeTruthy();
    expect(screen.getByText('WWL')).toBeTruthy();
    expect(screen.getByText('Điều Độ')).toBeTruthy();
  });

  it('translates the status rather than printing the raw enum', async () => {
    renderPage();

    await screen.findByText('50H-49266');
    expect(screen.queryByText('confirmed')).toBeNull();
    expect(screen.getByText('Đã xác nhận')).toBeTruthy();
  });

  it('shows the total — the number a cursor list cannot produce', async () => {
    renderPage();
    expect(await screen.findByText(/Tổng số dòng: 1/)).toBeTruthy();
  });

  describe('what each caller is offered', () => {
    it('offers "add" to anybody holding trip.create', async () => {
      renderPage();
      expect(await screen.findByRole('button', { name: 'Thêm chuyến' })).toBeTruthy();
    });

    it('★ offers no edit or archive control without trip.write', async () => {
      renderPage();

      await screen.findByText('50H-49266');
      expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Lưu trữ' })).toBeNull();
    });

    it('offers both to a caller holding trip.write', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.create', 'trip.write']));
      renderPage();

      await screen.findByText('50H-49266');
      expect(screen.getByRole('button', { name: 'Sửa' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Lưu trữ' })).toBeTruthy();
    });

    it('hides the add button from a caller without trip.create', async () => {
      useSession.mockReturnValue(session(['trip.read']));
      renderPage();

      await screen.findByText('50H-49266');
      expect(screen.queryByRole('button', { name: 'Thêm chuyến' })).toBeNull();
    });
  });

  describe('moving a trip along the board', () => {
    const write = ['trip.read', 'trip.create', 'trip.write'];

    it('★ changes the status from the row, through the status endpoint', async () => {
      // Not through the edit form and not through the full PATCH: that would
      // send every field back, overwriting whatever a colleague changed while
      // the form sat open. The dedicated endpoint sends one value.
      useSession.mockReturnValue(session(write));
      renderPage();

      const select = await screen.findByLabelText('Đổi trạng thái');
      // ★ NOT `done`. The board cannot set it — a trip is finished by approving
      // its completion request — so a case that moved a row to `done` was
      // asserting an interaction the server answers with 409.
      fireEvent.change(select, { target: { value: 'executing' } });

      await waitFor(() => expect(updateTripStatus).toHaveBeenCalledWith('t1', 'executing'));
    });

    it('shows the new status immediately, before the server answers', async () => {
      // A click that waits for a round trip before showing anything is a click
      // people make twice.
      let settle: (value: unknown) => void = () => {};
      updateTripStatus.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

      useSession.mockReturnValue(session(write));
      renderPage();

      const select = await screen.findByLabelText('Đổi trạng thái');
      fireEvent.change(select, { target: { value: 'executing' } });

      await waitFor(() => expect((select as HTMLSelectElement).value).toBe('executing'));
      settle(trip({ status: 'executing' }));
    });

    /**
     * ★ THE TWO THINGS BD-01 EXISTS TO STOP OFFERING.
     *
     * The server refuses both with 409 — `requireNotCompletionOnly` on the way
     * in, `canTransition` on the way out, and a trigger in 0017 behind them. A
     * control whose only possible outcome is a refusal is not a control.
     */
    it('★ never offers `finished` on the board — a trip is finished by approval', async () => {
      useSession.mockReturnValue(session(write));
      renderPage();

      const select = (await screen.findByLabelText('Đổi trạng thái')) as HTMLSelectElement;
      const options = [...select.options].map((option) => option.value);

      expect(options).not.toContain('finished');
      // The three that ARE a dispatcher's to choose are all still there.
      expect(options).toEqual(expect.arrayContaining(['pending', 'confirmed', 'executing']));
    });

    it('★ shows a finished trip as a badge, not a dropdown', async () => {
      fetchTripSchedules.mockResolvedValue({
        items: [trip({ status: 'finished' })],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      useSession.mockReturnValue(session(write));
      renderPage();

      // The label the badge carries, and no control to change it.
      expect(await screen.findByText('Hoàn thành')).toBeInTheDocument();
      expect(screen.queryByLabelText('Đổi trạng thái')).not.toBeInTheDocument();
    });

    /**
     * ★ THE UNDO IS A WRITE, NOT A REWIND. The button sends a fresh PATCH back to
     * the status the row held before the click, so the server decides it the same
     * way it decided the change — nothing here edits the cache and calls it done.
     */
    it('★ offers Hoàn tác on the receipt, and sends the trip back to where it was', async () => {
      useSession.mockReturnValue(session(write));
      renderPage();

      const select = await screen.findByLabelText('Đổi trạng thái');
      fireEvent.change(select, { target: { value: 'executing' } });

      await waitFor(() =>
        expect(updateTripStatus).toHaveBeenCalledWith('t1', 'executing'),
      );

      // The move itself, on the toast: which way this row went. Waited for
      // rather than found immediately — the receipt is raised after the server
      // answers, and sonner mounts it a frame later still.
      await waitFor(() =>
        expect(document.querySelector('[data-sonner-toaster]')?.textContent).toContain(
          'Đã xác nhận → Đang thực hiện',
        ),
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Hoàn tác' }));

      await waitFor(() =>
        expect(updateTripStatus).toHaveBeenLastCalledWith('t1', 'confirmed'),
      );
    });

    it('★ puts the old status back when the server refuses, and says why', async () => {
      const { ApiError } = await import('@/utils/errors');
      updateTripStatus.mockRejectedValue(
        new ApiError(409, 'TRIP_ARCHIVED', 'This trip has been archived.'),
      );

      useSession.mockReturnValue(session(write));
      renderPage();

      const select = await screen.findByLabelText('Đổi trạng thái');
      fireEvent.change(select, { target: { value: 'executing' } });

      expect(await screen.findByText('This trip has been archived.')).toBeTruthy();
      // The optimistic guess is gone, not left on screen as if it had worked —
      // back to the status the row actually holds.
      await waitFor(() => expect((select as HTMLSelectElement).value).toBe('confirmed'));
    });

    it('offers a reader without trip.write a label, not a control', async () => {
      useSession.mockReturnValue(session(['trip.read']));
      renderPage();

      await screen.findByText('50H-49266');
      expect(screen.queryByLabelText('Đổi trạng thái')).toBeNull();
      // Still readable — the status is not hidden, only not editable.
      expect(screen.getByText('Đã xác nhận')).toBeTruthy();
    });
  });

  /**
   * ★ THE EXPORT BELONGS TO ONE TAB, AND THAT IS THE WHOLE OF ITS CONTRACT HERE.
   *
   * The file is named after a date range and holds the entire board for it. On
   * "Chờ phân công" that same file would be read as the month's record while
   * quietly missing every crewed trip — so there is no button there rather than
   * a button that means something different. What the button DOES once pressed
   * is pinned in `TripScheduleExportButton.spec`.
   */
  describe('exporting the board', () => {
    it('★ offers the export on “Tất cả” and nowhere else', async () => {
      useSession.mockReturnValue(session(['trip.read']));
      renderPage();

      await screen.findByText('50H-49266');
      expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: /Chờ phân công/ }));

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Xuất Excel' })).toBeNull(),
      );
    });

    /**
     * The tabs are a `role="tablist"`, and a tablist may contain tabs and
     * nothing else. Moving the border out to a wrapping row is what let the
     * button sit beside them without landing inside it.
     */
    it('keeps the button out of the tablist', async () => {
      useSession.mockReturnValue(session(['trip.read']));
      renderPage();

      await screen.findByText('50H-49266');

      const tablist = screen.getByRole('tablist');
      expect(within(tablist).queryByRole('button', { name: 'Xuất Excel' })).toBeNull();
    });
  });

  /**
   * ★ A RETIRED TRUCK STILL HAS TO SHOW ON THE TRIP THAT USED IT.
   *
   * The catalogue endpoints return ACTIVE rows only, so the picker's options
   * never contain a retired plate. A `<select>` whose value matches none of its
   * options renders BLANK — so the plate disappeared from the edit form, and
   * touching the control silently replaced a historical assignment.
   *
   * These assert the two halves that matter: the reference SURVIVES a save that
   * did not touch it, and a retired row is never offered as an ordinary choice.
   */

  /**
   * ★ THE FORM NAMES THE CUSTOMER'S PLACE, AND NEVER A COORDINATE (GAP-14,
   * second half). A dispatcher does not know coordinates; the place carries
   * them, entered once as master data, and the server copies them onto the
   * trip. These cases pin what the form offers and what it sends.
   */
  describe('★ the trip form names the customer’s places', () => {
    const write = ['trip.read', 'trip.create', 'trip.write'];
    const place = (over: Record<string, unknown> = {}) => ({
      id: 'l1',
      customerId: 'c9',
      name: 'Kho OSC',
      address: 'KCN Sóng Thần, Dĩ An',
      contact: '0909 111 222',
      note: null,
      latitude: 10.8,
      longitude: 106.6,
      status: 'active',
      createdBy: 'u9',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      ...over,
    });

    const openAddForm = async () => {
      useSession.mockReturnValue(session(write));
      fetchTripCustomers.mockResolvedValue([
        { id: 'c9', name: 'WWL', note: null, status: 'active' },
        { id: 'c8', name: 'VIỄN ĐẠT', note: null, status: 'active' },
      ]);
      fetchTripLocations.mockImplementation(async (customerId: string) =>
        customerId === 'c9'
          ? [place(), place({ id: 'l2', name: 'Nhà máy Bình Dương', address: 'Bình Dương', contact: null, latitude: null, longitude: null })]
          : [],
      );
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(screen.getByRole('button', { name: 'Thêm chuyến' }));
      await screen.findByLabelText('Khách hàng');
    };

    const chooseCustomer = async (id: string) => {
      fireEvent.change(screen.getByLabelText('Khách hàng'), { target: { value: id } });
      await waitFor(() => expect(fetchTripLocations).toHaveBeenCalledWith(id, false));
    };

    it('★ offers no coordinate input anywhere on the trip form', async () => {
      await openAddForm();
      await chooseCustomer('c9');

      expect(screen.queryByPlaceholderText('Vĩ độ')).toBeNull();
      expect(screen.queryByPlaceholderText('Kinh độ')).toBeNull();
      expect(screen.queryByLabelText(/vĩ độ|kinh độ/i)).toBeNull();
    });

    it('keeps the place pickers closed until a customer is chosen', async () => {
      await openAddForm();

      expect(screen.getByLabelText('Điểm lấy hàng')).toBeDisabled();
      expect(screen.getByLabelText('Điểm giao hàng')).toBeDisabled();
      expect(fetchTripLocations).not.toHaveBeenCalled();
    });

    it('★ lists the chosen customer’s places, shows the address read-only, and sends the id — no coordinate', async () => {
      await openAddForm();
      await chooseCustomer('c9');

      const pickup = await screen.findByLabelText('Điểm lấy hàng');
      await within(pickup).findByRole('option', { name: 'Kho OSC' });
      fireEvent.change(pickup, { target: { value: 'l1' } });

      expect(screen.getByText('KCN Sóng Thần, Dĩ An')).toBeInTheDocument();
      expect(screen.getByText('0909 111 222')).toBeInTheDocument();
      expect(screen.getByText('Đã định vị')).toBeInTheDocument();
      // The typed-address fields for that end are gone: the place is the source.
      expect(screen.queryByLabelText('Địa chỉ lấy hàng')).toBeNull();

      fireEvent.change(screen.getByLabelText('Ngày chạy'), { target: { value: '2026-09-01' } });
      const saves = screen.getAllByRole('button', { name: 'Lưu' });
      fireEvent.click(saves[saves.length - 1]!);

      await waitFor(() => expect(createTripSchedule).toHaveBeenCalled());
      const [body] = createTripSchedule.mock.calls[0] as [Record<string, unknown>];
      expect(body).toMatchObject({ customerId: 'c9', pickupLocationId: 'l1', pickupAddress: null, deliveryLocationId: null });
      for (const key of ['pickupLatitude', 'pickupLongitude', 'deliveryLatitude', 'deliveryLongitude']) {
        expect(body).not.toHaveProperty(key);
      }
    });

    it('★ warns, before the trip exists, that an unlocated place cannot be confirmed by GPS', async () => {
      await openAddForm();
      await chooseCustomer('c9');
      const delivery = screen.getByLabelText('Điểm giao hàng');
      await within(delivery).findByRole('option', { name: 'Nhà máy Bình Dương' });

      fireEvent.change(delivery, { target: { value: 'l2' } });

      expect(screen.getByRole('status')).toHaveTextContent(/chưa có toạ độ/i);
      expect(screen.queryByText('Đã định vị')).toBeNull();
    });

    it('★ drops a chosen place the moment the customer changes, and says the new one has none', async () => {
      await openAddForm();
      await chooseCustomer('c9');
      await within(screen.getByLabelText('Điểm lấy hàng')).findByRole('option', { name: 'Kho OSC' });
      fireEvent.change(screen.getByLabelText('Điểm lấy hàng'), { target: { value: 'l1' } });
      expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe('l1');

      await chooseCustomer('c8');

      await waitFor(() =>
        expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe(''),
      );
      expect(screen.queryAllByRole('option', { name: 'Kho OSC' })).toHaveLength(0);
      expect(screen.getAllByText('Khách hàng chưa có địa điểm.').length).toBeGreaterThan(0);
    });

    it('keeps the hand-typed address for an end with no place, as before', async () => {
      await openAddForm();
      await chooseCustomer('c9');

      fireEvent.change(screen.getByLabelText('Địa chỉ giao hàng'), { target: { value: 'Bãi tạm Q9' } });
      fireEvent.change(screen.getByLabelText('Ngày chạy'), { target: { value: '2026-09-01' } });
      const saves = screen.getAllByRole('button', { name: 'Lưu' });
      fireEvent.click(saves[saves.length - 1]!);

      await waitFor(() => expect(createTripSchedule).toHaveBeenCalled());
      const [body] = createTripSchedule.mock.calls[0] as [Record<string, unknown>];
      expect(body).toMatchObject({ deliveryLocationId: null, deliveryAddress: 'Bãi tạm Q9' });
    });


    it('★ editing a trip: switching customer clears the old customer’s places and submits none of them', async () => {
      useSession.mockReturnValue(session(write));
      fetchTripSchedules.mockResolvedValue({
        items: [
          trip({
            customerId: 'c1',
            customer: { id: 'c1', name: 'WWL' },
            pickupLocationId: 'la',
            pickupLocation: { id: 'la', name: 'Kho A' },
            deliveryLocationId: 'lb',
            deliveryLocation: { id: 'lb', name: 'Nhà máy A' },
          }),
        ],
        page: 1, limit: 20, total: 1, totalPages: 1,
      });
      fetchTripCustomers.mockResolvedValue([
        { id: 'c1', name: 'WWL', note: null, status: 'active' },
        { id: 'c9', name: 'VIỄN ĐẠT', note: null, status: 'active' },
      ]);
      fetchTripLocations.mockImplementation(async (customerId: string) =>
        customerId === 'c1' ? [place({ id: 'la', customerId: 'c1', name: 'Kho A' }), place({ id: 'lb', customerId: 'c1', name: 'Nhà máy A' })] : [],
      );
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
      await screen.findByLabelText('Khách hàng');
      await waitFor(() => expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe('la'));

      await chooseCustomer('c9');

      await waitFor(() => expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe(''));
      expect((screen.getByLabelText('Điểm giao hàng') as HTMLSelectElement).value).toBe('');
      expect(screen.queryAllByRole('option', { name: 'Kho A' })).toHaveLength(0);

      const saves = screen.getAllByRole('button', { name: 'Lưu' });
      fireEvent.click(saves[saves.length - 1]!);

      await waitFor(() => expect(updateTripSchedule).toHaveBeenCalled());
      const [, body] = updateTripSchedule.mock.calls[0] as [string, Record<string, unknown>];
      expect(body).toMatchObject({ customerId: 'c9', pickupLocationId: null, deliveryLocationId: null });
      expect(body.pickupLocationId).not.toBe('la');
    });

    /**
     * ★ A PLACE THAT HAS SINCE BEEN ARCHIVED IS STILL THE TRIP'S PLACE. The
     * active list no longer carries it, so the form shows the trip's own copy
     * — read-only, like any chosen place — keeps it selected, and leaves that
     * end OUT of the patch: the server would refuse a fresh copy of an
     * archived place, and nothing about the end changed.
     */
    describe('★ editing a trip whose place has since been archived', () => {
      const openEdit = async (over: Record<string, unknown>) => {
        useSession.mockReturnValue(session(write));
        fetchTripSchedules.mockResolvedValue({
          items: [trip({ customerId: 'c1', customer: { id: 'c1', name: 'WWL' }, ...over })],
          page: 1, limit: 20, total: 1, totalPages: 1,
        });
        fetchTripCustomers.mockResolvedValue([{ id: 'c1', name: 'WWL', note: null, status: 'active' }]);
        // Only the still-active place comes back for the customer.
        fetchTripLocations.mockImplementation(async (customerId: string) =>
          customerId === 'c1' ? [place({ id: 'lb', customerId: 'c1', name: 'Nhà máy A', address: 'Bình Dương' })] : [],
        );
        renderPage();
        await screen.findByText('WWL');
        fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
        await screen.findByLabelText('Khách hàng');
        await waitFor(() => expect(fetchTripLocations).toHaveBeenCalledWith('c1', false));
      };

      // The board row behind the dialog prints the same address: read the dialog.
      const dialog = () => within(screen.getByRole('dialog'));

      const save = async () => {
        const saves = screen.getAllByRole('button', { name: 'Lưu' });
        fireEvent.click(saves[saves.length - 1]!);
        await waitFor(() => expect(updateTripSchedule).toHaveBeenCalled());
        return updateTripSchedule.mock.calls[0]![1] as Record<string, unknown>;
      };

      const archivedPickup = {
        pickupLocationId: 'la',
        pickupLocation: { id: 'la', name: 'Kho A' },
        pickupAddress: 'Kho A cũ, Dĩ An',
        pickupContact: '0909 000 111',
        pickupLatitude: null,
        pickupLongitude: null,
      };

      it('★ pickup: shows the trip’s copy read-only, keeps it selected, and does not name it in the patch', async () => {
        await openEdit(archivedPickup);
        const pickup = screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement;
        await within(pickup).findByRole('option', { name: 'Kho A (Đã lưu trữ)' });

        expect(pickup.value).toBe('la');
        expect(dialog().getByText('Kho A cũ, Dĩ An')).toBeTruthy();
        expect(dialog().getByText('0909 000 111')).toBeTruthy();
        expect(screen.queryByLabelText('Địa chỉ lấy hàng')).toBeNull();
        expect(screen.queryByLabelText('Liên hệ lấy hàng')).toBeNull();

        const body = await save();
        expect(body).not.toHaveProperty('pickupLocationId');
        expect(body).not.toHaveProperty('pickupAddress');
        expect(body).not.toHaveProperty('pickupContact');
        // The other end has no place: its typed address travels as before.
        expect(body).toMatchObject({ deliveryLocationId: null, deliveryAddress: 'TCS' });
      });

      it('delivery: the same, on the other end', async () => {
        await openEdit({
          deliveryLocationId: 'ld',
          deliveryLocation: { id: 'ld', name: 'Nhà máy cũ' },
          deliveryAddress: 'Thuận An',
          deliveryContact: null,
        });
        const delivery = screen.getByLabelText('Điểm giao hàng') as HTMLSelectElement;
        await within(delivery).findByRole('option', { name: 'Nhà máy cũ (Đã lưu trữ)' });

        expect(delivery.value).toBe('ld');
        expect(dialog().getByText('Thuận An')).toBeTruthy();
        expect(screen.queryByLabelText('Địa chỉ giao hàng')).toBeNull();
        expect(screen.queryByLabelText('Liên hệ giao hàng')).toBeNull();

        const body = await save();
        expect(body).not.toHaveProperty('deliveryLocationId');
        expect(body).not.toHaveProperty('deliveryAddress');
        expect(body).toMatchObject({ pickupLocationId: null, pickupAddress: 'BÃI XE MIỀN NAM' });
      });

      it('archived pickup beside an active delivery: both stay chosen, neither is renamed in the patch', async () => {
        await openEdit({
          ...archivedPickup,
          deliveryLocationId: 'lb',
          deliveryLocation: { id: 'lb', name: 'Nhà máy A' },
          deliveryAddress: 'Bình Dương',
        });
        await within(screen.getByLabelText('Điểm giao hàng')).findByRole('option', { name: 'Nhà máy A' });

        expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe('la');
        expect((screen.getByLabelText('Điểm giao hàng') as HTMLSelectElement).value).toBe('lb');
        expect(screen.queryByLabelText('Địa chỉ lấy hàng')).toBeNull();
        expect(screen.queryByLabelText('Địa chỉ giao hàng')).toBeNull();

        const body = await save();
        expect(body).not.toHaveProperty('pickupLocationId');
        expect(body).not.toHaveProperty('deliveryLocationId');
        expect(body).not.toHaveProperty('pickupAddress');
        expect(body).not.toHaveProperty('deliveryAddress');
      });

      it('clearing the archived place frees the end: typed address, and the patch says so', async () => {
        await openEdit(archivedPickup);
        const pickup = screen.getByLabelText('Điểm lấy hàng');
        await within(pickup).findByRole('option', { name: 'Kho A (Đã lưu trữ)' });

        fireEvent.change(pickup, { target: { value: '' } });

        const address = await screen.findByLabelText('Địa chỉ lấy hàng');
        fireEvent.change(address, { target: { value: 'Bãi tạm Q9' } });

        const body = await save();
        expect(body).toMatchObject({ pickupLocationId: null, pickupAddress: 'Bãi tạm Q9' });
      });

      it('choosing an active place instead names it, and the server copies it afresh', async () => {
        await openEdit(archivedPickup);
        const pickup = screen.getByLabelText('Điểm lấy hàng');
        await within(pickup).findByRole('option', { name: 'Nhà máy A' });

        fireEvent.change(pickup, { target: { value: 'lb' } });

        expect(dialog().getByText('Bình Dương')).toBeTruthy();
        expect(dialog().queryByText('Kho A cũ, Dĩ An')).toBeNull();
        const body = await save();
        expect(body).toMatchObject({ pickupLocationId: 'lb', pickupAddress: null, pickupContact: null });
      });
    });

    it('★ keeps the new place selected when the list re-read is slow — the id is set only after the list holds it', async () => {
      await openAddForm();
      await chooseCustomer('c9');
      await within(screen.getByLabelText('Điểm lấy hàng')).findByRole('option', { name: 'Kho OSC' });
      createTripLocation.mockResolvedValue(place({ id: 'l3', name: 'Kho mới', address: 'Thủ Dầu Một' }));

      // The re-read after creating is held until the test releases it.
      let releaseRefetch!: () => void;
      fetchTripLocations.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseRefetch = () => resolve([place(), place({ id: 'l3', name: 'Kho mới', address: 'Thủ Dầu Một' })]);
          }),
      );

      fireEvent.click(screen.getAllByRole('button', { name: 'Thêm địa điểm' })[0]!);
      fireEvent.change(await screen.findByLabelText('Tên địa điểm'), { target: { value: 'Kho mới' } });
      fireEvent.change(screen.getByLabelText('Địa chỉ'), { target: { value: 'Thủ Dầu Một' } });
      const placeSave = screen
        .getAllByRole('button', { name: 'Lưu' })
        .find((button) => button.getAttribute('form') === 'location-form');
      fireEvent.click(placeSave!);

      await waitFor(() => expect(createTripLocation).toHaveBeenCalled());
      // Created, list not yet re-read: nothing selected, nothing cleared, and
      // the new place is not offered from a list that does not have it.
      expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe('');
      expect(screen.queryAllByRole('option', { name: 'Kho mới' })).toHaveLength(0);

      releaseRefetch();

      await waitFor(() =>
        expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe('l3'),
      );
      // And it stays: no later effect run takes it away.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe('l3');
    });

    it('★ creates a new place under the chosen customer and selects it', async () => {
      await openAddForm();
      await chooseCustomer('c9');
      await within(screen.getByLabelText('Điểm lấy hàng')).findByRole('option', { name: 'Kho OSC' });
      createTripLocation.mockResolvedValue(place({ id: 'l3', name: 'Kho mới', address: 'Thủ Dầu Một' }));
      fetchTripLocations.mockImplementation(async () => [place(), place({ id: 'l3', name: 'Kho mới', address: 'Thủ Dầu Một' })]);

      fireEvent.click(screen.getAllByRole('button', { name: 'Thêm địa điểm' })[0]!);
      fireEvent.change(await screen.findByLabelText('Tên địa điểm'), { target: { value: 'Kho mới' } });
      fireEvent.change(screen.getByLabelText('Địa chỉ'), { target: { value: 'Thủ Dầu Một' } });
      // The place dialog sits inside the trip dialog; its Save is the one
      // bound to the place form, not the trip form's.
      const placeSave = screen
        .getAllByRole('button', { name: 'Lưu' })
        .find((button) => button.getAttribute('form') === 'location-form');
      fireEvent.click(placeSave!);

      await waitFor(() =>
        expect(createTripLocation).toHaveBeenCalledWith(
          'c9',
          expect.objectContaining({ name: 'Kho mới', address: 'Thủ Dầu Một', latitude: null, longitude: null }),
        ),
      );
      await waitFor(() =>
        expect((screen.getByLabelText('Điểm lấy hàng') as HTMLSelectElement).value).toBe('l3'),
      );
    });
  });

  describe('★ editing a trip whose vehicle or customer has been retired', () => {
    const write = ['trip.read', 'trip.create', 'trip.write'];

    // The board still joins the plate, because the read does not filter the
    // catalogue by status — only the OPTIONS list does.
    const retiredRefs = () =>
      trip({
        vehicleId: 'gone-v',
        vehicle: { id: 'gone-v', plate: '51D.65233' },
        customerId: 'gone-c',
        customer: { id: 'gone-c', name: 'VIỄN ĐẠT' },
      });

    const openEditor = async () => {
      useSession.mockReturnValue(session(write));
      fetchTripSchedules.mockResolvedValue({
        items: [retiredRefs()],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      // The catalogues have loaded and simply do not contain the retired rows.
      fetchTripVehicles.mockResolvedValue([
        { id: 'v9', plate: '50H-49266', note: null, status: 'active' },
      ]);
      fetchTripCustomers.mockResolvedValue([
        { id: 'c9', name: 'WWL', note: null, status: 'active' },
      ]);

      renderPage();
      // ★ THE BOARD SHOWS `51D-65233` FOR A PLATE STORED AS `51D.65233`, and
      // the OPTION below still shows the stored spelling. That is the split on
      // purpose: the table formats for reading, the editor shows the record.
      await screen.findByText('51D-65233');
      fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
      await screen.findByLabelText('Xe');
    };

    it('renders the retired vehicle as the selected value, not a blank box', async () => {
      await openEditor();

      const select = screen.getByLabelText('Xe') as HTMLSelectElement;
      expect(select.value).toBe('gone-v');
      // Marked, so nobody reads it as a truck still in service.
      expect(screen.getByRole('option', { name: '51D.65233 (Đã lưu trữ)' })).toBeTruthy();
    });

    it('renders the retired customer the same way', async () => {
      await openEditor();

      const select = screen.getByLabelText('Khách hàng') as HTMLSelectElement;
      expect(select.value).toBe('gone-c');
      expect(screen.getByRole('option', { name: 'VIỄN ĐẠT (Đã lưu trữ)' })).toBeTruthy();
    });

    it('★ keeps both references through a save that did not touch them', async () => {
      await openEditor();

      fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'sửa ghi chú' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() => expect(updateTripSchedule).toHaveBeenCalled());

      const [, payload] = updateTripSchedule.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.vehicleId).toBe('gone-v');
      expect(payload.customerId).toBe('gone-c');
      expect(payload.note).toBe('sửa ghi chú');
    });

    it('★ offers the retired rows to NO other trip — they are a value, not an option', async () => {
      useSession.mockReturnValue(session(write));
      fetchTripVehicles.mockResolvedValue([
        { id: 'v9', plate: '50H-49266', note: null, status: 'active' },
      ]);
      fetchTripCustomers.mockResolvedValue([
        { id: 'c9', name: 'WWL', note: null, status: 'active' },
      ]);
      renderPage();
      await screen.findByText('50H-49266');

      // "Add", so the form carries no current reference of its own.
      fireEvent.click(screen.getByRole('button', { name: 'Thêm chuyến' }));
      await screen.findByLabelText('Xe');

      expect(screen.queryByRole('option', { name: /51D\.65233/ })).toBeNull();
      expect(screen.queryByRole('option', { name: /VIỄN ĐẠT/ })).toBeNull();
      // The active fleet is still offered.
      expect(screen.getByRole('option', { name: '50H-49266' })).toBeTruthy();
    });

    it('does not call an unread catalogue "retired" while it is still loading', async () => {
      useSession.mockReturnValue(session(write));
      fetchTripSchedules.mockResolvedValue({
        items: [retiredRefs()],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      // Never resolves: the read is in flight for the whole test.
      fetchTripVehicles.mockReturnValue(new Promise(() => {}));
      fetchTripCustomers.mockReturnValue(new Promise(() => {}));

      renderPage();
      // Formatted in the table; the option below keeps the stored spelling.
      await screen.findByText('51D-65233');
      fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
      await screen.findByLabelText('Xe');

      // Selectable, so nothing is lost — but not labelled with a status the
      // client has not been told yet.
      expect((screen.getByLabelText('Xe') as HTMLSelectElement).value).toBe('gone-v');
      expect(screen.getByRole('option', { name: '51D.65233' })).toBeTruthy();
      expect(screen.queryByRole('option', { name: /Đã lưu trữ/ })).toBeNull();
    });
  });

  /**
   * ★ THE MONEY IS NOT ON THE BOARD, AND ITS CONTROL HAS ITS OWN PERMISSION.
   *
   * `trip.read` is unrestricted — every signed-in account reads this list. So
   * no amount may appear in it, and the way in is a dialog gated on `cost.read`
   * rather than a column. These cases pin both halves.
   */
  describe('★ cost is a separate permission and a separate fetch', () => {
    it('offers the cost control to a caller holding cost.read', async () => {
      useSession.mockReturnValue(session(['trip.read', 'cost.read']));
      renderPage();
      await screen.findByText('50H-49266');

      expect(screen.getByRole('button', { name: 'Chi phí chuyến' })).toBeTruthy();
    });

    it('★ offers it to NOBODY without cost.read, however senior they are', async () => {
      // `trip.write` corrects the board; it does not reveal the cost base.
      useSession.mockReturnValue(session(['trip.read', 'trip.create', 'trip.write']));
      renderPage();
      await screen.findByText('50H-49266');

      expect(screen.queryByRole('button', { name: 'Chi phí chuyến' })).toBeNull();
      // The column is still there — `trip.write` earns it on its own.
      expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toBeTruthy();
    });

    it('★ hides the actions column entirely from a caller with neither permission', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.create']));
      renderPage();
      await screen.findByText('50H-49266');

      expect(screen.queryByRole('columnheader', { name: 'Thao tác' })).toBeNull();
    });

    it('★ shows the actions column for cost.read ALONE, without trip.write', async () => {
      // An accountant may hold cost.read and no right to correct the board.
      // Gating the column on trip.write alone would hide their only control.
      useSession.mockReturnValue(session(['trip.read', 'cost.read']));
      renderPage();
      await screen.findByText('50H-49266');

      // The column itself must appear, not just the button inside it.
      expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Chi phí chuyến' })).toBeTruthy();
      // …and still no edit or archive, which are a different permission.
      expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Lưu trữ' })).toBeNull();
    });

    it('★ renders no amount anywhere on the board', async () => {
      // The list endpoint returns no money at all. This asserts the page never
      // starts showing one, which is what a "just add a total column" change
      // would break.
      useSession.mockReturnValue(session(['trip.read', 'cost.read']));
      renderPage();
      await screen.findByText('50H-49266');

      expect(document.body.textContent).not.toMatch(/1\.500\.000|4\.500\.000/);
    });
  });

  describe('the date filter', () => {
    it('★ does not fire a request per keystroke of the date input', async () => {
      // `<input type="date">` reports every COMPONENT of the date separately, so
      // typing a year walks through 0002, 0020, 0202, 2026. Undebounced that is
      // four requests, and `from: 0002-…` is the widest scan this endpoint can
      // be handed — the exact query ADR-0003's bounded range exists to prevent.
      renderPage();
      await waitFor(() => expect(listCalls()).toHaveLength(1));

      const from = screen.getByLabelText('Từ ngày');
      fireEvent.change(from, { target: { value: '0002-08-01' } });
      fireEvent.change(from, { target: { value: '0020-08-01' } });
      fireEvent.change(from, { target: { value: '2026-01-01' } });

      await waitFor(() => expect(listCalls()).toHaveLength(2));

      // Every read, badge included — the count is keyed on the debounced range
      // too, so a keystroke that must not reach the list must not reach it either.
      const ranges = fetchTripSchedules.mock.calls.map(
        ([request]) => (request as { from: string }).from,
      );
      // The settled value, and nothing on the way to it.
      expect(ranges[ranges.length - 1]).toBe('2026-01-01');
      expect(ranges).not.toContain('0002-08-01');
      expect(ranges).not.toContain('0020-08-01');
    });
  });

  /**
   * ★ THE CREW LINE, AS TABS — and the point of it is that the SERVER draws it.
   *
   * Dispatch works the uncrewed trips as a queue: a trip joins it when it is
   * entered and leaves it the moment somebody is put on the row. These assert
   * the two things that make that trustworthy — that the filter is sent rather
   * than applied to a fetched page, and that an empty result under a filter says
   * so instead of claiming the month is empty.
   */
  describe('the crew tabs', () => {
    /** The list, and the one-row read behind the badge, answered separately. */
    const board = (options: { total: number; unassigned: number; items?: unknown[] }) => {
      fetchTripSchedules.mockImplementation((request: { limit?: number }) =>
        Promise.resolve(
          request.limit === 1
            ? { items: [], page: 1, limit: 1, total: options.unassigned, totalPages: 1 }
            : {
                items: options.items ?? [trip()],
                page: 1,
                limit: 20,
                total: options.total,
                totalPages: Math.max(1, Math.ceil(options.total / 20)),
              },
        ),
      );
    };

    it('opens on the whole board, not on one of its halves', async () => {
      renderPage();

      await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
      expect(listCalls()[0]?.[0]).toMatchObject({ assignment: 'all' });
      expect(screen.getByRole('tab', { name: /tất cả/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('★ asks the SERVER for the uncrewed trips rather than filtering the page', async () => {
      board({ total: 1, unassigned: 1 });
      renderPage();
      await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));

      fireEvent.click(screen.getByRole('tab', { name: /chờ phân công/i }));

      await waitFor(() =>
        expect(listCalls().some(([r]) => (r as { assignment?: string }).assignment === 'unassigned')).toBe(
          true,
        ),
      );
    });

    it('counts the queue on the tab, from a read of its own', async () => {
      // Three waiting out of forty on the board — a number the list on screen
      // cannot supply, because the list on screen is a different filter.
      board({ total: 40, unassigned: 3 });
      renderPage();

      const tab = await screen.findByRole('tab', { name: /chờ phân công/i });
      await waitFor(() => expect(tab).toHaveTextContent('3'));
    });

    it('★ says every trip has a driver, rather than that the month is empty', async () => {
      board({ total: 5, unassigned: 0 });
      renderPage();
      await screen.findByText('50H-49266');

      fetchTripSchedules.mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
      fireEvent.click(screen.getByRole('tab', { name: /chờ phân công/i }));

      expect(
        await screen.findByText('Mọi chuyến trong khoảng ngày này đều đã có tài xế.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Không có chuyến nào trong khoảng ngày này.'),
      ).not.toBeInTheDocument();
    });

    it('★ goes back to page one, so a switch cannot land past the end', async () => {
      // The uncrewed half is always smaller than the board. Carrying "page 3"
      // into a one-page list would show an empty table and read as "there is
      // nothing waiting" — the opposite of what the tab is for.
      board({ total: 45, unassigned: 2 });
      renderPage();
      await screen.findByText('50H-49266');

      fireEvent.click(screen.getByRole('button', { name: /sau/i }));
      await waitFor(() =>
        expect(listCalls().some(([r]) => (r as { page?: number }).page === 2)).toBe(true),
      );

      fireEvent.click(screen.getByRole('tab', { name: /chờ phân công/i }));

      await waitFor(() => {
        const crewed = listCalls().filter(
          ([r]) => (r as { assignment?: string }).assignment === 'unassigned',
        );
        expect(crewed.length).toBeGreaterThan(0);
        expect(crewed.every(([r]) => (r as { page?: number }).page === 1)).toBe(true);
      });
    });
  });

  describe('the states a list can be in', () => {
    it('says the range is empty rather than showing a blank table', async () => {
      fetchTripSchedules.mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
      renderPage();

      expect(await screen.findByText('Không có chuyến nào trong khoảng ngày này.')).toBeTruthy();
    });

    it('★ shows the server’s own message on a 422, not a generic failure', async () => {
      // A 422 here names which of the two dates is wrong. Replacing it with
      // "could not load" throws away the only actionable part.
      const { ApiError } = await import('@/utils/errors');
      fetchTripSchedules.mockRejectedValue(
        new ApiError(422, 'VALIDATION_FAILED', 'The end of the range must not be before its start.'),
      );
      renderPage();

      expect(
        await screen.findByText('The end of the range must not be before its start.'),
      ).toBeTruthy();
    });

    it('renders a 403 as a state, and does not sign anybody out', async () => {
      const { ApiError } = await import('@/utils/errors');
      fetchTripSchedules.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Not allowed.'));
      renderPage();

      expect(await screen.findByText('Không có quyền')).toBeTruthy();
    });
  });

  /**
   * ★ THE TWO AGREED CHARGES — `GIÁ CƯỚC BÁN` AND `GIÁ CƯỚC MUA` — TYPED ON
   * THE FORM AND READ ON THE BOARD, BY THE PEOPLE ALLOWED TO SEE THEM.
   *
   * ⚠ AND NEITHER IS THE COST DIALOG. The wallet button opens what a run COST
   * us: separate endpoints, `cost.read` at 'global', never in this list's data.
   * These two are the commercial terms of the booking, behind
   * `trip.price.read` at 'head-anywhere'. Three tiers, three different things,
   * and collapsing any two of them puts figures in front of somebody who should
   * not have them.
   */
  describe('★ the two prices on a trip', () => {
    /** A head: may correct a row AND may see what it is sold and bought for. */
    const write = ['trip.read', 'trip.create', 'trip.write', 'trip.price.read'];
    /** An ordinary dispatcher: adds trips, sees no money at all. */
    const dispatcher = ['trip.read', 'trip.create'];

    const pricedBoard = (over: Record<string, unknown> = {}) => {
      fetchTripSchedules.mockResolvedValue({
        items: [trip({ sellPrice: '4500000.00', purchasePrice: '3000000.00', ...over })],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    };

    it('shows both figures grouped, and an unpriced trip as unset rather than as zero', async () => {
      useSession.mockReturnValue(session(write));
      fetchTripSchedules.mockResolvedValue({
        items: [
          trip({ sellPrice: '4500000.00', purchasePrice: '3000000.00' }),
          trip({ id: 't2', sellPrice: null, purchasePrice: null }),
        ],
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
      renderPage();

      // `formatMoney` drops a fraction of zeroes — VND has no subunit in daily use.
      expect(await screen.findByText('4,500,000')).toBeInTheDocument();
      expect(screen.getByText('3,000,000')).toBeInTheDocument();
      // The unpriced row says nothing rather than saying nought.
      expect(screen.queryByText('0')).toBeNull();
    });

    /**
     * ★ THE COLUMNS ARE ABSENT FOR A DISPATCHER, NOT EMPTY.
     *
     * The server sends `null` for both to a caller without `trip.price.read`,
     * whatever the trip holds. A drawn column would show an em dash on every
     * row and read as "nothing on this board is priced" — a claim about the
     * data rather than about the reader.
     */
    it('★ shows no price column at all to somebody who may not see prices', async () => {
      useSession.mockReturnValue(session(dispatcher));
      // The server would have blanked these; the fixture keeps them to prove
      // the gate is the permission and not the absence of data.
      pricedBoard();
      renderPage();
      await screen.findByText('WWL');

      expect(screen.queryByText('Giá cước bán')).toBeNull();
      expect(screen.queryByText('Giá cước mua')).toBeNull();
      expect(screen.queryByText('4,500,000')).toBeNull();
      expect(screen.queryByText('3,000,000')).toBeNull();
    });

    it('★ offers a dispatcher no price field on the form either', async () => {
      useSession.mockReturnValue(session(dispatcher));
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(screen.getByRole('button', { name: 'Thêm chuyến' }));

      await screen.findByLabelText('Thông tin hàng');
      expect(screen.queryByLabelText('Giá cước bán (VND) *')).toBeNull();
      expect(screen.queryByLabelText('Giá cước mua (VND)')).toBeNull();
    });

    /**
     * ★ AND THE PAYLOAD CARRIES NEITHER KEY — not `null`, ABSENT.
     *
     * The server answers 403 to a body that so much as mentions a price from
     * this caller, rather than stripping it, so sending "nothing to say here"
     * as an explicit clear would fail every save a dispatcher makes.
     */
    it('★ sends no price key at all when a dispatcher saves', async () => {
      useSession.mockReturnValue(session(dispatcher));
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(screen.getByRole('button', { name: 'Thêm chuyến' }));
      await screen.findByLabelText('Thông tin hàng');

      fireEvent.click(last(screen.getAllByRole('button', { name: 'Lưu' })));

      await waitFor(() => expect(createTripSchedule).toHaveBeenCalled());
      const [body] = createTripSchedule.mock.calls[0] as [Record<string, unknown>];
      expect(body).not.toHaveProperty('sellPrice');
      expect(body).not.toHaveProperty('purchasePrice');
    });

    it('★ sends the digits typed, without the separators the field shows', async () => {
      useSession.mockReturnValue(session(write));
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(screen.getByRole('button', { name: 'Thêm chuyến' }));

      const sell = (await screen.findByLabelText('Giá cước bán (VND) *')) as HTMLInputElement;
      const buy = screen.getByLabelText('Giá cước mua (VND)') as HTMLInputElement;
      fireEvent.change(sell, { target: { value: '4500000' } });
      fireEvent.change(buy, { target: { value: '3000000' } });
      // Grouped for reading; the payload below is what actually travels.
      expect(sell.value).toBe('4,500,000');
      expect(buy.value).toBe('3,000,000');

      fireEvent.click(last(screen.getAllByRole('button', { name: 'Lưu' })));

      await waitFor(() => expect(createTripSchedule).toHaveBeenCalled());
      const [body] = createTripSchedule.mock.calls[0] as [Record<string, unknown>];
      expect(body.sellPrice).toBe('4500000');
      expect(body.purchasePrice).toBe('3000000');
    });

    /**
     * ★ THE SELLING PRICE IS COMPULSORY WHEN CREATING, AND THE BUYING PRICE IS
     * NOT. Most runs go on our own lorries and are bought from nobody, so an
     * empty buying price is the ordinary case rather than an unfinished form.
     */
    it('★ marks the selling price required on create, and the buying price not', async () => {
      useSession.mockReturnValue(session(write));
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(screen.getByRole('button', { name: 'Thêm chuyến' }));

      const sell = (await screen.findByLabelText('Giá cước bán (VND) *')) as HTMLInputElement;
      const buy = screen.getByLabelText('Giá cước mua (VND)') as HTMLInputElement;

      expect(sell.required).toBe(true);
      expect(buy.required).toBe(false);
    });

    /**
     * ★ AND NOT REQUIRED ON AN EDIT, which is the half that is easy to get
     * wrong. A price typed by mistake has to be removable by whoever may see
     * it, and the PATCH route accepts an explicit clear.
     */
    it('★ does not force a selling price when correcting an existing row', async () => {
      useSession.mockReturnValue(session(write));
      pricedBoard();
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(last(screen.getAllByRole('button', { name: 'Sửa' })));

      const sell = (await screen.findByLabelText('Giá cước bán (VND) *')) as HTMLInputElement;
      expect(sell.required).toBe(false);
    });

    it('★ clears a price with null, not by omitting the key', async () => {
      useSession.mockReturnValue(session(write));
      pricedBoard();
      renderPage();
      await screen.findByText('WWL');
      fireEvent.click(last(screen.getAllByRole('button', { name: 'Sửa' })));

      const sell = (await screen.findByLabelText('Giá cước bán (VND) *')) as HTMLInputElement;
      // The stored figure is what the form opens on, decimals and all — a
      // dialog that rewrote it on the way in would change money by being opened.
      expect(sell.value).toBe('4,500,000.00');
      fireEvent.change(sell, { target: { value: '' } });
      fireEvent.click(last(screen.getAllByRole('button', { name: 'Lưu' })));

      await waitFor(() => expect(updateTripSchedule).toHaveBeenCalled());
      const [, payload] = updateTripSchedule.mock.calls[0] as [string, Record<string, unknown>];
      // `undefined` would mean "leave it alone" on the PATCH route, so a price
      // entered by mistake could never be removed.
      expect(payload).toHaveProperty('sellPrice', null);
    });
  });
});
