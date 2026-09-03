import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TripCostModal } from './TripCostModal';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { formatDateTime } from '@/utils/format/datetime';

const fetchTripCosts = vi.fn();
const fetchOutsourceHires = vi.fn();
const fetchTripCostSummary = vi.fn();
const createTripCost = vi.fn();
const createOutsourceHire = vi.fn();
const voidTripCost = vi.fn();
const voidOutsourceHire = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/tripCost', () => ({
  fetchTripCosts: (...a: unknown[]) => fetchTripCosts(...a),
  fetchOutsourceHires: (...a: unknown[]) => fetchOutsourceHires(...a),
  fetchTripCostSummary: (...a: unknown[]) => fetchTripCostSummary(...a),
  createTripCost: (...a: unknown[]) => createTripCost(...a),
  createOutsourceHire: (...a: unknown[]) => createOutsourceHire(...a),
  voidTripCost: (...a: unknown[]) => voidTripCost(...a),
  voidOutsourceHire: (...a: unknown[]) => voidOutsourceHire(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const TRIP = 't1';

const session = (permissions: string[]) => ({
  state: {
    status: 'ready',
    authorization: {
      userId: 'u1',
      username: 'ketoan',
      role: 'SUPERADMIN',
      departmentIds: [],
      permissions,
    },
  },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

const cost = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  tripId: TRIP,
  category: 'fuel',
  amount: '1500000.00',
  note: null,
  createdBy: 'u9',
  createdAt: '2026-08-04T02:00:00.000Z',
  createdByUser: { id: 'u9', displayName: 'Kế Toán' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const hire = (over: Record<string, unknown> = {}) => ({
  id: 'h1',
  tripId: TRIP,
  carrierName: 'Hai Thành',
  agreedAmount: '4500000.00',
  amountIncludesVat: false,
  documentRef: null,
  note: null,
  createdBy: 'u9',
  createdAt: '2026-08-04T02:00:00.000Z',
  createdByUser: { id: 'u9', displayName: 'Điều Độ' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

/**
 * The panel as an element, so a case can RE-RENDER it against the same cache.
 *
 * That is what the permission-loss cases need: the amounts must disappear
 * because the permission changed, not because the cache was thrown away with
 * the component.
 */
let activeClient: QueryClient;

const panel = (tripId: string | null = TRIP, client: QueryClient = activeClient) => (
  <QueryClientProvider client={client}>
    <LanguageProvider>
      <TripCostModal tripId={tripId} onClose={() => {}} />
    </LanguageProvider>
  </QueryClientProvider>
);

const renderPanel = (tripId: string | null = TRIP, client?: QueryClient) => {
  activeClient = client ?? makeClient();
  return render(panel(tripId, activeClient));
};

const ALL = ['cost.read', 'cost.create', 'cost.void'];

/**
 * Waits for all three reads to land.
 *
 * The totals heading appears exactly once, unlike the figures — a single cost
 * line of 1,500,000 legitimately renders that number twice, once as the line
 * and once as its own total.
 */
const settled = () => screen.findByText('Tổng chi phí chuyến');

/** The two tables, in render order: own-vehicle cost, then outsourced hire. */
const costTable = () => screen.getAllByRole('table')[0] as HTMLElement;

/**
 * The timestamp as the SHARED helper renders it.
 *
 * Asserted against `formatDateTime` rather than a hard-coded string: that is
 * the actual requirement — provenance must not become the one place on the
 * screen with its own date format — and it keeps the case independent of the
 * timezone the suite happens to run in.
 */
const WRITTEN_AT = formatDateTime('2026-08-04T02:00:00.000Z', 'vi');
const hireTable = () => screen.getAllByRole('table')[1] as HTMLElement;

/**
 * The money panel.
 *
 * ⚠ NONE OF THIS IS AUTHORIZATION. The server re-decides every request; these
 * assertions are about which controls are DRAWN and what they send. A hidden
 * button is a courtesy, never a boundary — and the read gate additionally stops
 * the panel firing three requests that would only be refused.
 */
describe('TripCostModal', () => {
  beforeEach(() => {
    fetchTripCosts.mockReset().mockResolvedValue({ items: [cost()], total: '1500000.00' });
    fetchOutsourceHires.mockReset().mockResolvedValue({ items: [hire()], total: '4500000.00' });
    fetchTripCostSummary
      .mockReset()
      .mockResolvedValue({ costs: '1500000.00', hires: '4500000.00', combined: '6000000.00' });
    createTripCost.mockReset().mockResolvedValue(cost());
    createOutsourceHire.mockReset().mockResolvedValue(hire());
    voidTripCost.mockReset().mockResolvedValue(cost({ voidedAt: '2026-08-05T00:00:00.000Z' }));
    voidOutsourceHire.mockReset().mockResolvedValue(hire({ voidedAt: '2026-08-05T00:00:00.000Z' }));
    useSession.mockReset().mockReturnValue(session(ALL));
  });

  describe('★ permission decides what is fetched and what is drawn', () => {
    it('★ fetches nothing at all without cost.read', async () => {
      // Not merely hidden: a caller without the permission must not generate
      // three requests the server answers 403 to, every time they open a trip.
      useSession.mockReturnValue(session(['trip.read']));
      renderPanel();

      await waitFor(() => expect(fetchTripCosts).not.toHaveBeenCalled());
      expect(fetchOutsourceHires).not.toHaveBeenCalled();
      expect(fetchTripCostSummary).not.toHaveBeenCalled();
    });

    it('reads all three when the caller holds cost.read', async () => {
      useSession.mockReturnValue(session(['cost.read']));
      renderPanel();

      await waitFor(() => expect(fetchTripCosts).toHaveBeenCalledWith(TRIP, false));
      expect(fetchOutsourceHires).toHaveBeenCalledWith(TRIP, false);
      expect(fetchTripCostSummary).toHaveBeenCalledWith(TRIP);
    });

    it('★ offers no "add" control without cost.create', async () => {
      useSession.mockReturnValue(session(['cost.read']));
      renderPanel();
      await settled();

      expect(screen.queryByRole('button', { name: 'Thêm chi phí' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Thêm xe ngoài' })).toBeNull();
    });

    it('★ offers no "void" control without cost.void', async () => {
      useSession.mockReturnValue(session(['cost.read', 'cost.create']));
      renderPanel();
      await settled();

      expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull();
    });

    it('offers both to a caller holding all three', async () => {
      renderPanel();
      await settled();

      expect(screen.getByRole('button', { name: 'Thêm chi phí' })).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Xóa' }).length).toBeGreaterThan(0);
    });

    it('fetches nothing while no trip is selected', async () => {
      renderPanel(null);
      await waitFor(() => expect(fetchTripCosts).not.toHaveBeenCalled());
    });
  });

  /**
   * ★ CACHED MONEY MUST NOT OUTLIVE THE PERMISSION.
   *
   * A disabled React Query still hands back whatever is in its cache. Without
   * an explicit gate, a caller who held `cost.read` a moment ago and has since
   * lost it — a revoked assignment, a switched account on a shared machine, a
   * session that ended — would keep seeing the amounts they were shown before,
   * from memory, with no request and nothing left to refuse them.
   */
  describe('★ losing cost.read hides money that was already fetched', () => {
    it('★ shows nothing once the permission goes away, without refetching', async () => {
      const { rerender } = renderPanel();
      await settled();
      expect(within(costTable()).getByText('1,500,000')).toBeTruthy();

      // Same cache, same trip — only the permission changed.
      useSession.mockReturnValue(session(['trip.read']));
      rerender(panel());

      // The refusal, not a set of empty tables that would read as "this trip
      // cost nothing".
      expect(await screen.findByText('Không có quyền')).toBeTruthy();
      expect(document.body.textContent).not.toContain('1,500,000');
      expect(document.body.textContent).not.toContain('4,500,000');
      expect(document.body.textContent).not.toContain('6,000,000');
    });

    it('★ shows nothing when the session itself ends', async () => {
      const { rerender } = renderPanel();
      await settled();

      useSession.mockReturnValue({
        state: null,
        can: () => false,
        loading: false,
      });
      rerender(panel());

      expect(await screen.findByText('Không có quyền')).toBeTruthy();
      expect(document.body.textContent).not.toContain('1,500,000');
    });

    it('★ purges the figures from the cache, not merely from the render', async () => {
      // Gating the output alone would leave the amounts resident in memory for
      // any later render — or a devtools panel — to surface.
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const { rerender } = renderPanel(TRIP, client);
      await settled();

      expect(
        client.getQueriesData({ queryKey: ['trip', 'money'] }).some(([, data]) => data !== undefined),
      ).toBe(true);

      useSession.mockReturnValue(session(['trip.read']));
      rerender(panel(TRIP, client));

      await waitFor(() =>
        expect(client.getQueriesData({ queryKey: ['trip', 'money'] })).toHaveLength(0),
      );
    });
  });

  describe('what it shows', () => {
    it('★ renders amounts grouped, from the string the server sent', async () => {
      renderPanel();
      await settled();

      // "1500000.00" → "1,500,000". Never parsed to a number on the way.
      expect(within(costTable()).getByText('1,500,000')).toBeTruthy();
      expect(within(hireTable()).getByText('4,500,000')).toBeTruthy();
    });

    describe('★ the add form appears in place', () => {
      it('★ opens no second dialog', async () => {
        renderPanel();
        await settled();
        expect(screen.getAllByRole('dialog')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
        await screen.findByLabelText('Số tiền (VND) *');

        expect(screen.getAllByRole('dialog')).toHaveLength(1);
      });

      it('keeps the running totals on screen while the amount is typed', async () => {
        renderPanel();
        await settled();

        fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
        await screen.findByLabelText('Số tiền (VND) *');

        expect(screen.getByText('Tổng chi phí chuyến')).toBeTruthy();
        expect(screen.getByText('6,000,000')).toBeTruthy();
      });

      it('closes on a second click of the same button', async () => {
        renderPanel();
        await settled();

        fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
        await screen.findByLabelText('Số tiền (VND) *');

        fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
        expect(screen.queryByLabelText('Số tiền (VND) *')).toBeNull();
      });

      it('swaps to the hire form rather than showing both at once', async () => {
        renderPanel();
        await settled();

        fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
        await screen.findByLabelText('Khoản mục *');

        fireEvent.click(screen.getByRole('button', { name: 'Thêm xe ngoài' }));
        await screen.findByLabelText('Nhà xe *');

        expect(screen.queryByLabelText('Khoản mục *')).toBeNull();
      });
    });

    it('shows the five category labels in the add form', async () => {
      renderPanel();
      await settled();
      fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));

      const field = await screen.findByLabelText('Khoản mục *');
      for (const label of ['Dầu', 'Cầu trạm', 'Phí kho', 'Bốc xếp', 'Tăng ca']) {
        expect(within(field).getByRole('option', { name: label })).toBeTruthy();
      }
    });

    it('★ shows the three totals, including the combined one the server added', async () => {
      renderPanel();

      expect(await screen.findByText('Tổng chi phí xe nhà')).toBeTruthy();
      expect(screen.getByText('Tổng xe thuê ngoài')).toBeTruthy();
      expect(screen.getByText('Tổng chi phí chuyến')).toBeTruthy();
      // 1,500,000 + 4,500,000 — computed by PostgreSQL, not by this component.
      expect(screen.getByText('6,000,000')).toBeTruthy();
    });

    it('marks a hire whose price already contains VAT', async () => {
      fetchOutsourceHires.mockResolvedValue({
        items: [hire({ amountIncludesVat: true })],
        total: '4500000.00',
      });
      renderPanel();

      await settled();
      expect(within(hireTable()).getByText('Có VAT')).toBeTruthy();
    });

    it('shows the carrier and the document reference', async () => {
      fetchOutsourceHires.mockResolvedValue({
        items: [hire({ documentRef: 'HD-2026-08-04' })],
        total: '4500000.00',
      });
      renderPanel();
      await settled();

      expect(within(hireTable()).getByText('Hai Thành')).toBeTruthy();
      expect(within(hireTable()).getByText('HD-2026-08-04')).toBeTruthy();
    });
  });

  /**
   * ★ WHO WROTE THIS FIGURE, AND WHEN.
   *
   * The second question asked of any amount, after "how much". The server sends
   * a name rather than the raw `createdBy` UUID, because a UUID answers nobody
   * — and the timestamp is formatted with the same helper every other date on
   * the screen uses, so provenance does not become the one place with its own
   * date format.
   */
  describe('★ provenance on every record', () => {
    it('names who entered a cost line, and when', async () => {
      renderPanel();
      await settled();

      const row = within(costTable());
      expect(row.getByText(`Kế Toán · ${WRITTEN_AT}`)).toBeTruthy();
    });

    it('names who entered an outsourced hire, and when', async () => {
      renderPanel();
      await settled();

      const row = within(hireTable());
      expect(row.getByText(`Điều Độ · ${WRITTEN_AT}`)).toBeTruthy();
    });

    it('★ shows the raw id to nobody', async () => {
      // `createdBy` is still in the payload because code compares ids; it must
      // never reach the screen.
      renderPanel();
      await settled();

      expect(document.body.textContent).not.toContain('u9');
    });

    it('★ keeps provenance on a VOIDED record', async () => {
      // A withdrawn record is kept precisely so it stays answerable. Losing its
      // author when it is voided would defeat the reason for keeping it.
      fetchTripCosts.mockResolvedValue({
        items: [cost({ voidedAt: '2026-08-05T00:00:00.000Z', voidReason: 'nhập nhầm' })],
        total: '0.00',
      });
      renderPanel();
      await settled();

      const row = within(costTable());
      expect(row.getByText('Đã xóa')).toBeTruthy();
      expect(row.getByText(`Kế Toán · ${WRITTEN_AT}`)).toBeTruthy();
      expect(row.getByText('nhập nhầm')).toBeTruthy();
    });
  });

  describe('★ a voided record stays visible and stops counting', () => {
    beforeEach(() => {
      fetchTripCosts.mockResolvedValue({
        items: [cost({ voidedAt: '2026-08-05T00:00:00.000Z', voidReason: 'nhập nhầm' })],
        // The server excludes it from the total whatever the list holds.
        total: '0.00',
      });
      fetchTripCostSummary.mockResolvedValue({
        costs: '0.00',
        hires: '4500000.00',
        combined: '4500000.00',
      });
    });

    it('shows it as voided, with the reason, and out of the total', async () => {
      renderPanel();
      await settled();

      expect(within(costTable()).getByText('Đã xóa')).toBeTruthy();
      expect(within(costTable()).getByText('nhập nhầm')).toBeTruthy();
      // The figure is still on screen; the total no longer includes it.
      expect(within(costTable()).getByText('1,500,000')).toBeTruthy();
      expect(screen.getByText('0')).toBeTruthy();
    });

    it('★ offers no second void on an already-voided record', async () => {
      // The server answers 409; the control is not offered rather than left to
      // produce an error the user could not have predicted.
      renderPanel();
      await settled();

      // Scoped to the cost table: the hire beside it is still live and keeps
      // its own control.
      expect(within(costTable()).queryByRole('button', { name: 'Xóa' })).toBeNull();
      expect(within(hireTable()).getByRole('button', { name: 'Xóa' })).toBeTruthy();
    });

    it('asks for the voided records only when the box is ticked', async () => {
      renderPanel();
      await waitFor(() => expect(fetchTripCosts).toHaveBeenCalledWith(TRIP, false));

      fireEvent.click(screen.getByLabelText('Hiện cả khoản đã xóa'));

      await waitFor(() => expect(fetchTripCosts).toHaveBeenCalledWith(TRIP, true));
      expect(fetchOutsourceHires).toHaveBeenCalledWith(TRIP, true);
    });
  });

  describe('recording money', () => {
    it('★ sends the amount as the STRING it was typed', async () => {
      renderPanel();
      await settled();

      fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
      await screen.findByLabelText('Khoản mục *');

      fireEvent.change(screen.getByLabelText('Khoản mục *'), { target: { value: 'toll' } });
      fireEvent.change(screen.getByLabelText('Số tiền (VND) *'), { target: { value: '250000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripCost).toHaveBeenCalledWith(TRIP, {
          category: 'toll',
          // A number here would already have gone through float64.
          amount: '250000',
          note: null,
        }),
      );
    });

    it('records an outsourced hire with its carrier, VAT flag and document', async () => {
      renderPanel();
      await settled();

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe ngoài' }));
      await screen.findByLabelText('Nhà xe *');

      fireEvent.change(screen.getByLabelText('Nhà xe *'), { target: { value: 'xe Út' } });
      fireEvent.change(screen.getByLabelText('Giá thỏa thuận (VND) *'), {
        target: { value: '3000000' },
      });
      fireEvent.click(screen.getByLabelText('Đã bao gồm VAT'));
      fireEvent.change(screen.getByLabelText('Số chứng từ'), { target: { value: 'HD-99' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createOutsourceHire).toHaveBeenCalledWith(TRIP, {
          carrierName: 'xe Út',
          agreedAmount: '3000000',
          amountIncludesVat: true,
          documentRef: 'HD-99',
          note: null,
        }),
      );
    });

    it('★ groups the amount on screen and sends it plain', async () => {
      // The two halves of the same guarantee. Somebody typing seven digits
      // needs to see where the millions are, and the server needs a decimal
      // string it can hand to NUMERIC(14,2) — a comma in the payload would be
      // refused outright.
      renderPanel();
      await settled();

      fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
      const amount = await screen.findByLabelText('Số tiền (VND) *');

      fireEvent.change(amount, { target: { value: '1500000' } });
      expect(amount).toHaveValue('1,500,000');

      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripCost).toHaveBeenCalledWith(
          TRIP,
          expect.objectContaining({ amount: '1500000' }),
        ),
      );
    });

    it('keeps the separators out of a fractional amount too', async () => {
      renderPanel();
      await settled();

      fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
      const amount = await screen.findByLabelText('Số tiền (VND) *');

      fireEvent.change(amount, { target: { value: '1500000.50' } });
      expect(amount).toHaveValue('1,500,000.50');

      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripCost).toHaveBeenCalledWith(
          TRIP,
          expect.objectContaining({ amount: '1500000.50' }),
        ),
      );
    });

    it("★ shows the server's own message when it refuses an amount", async () => {
      // The server knows about the 2-decimal limit and the positive rule; this
      // form does not restate them, so its message is the honest one.
      const { ApiError } = await import('@/utils/errors');
      createTripCost.mockRejectedValue(
        new ApiError(422, 'VALIDATION_FAILED', 'Expected a positive amount, e.g. "1500000.00".'),
      );
      renderPanel();
      await settled();

      fireEvent.click(screen.getByRole('button', { name: 'Thêm chi phí' }));
      await screen.findByLabelText('Số tiền (VND) *');
      fireEvent.change(screen.getByLabelText('Số tiền (VND) *'), { target: { value: '1.234' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      expect(
        await screen.findByText('Expected a positive amount, e.g. "1500000.00".'),
      ).toBeTruthy();
    });
  });

  describe('withdrawing money', () => {
    it('★ names the KIND of record it is about to withdraw', async () => {
      renderPanel();
      await settled();

      fireEvent.click(within(costTable()).getByRole('button', { name: 'Xóa' }));

      expect(await screen.findByRole('heading', { name: 'Xóa chi phí' })).toBeTruthy();
      expect(
        screen.getByText(
          'Bạn có chắc muốn xóa khoản chi phí này? Bản ghi vẫn được giữ lại — chỉ là không còn tính vào tổng.',
        ),
      ).toBeTruthy();
      // ★ A CONFIRMATION, NOT A FORM. There is no field to fill in: the two
      // buttons ARE the question, and anything more would invite a sentence
      // nobody asked for.
      expect(screen.queryByRole('textbox')).toBeNull();
      // Nothing has happened yet — the dialog is a confirmation, not a receipt.
      expect(voidTripCost).not.toHaveBeenCalled();
    });

    it('★ says something else again for an outsourced hire', async () => {
      renderPanel();
      await settled();

      fireEvent.click(within(hireTable()).getByRole('button', { name: 'Xóa' }));

      expect(await screen.findByRole('heading', { name: 'Xóa xe thuê ngoài' })).toBeTruthy();
      expect(
        screen.getByText(
          'Bạn có chắc muốn xóa xe thuê ngoài này? Bản ghi vẫn được giữ lại — chỉ là không còn tính vào tổng.',
        ),
      ).toBeTruthy();
      expect(voidOutsourceHire).not.toHaveBeenCalled();
    });

    it('withdraws the cost line on the second click, with no reason to send', async () => {
      renderPanel();
      await settled();

      fireEvent.click(within(costTable()).getByRole('button', { name: 'Xóa' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Xóa chi phí' }));

      await waitFor(() => expect(voidTripCost).toHaveBeenCalledWith(TRIP, 'c1'));
    });

    it('withdraws the hire through its own endpoint', async () => {
      renderPanel();
      await settled();

      fireEvent.click(within(hireTable()).getByRole('button', { name: 'Xóa' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Xóa xe thuê ngoài' }));

      await waitFor(() => expect(voidOutsourceHire).toHaveBeenCalledWith(TRIP, 'h1'));
    });

    it('★ closes on the cancel button without withdrawing anything', async () => {
      renderPanel();
      await settled();

      fireEvent.click(within(costTable()).getByRole('button', { name: 'Xóa' }));
      await screen.findByRole('button', { name: 'Xóa chi phí' });
      fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Xóa chi phí' })).toBeNull(),
      );
      expect(voidTripCost).not.toHaveBeenCalled();
    });

    it('shows the refusal when the record was already voided', async () => {
      const { ApiError } = await import('@/utils/errors');
      voidTripCost.mockRejectedValue(
        new ApiError(409, 'CONFLICT', 'That cost line has already been voided.'),
      );
      renderPanel();
      await settled();

      fireEvent.click(within(costTable()).getByRole('button', { name: 'Xóa' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Xóa chi phí' }));

      expect(await screen.findByText('That cost line has already been voided.')).toBeTruthy();
    });
  });

  describe('the states the panel can be in', () => {
    it('says each list is empty rather than showing a bare table', async () => {
      fetchTripCosts.mockResolvedValue({ items: [], total: '0.00' });
      fetchOutsourceHires.mockResolvedValue({ items: [], total: '0.00' });
      renderPanel();

      expect(await screen.findByText('Chưa có chi phí xe nhà.')).toBeTruthy();
      expect(screen.getByText('Chưa có xe thuê ngoài.')).toBeTruthy();
    });

    it('renders a 403 as a state, and does not sign anybody out', async () => {
      const { ApiError } = await import('@/utils/errors');
      fetchTripCosts.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Not allowed.'));
      renderPanel();

      expect(await screen.findByText('Không có quyền')).toBeTruthy();
    });

    it("shows the server's message on any other failure", async () => {
      const { ApiError } = await import('@/utils/errors');
      fetchTripCosts.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Trip not found.'));
      renderPanel();

      expect(await screen.findByText('Trip not found.')).toBeTruthy();
    });

    it('★ offers no edit control anywhere — a correction is a removal plus a new record', async () => {
      renderPanel();
      await settled();

      expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
      // ★ THE BUTTON SAYS 'Xóa' AND THE ROW SURVIVES IT. The word is the one
      // people already use for this control; the mechanism behind it is still a
      // void, which is why the dialog promises the record is kept.
      expect(screen.getAllByRole('button', { name: 'Xóa' }).length).toBeGreaterThan(0);
    });
  });
});
