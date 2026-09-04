import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@/api/tripSchedule', () => ({
  fetchTripSchedules: (...a: unknown[]) => fetchTripSchedules(...a),
  archiveTripSchedule: (...a: unknown[]) => archiveTripSchedule(...a),
  createTripSchedule: vi.fn(),
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
vi.mock('@/api/tripCatalogue', () => ({
  fetchTripVehicles: (...a: unknown[]) => fetchTripVehicles(...a),
  fetchTripCustomers: (...a: unknown[]) => fetchTripCustomers(...a),
  createTripVehicle: vi.fn(),
  createTripCustomer: vi.fn(),
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
  note: null,
  status: 'awaiting_vehicle',
  createdBy: 'u9',
  createdByUser: { id: 'u9', displayName: 'Điều Độ' },
  driver: null,
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
    updateTripStatus.mockReset().mockResolvedValue(trip({ status: 'done' }));
    updateTripSchedule.mockReset().mockResolvedValue(trip());
    fetchTripVehicles.mockReset().mockResolvedValue([]);
    fetchTripCustomers.mockReset().mockResolvedValue([]);
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
      await waitFor(() => expect(fetchTripSchedules.mock.calls.length).toBeGreaterThan(1));
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
      await waitFor(() => expect(fetchTripSchedules.mock.calls.length).toBeGreaterThan(1));
    });

    it('offers no assignment control on a finished trip', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.write']));
      fetchTripSchedules.mockResolvedValue({
        items: [trip({ status: 'done', driver: { id: 'd1', displayName: 'Tài Xế A' } })],
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

    await waitFor(() => expect(fetchTripSchedules).toHaveBeenCalled());

    const [request] = fetchTripSchedules.mock.calls[0] as [{ from: string; to: string }];
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
    expect(screen.queryByText('awaiting_vehicle')).toBeNull();
    expect(screen.getByText('SX rồi, đợi xe')).toBeTruthy();
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
      fireEvent.change(select, { target: { value: 'needs_confirmation' } });

      await waitFor(() => expect(updateTripStatus).toHaveBeenCalledWith('t1', 'needs_confirmation'));
    });

    it('shows the new status immediately, before the server answers', async () => {
      // A click that waits for a round trip before showing anything is a click
      // people make twice.
      let settle: (value: unknown) => void = () => {};
      updateTripStatus.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

      useSession.mockReturnValue(session(write));
      renderPage();

      const select = await screen.findByLabelText('Đổi trạng thái');
      fireEvent.change(select, { target: { value: 'needs_confirmation' } });

      await waitFor(() => expect((select as HTMLSelectElement).value).toBe('needs_confirmation'));
      settle(trip({ status: 'needs_confirmation' }));
    });

    /**
     * ★ THE TWO THINGS BD-01 EXISTS TO STOP OFFERING.
     *
     * The server refuses both with 409 — `requireNotCompletionOnly` on the way
     * in, `canTransition` on the way out, and a trigger in 0017 behind them. A
     * control whose only possible outcome is a refusal is not a control.
     */
    it('★ never offers `done` on the board — a trip is finished by approval', async () => {
      useSession.mockReturnValue(session(write));
      renderPage();

      const select = (await screen.findByLabelText('Đổi trạng thái')) as HTMLSelectElement;
      const options = [...select.options].map((option) => option.value);

      expect(options).not.toContain('done');
      // The four that ARE a dispatcher's to choose are all still there.
      expect(options).toEqual(
        expect.arrayContaining([
          'awaiting_production',
          'awaiting_vehicle',
          'needs_confirmation',
          'external_booking',
        ]),
      );
    });

    it('★ shows a finished trip as a badge, not a dropdown', async () => {
      fetchTripSchedules.mockResolvedValue({
        items: [trip({ status: 'done' })],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      useSession.mockReturnValue(session(write));
      renderPage();

      // The label the badge carries, and no control to change it.
      expect(await screen.findByText('Đã xong')).toBeInTheDocument();
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
      fireEvent.change(select, { target: { value: 'needs_confirmation' } });

      await waitFor(() =>
        expect(updateTripStatus).toHaveBeenCalledWith('t1', 'needs_confirmation'),
      );

      // The move itself, on the toast: which way this row went. Waited for
      // rather than found immediately — the receipt is raised after the server
      // answers, and sonner mounts it a frame later still.
      await waitFor(() =>
        expect(document.querySelector('[data-sonner-toaster]')?.textContent).toContain(
          'SX rồi, đợi xe → Thông tin cần xác nhận lại',
        ),
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Hoàn tác' }));

      await waitFor(() =>
        expect(updateTripStatus).toHaveBeenLastCalledWith('t1', 'awaiting_vehicle'),
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
      fireEvent.change(select, { target: { value: 'needs_confirmation' } });

      expect(await screen.findByText('This trip has been archived.')).toBeTruthy();
      // The optimistic guess is gone, not left on screen as if it had worked —
      // back to the status the row actually holds.
      await waitFor(() => expect((select as HTMLSelectElement).value).toBe('awaiting_vehicle'));
    });

    it('offers a reader without trip.write a label, not a control', async () => {
      useSession.mockReturnValue(session(['trip.read']));
      renderPage();

      await screen.findByText('50H-49266');
      expect(screen.queryByLabelText('Đổi trạng thái')).toBeNull();
      // Still readable — the status is not hidden, only not editable.
      expect(screen.getByText('SX rồi, đợi xe')).toBeTruthy();
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
      await screen.findByText('51D.65233');
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
      await screen.findByText('51D.65233');
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
      await waitFor(() => expect(fetchTripSchedules).toHaveBeenCalledTimes(1));

      const from = screen.getByLabelText('Từ ngày');
      fireEvent.change(from, { target: { value: '0002-08-01' } });
      fireEvent.change(from, { target: { value: '0020-08-01' } });
      fireEvent.change(from, { target: { value: '2026-01-01' } });

      await waitFor(() => expect(fetchTripSchedules).toHaveBeenCalledTimes(2));

      const ranges = fetchTripSchedules.mock.calls.map(
        ([request]) => (request as { from: string }).from,
      );
      // The settled value, and nothing on the way to it.
      expect(ranges[ranges.length - 1]).toBe('2026-01-01');
      expect(ranges).not.toContain('0002-08-01');
      expect(ranges).not.toContain('0020-08-01');
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
});
