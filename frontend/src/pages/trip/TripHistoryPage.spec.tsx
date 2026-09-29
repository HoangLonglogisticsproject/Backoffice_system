import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { translate, type TranslationKey } from '@/types/translate';
import type { TripBoardRow } from '@/types/tripBoard';
import { toTripSheetRows } from '@/utils/export/tripScheduleSheet';

const fetchTripSchedules = vi.fn();
const fetchAllTripSchedules = vi.fn();
const createTripSchedule = vi.fn();
const useSession = vi.fn();
const downloadTripScheduleWorkbook = vi.fn();
const notifySuccess = vi.fn();

vi.mock('@/api/tripSchedule', () => ({
  fetchTripSchedules: (...a: unknown[]) => fetchTripSchedules(...a),
  fetchAllTripSchedules: (...a: unknown[]) => fetchAllTripSchedules(...a),
  createTripSchedule: (...a: unknown[]) => createTripSchedule(...a),
  updateTripSchedule: vi.fn(),
  archiveTripSchedule: vi.fn(),
}));
vi.mock('@/api/tripCatalogue', () => ({
  fetchTripVehicles: async () => [],
  fetchTripCustomers: async () => [],
  fetchTripLocations: async () => [],
  createTripCustomer: vi.fn(),
}));
vi.mock('@/api/tripAssignment', () => ({ fetchEligibleDrivers: async () => [], assignDriver: vi.fn() }));
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));
vi.mock('@/utils/export/tripScheduleWorkbook', () => ({
  downloadTripScheduleWorkbook: (...a: unknown[]) => downloadTripScheduleWorkbook(...a),
}));
vi.mock('@/utils/toast', () => ({
  setToastLanguage: () => {},
  notifySuccess: (...a: unknown[]) => notifySuccess(...a),
  notifyError: vi.fn(),
  notifyApiError: vi.fn(),
}));

const { default: TripHistoryPage } = await import('./TripHistoryPage');

const session = (permissions: string[]) => ({
  state: { status: 'ready', authorization: { userId: 'u1', permissions } },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

const turn = (id: string, plate: string, driver: string) => ({
  id,
  vehicle: { id: `v-${id}`, plate },
  driver: { id: `d-${driver}`, displayName: driver },
  assignedAt: '2026-08-01T00:00:00.000Z',
  started: true,
});

/** A finished trip that ran on two lorries. */
const finished = {
  id: 't1', scheduledOn: '2026-08-04', legacyVehicleId: null,
  assignments: [turn('a1', '50H-49266', 'Tài Xế A'), turn('a2', '51D-65233', 'Tài Xế B')],
  customerId: 'c1', customer: { id: 'c1', name: 'WWL' }, cargoInfo: '17CTN',
  pickupAddress: 'BÃI XE MIỀN NAM', deliveryAddress: 'TCS', pickupContact: null, deliveryContact: null,
  pickupAt: '2026-08-04T01:30:00.000Z', deliveryAt: '2026-08-05T03:00:00.000Z',
  sellPrice: null, purchasePrice: null, note: null, status: 'finished',
  createdBy: 'u9', createdByUser: { id: 'u9', displayName: 'Điều Độ' },
  pickupLocationId: null, deliveryLocationId: null, pickupLocation: null, deliveryLocation: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', costSummary: null,
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <MemoryRouter initialEntries={['/dispatch/trip-history']}>
        <LanguageProvider>
          <TripHistoryPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The pickup date, its hour and the delivery — hours on the business clock. */
const fill = (day: string, hour: string, delivery: string) => {
  fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: day } });
  fireEvent.change(screen.getByLabelText('Giờ lấy hàng'), { target: { value: hour } });
  fireEvent.change(screen.getByLabelText('Thời gian giao hàng'), { target: { value: delivery } });
};
const save = () => {
  const saves = screen.getAllByRole('button', { name: 'Lưu' });
  fireEvent.click(saves[saves.length - 1]!);
};

describe('TripHistoryPage', () => {
  beforeEach(() => {
    fetchTripSchedules.mockReset().mockResolvedValue({ items: [finished], page: 1, limit: 20, total: 1, totalPages: 1 });
    fetchAllTripSchedules.mockReset().mockResolvedValue([finished]);
    createTripSchedule.mockReset().mockResolvedValue({ ...finished, id: 't9' });
    downloadTripScheduleWorkbook.mockReset().mockResolvedValue(1);
    notifySuccess.mockReset();
    useSession.mockReset().mockReturnValue(session(['trip.read', 'trip.create']));
  });

  it('★ asks the server for Lịch sử chuyến — and reads no crew queue, which is Lịch xe’s', async () => {
    renderPage();
    await screen.findByText('WWL');

    expect(fetchTripSchedules).toHaveBeenCalledTimes(1);
    expect(fetchTripSchedules.mock.calls[0]![0]).toMatchObject({ lifecycle: 'history', assignment: 'all' });
  });

  it('★ one row per trip however many lorries, with the facts of the run and no status column', async () => {
    renderPage();
    const table = within((await screen.findByText('WWL')).closest('table')!);

    expect(table.getAllByRole('row')).toHaveLength(2); // the heading and ONE trip
    expect(table.getByText(/50H-49266/)).toBeInTheDocument();
    expect(table.getByText(/51D-65233/)).toBeInTheDocument();
    for (const heading of ['Thời gian lấy hàng', 'Thời gian giao hàng', 'Điểm lấy hàng', 'Người tạo']) {
      expect(table.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(table.queryByRole('columnheader', { name: 'Trạng thái' })).toBeNull();
  });

  it('★ shows the crew in the SERVER’s order, pairs kept whole — the same order the Excel row writes', async () => {
    renderPage();
    const table = within((await screen.findByText('WWL')).closest('table')!);

    // The screen: one line per lorry, and its driver on the same line index.
    expect(table.getByText(/50H-49266/).textContent).toBe('50H-49266\n51D-65233');
    expect(table.getByText(/Tài Xế A/).textContent).toBe('Tài Xế A\nTài Xế B');

    // The file, from the same row: the same order, joined.
    const vi = (key: TranslationKey) => translate('vi', key);
    const [row] = toTripSheetRows([finished as unknown as TripBoardRow], vi, 'vi', {}, 'history');
    expect(row![vi('colVehicle')]).toBe('50H-49266; 51D-65233');
    expect(row![vi('colDriver')]).toBe('Tài Xế A; Tài Xế B');
  });

  it('★ records a run from last week through the ONE create, with the intent `historical`', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhập chuyến cũ' }));

    expect(await screen.findByRole('heading', { name: 'Nhập chuyến cũ' })).toBeInTheDocument();
    expect(screen.getByText(/vào thẳng Lịch sử chuyến/)).toBeInTheDocument();
    // What it will be, frozen — there is no status to choose.
    expect(screen.getByLabelText('Trạng thái')).toBeDisabled();
    expect(screen.getByLabelText('Trạng thái')).toHaveDisplayValue('Hoàn thành');

    fill('2020-09-23', '17:36', '2020-09-24T16:36');
    expect(screen.getByLabelText('Ngày lấy hàng *')).not.toHaveAttribute('aria-invalid');
    save();

    await waitFor(() => expect(createTripSchedule).toHaveBeenCalledTimes(1));
    const [body] = createTripSchedule.mock.calls[0] as [Record<string, unknown>];
    expect(body).toMatchObject({
      entryMode: 'historical',
      scheduledOn: '2020-09-23',
      pickupAt: new Date('2020-09-23T17:36:00+07:00').toISOString(),
      deliveryAt: new Date('2020-09-24T16:36:00+07:00').toISOString(),
      crew: [],
    });
    // The server sets `finished`; the client names no status.
    expect(body).not.toHaveProperty('status');
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('importTripSaved'));
  });

  it('★ still refuses a delivery before its pickup — history relaxes the calendar, not the timeline', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhập chuyến cũ' }));
    await screen.findByLabelText('Ngày lấy hàng *');

    fill('2020-09-23', '17:36', '2020-09-23T16:36');
    expect(screen.getByText('Thời gian giao hàng phải sau thời gian lấy hàng.')).toBeInTheDocument();

    fireEvent.submit(screen.getByLabelText('Thời gian giao hàng').closest('form')!);
    await act(async () => {});
    expect(createTripSchedule).not.toHaveBeenCalled();
  });

  it('★ refuses an hour later than now — 15:00 today at 14:00 — and a delivery at 18:00', async () => {
    // Only `Date` is faked: the query client and the DOM keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z')); // 14:00 in Hồ Chí Minh
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Nhập chuyến cũ' }));
      await screen.findByLabelText('Ngày lấy hàng *');
      fill('2026-09-29', '15:00', '2026-09-29T18:00');

      const later = 'Chuyến cũ không thể có thời gian sau thời điểm hiện tại.';
      expect(screen.getAllByText(later)).toHaveLength(2);
      expect(screen.getByLabelText('Giờ lấy hàng')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText('Thời gian giao hàng')).toHaveAttribute('aria-invalid', 'true');

      fireEvent.submit(screen.getByLabelText('Ngày lấy hàng *').closest('form')!);
      await act(async () => {});
      expect(createTripSchedule).not.toHaveBeenCalled();

      // The same day with hours already past is a run that happened.
      fill('2026-09-29', '08:00', '2026-09-29T13:30');
      expect(screen.queryByText(later)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a run dated after today — it has to have happened', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhập chuyến cũ' }));
    fireEvent.change(await screen.findByLabelText('Ngày lấy hàng *'), { target: { value: '2099-09-23' } });

    expect(screen.getByText('Chuyến cũ phải có ngày lấy hàng không muộn hơn hôm nay.')).toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText('Ngày lấy hàng *').closest('form')!);
    await act(async () => {});
    expect(createTripSchedule).not.toHaveBeenCalled();
  });

  it('★ exports Lịch sử chuyến — its own rows, not the board’s', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xuất Excel' }));

    await waitFor(() =>
      expect(fetchAllTripSchedules).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: 'history', assignment: 'all' })),
    );
    await waitFor(() =>
      expect(downloadTripScheduleWorkbook).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: 'history' })),
    );
  });

  it('offers no entry to somebody without trip.create, and no screen without trip.read', async () => {
    useSession.mockReturnValue(session(['trip.read']));
    const { unmount } = renderPage();
    await screen.findByText('WWL');
    expect(screen.queryByRole('button', { name: 'Nhập chuyến cũ' })).toBeNull();
    unmount();

    useSession.mockReturnValue(session([]));
    renderPage();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nhập chuyến cũ' })).toBeNull();
  });
});
