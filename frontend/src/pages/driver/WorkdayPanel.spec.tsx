import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { DriverWorkday, DriverWorkdayTurn } from '@/types/driver';
import { ApiError } from '@/utils/errors';
import { currentAndNext } from '@/utils/driverSchedule';
import { WorkdayPanel } from './components/WorkdayPanel';

const fetchMyWorkday = vi.fn();
const declareDailyFuel = vi.fn();
const recordFuelFill = vi.fn();
const seeUpcoming = vi.fn();

vi.mock('@/api/driverPortal', () => ({
  fetchMyWorkday: (...a: unknown[]) => fetchMyWorkday(...a),
  declareDailyFuel: (...a: unknown[]) => declareDailyFuel(...a),
  recordFuelFill: (...a: unknown[]) => recordFuelFill(...a),
}));
vi.mock('@/utils/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/toast')>()),
  notifySuccess: vi.fn(),
}));

const turn = (id: string, over: Partial<DriverWorkdayTurn> = {}): DriverWorkdayTurn => ({
  tripId: `trip-${id}`,
  scheduledOn: '2026-10-06',
  vehicle: { id: 'v1', plate: '51H27314' },
  customer: null,
  pickupAddress: `Kho ${id}`,
  pickupContact: null,
  deliveryAddress: `Cảng ${id}`,
  deliveryContact: null,
  cargoInfo: null,
  pickupLocation: null,
  deliveryLocation: null,
  scheduledPickupAt: '2026-10-06T07:00:00.000Z',
  scheduledDeliveryAt: null,
  driverInstructions: null,
  assignment: { id, assignedAt: '2026-10-05T10:00:00.000Z' },
  closed: false,
  progress: { reached: 0, next: 'ARRIVED_PICKUP' },
  ...over,
});

const lorry = (over: Partial<DriverWorkday['vehicles'][number]> = {}): DriverWorkday['vehicles'][number] => ({
  vehicle: { id: 'v1', plate: '51H27314' },
  fuel: 'FUEL_ADDED',
  fuelOnVehicle: true,
  turns: [turn('a1')],
  ...over,
});

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/driver']}>
          <Routes>
            <Route path="/driver" element={<WorkdayPanel onSeeUpcoming={seeUpcoming} />} />
            <Route path="/driver/assignments/:id" element={<p>trip screen</p>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );

/** The lorry's card, found by its plate however the plate is printed. */
const card = async (plate: string) => {
  const key = (text: string) => text.replace(/[^0-9A-Z]/gi, '').toUpperCase();
  const items = await screen.findAllByRole('listitem');
  const found = items.find((item) => key(item.textContent ?? '').includes(key(plate)));
  if (!found) throw new Error(`No card for ${plate}`);
  return found;
};

describe('★ Ca làm việc hôm nay', () => {
  beforeEach(() => {
    fetchMyWorkday.mockReset();
    declareDailyFuel.mockReset().mockResolvedValue({ businessDate: '2026-10-06', outcome: 'fuel_added' });
    recordFuelFill.mockReset().mockResolvedValue({ id: 'c1', businessDate: '2026-10-06', amount: '300000' });
  });

  it('shows each lorry with its fuel answer, the trip in hand in words and steps, and the next trip', async () => {
    fetchMyWorkday.mockResolvedValue({
      businessDate: '2026-10-06',
      vehicles: [
        lorry({
          turns: [
            turn('done', { closed: true, progress: { reached: 4, next: null } }),
            turn('now', { progress: { reached: 2, next: 'ARRIVED_DELIVERY' } }),
            turn('later', { scheduledPickupAt: '2026-10-06T07:30:00.000Z' }),
          ],
        }),
        lorry({ vehicle: { id: 'v2', plate: '51C99999' }, fuel: 'NO_FUEL', turns: [turn('b1', { vehicle: { id: 'v2', plate: '51C99999' } })] }),
      ],
    });
    renderPanel();

    // ★ NO HEADING OF ITS OWN: this panel IS the "Hôm nay" tab now, and a tab
    // panel is already named by its tab.
    const first = await card('51H-273.14');
    expect(first).toHaveTextContent('Đã khai · Có đổ nhiên liệu');
    expect(first).toHaveTextContent('Kho now → Cảng now');
    expect(first).toHaveTextContent('2/4 · Đang vận chuyển');
    expect(first).toHaveTextContent(/\d{2}:\d{2} · Kho later → Cảng later/);
    expect(within(first).getByRole('link', { name: /Tiếp tục chuyến/ })).toHaveAttribute('href', '/driver/assignments/now');

    // ★ AND EVERY OTHER TURN OF THE DAY IS LISTED AND REACHABLE — the one
    // already closed included. Showing only the turn in hand and the next made
    // the tab's own count promise work the screen did not offer.
    expect(first).toHaveTextContent('Kho done → Cảng done');
    expect(
      within(first)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/driver/assignments/now', '/driver/assignments/done', '/driver/assignments/later']);
    expect(await card('51C-999.99')).toHaveTextContent('Đã khai · Không đổ nhiên liệu đầu ca');
  });

  it('★ offers "Khai nhiên liệu đầu ca" while the check is owed — and no fill beside it', async () => {
    fetchMyWorkday.mockResolvedValue({ businessDate: '2026-10-06', vehicles: [lorry({ fuel: 'REQUIRED_MISSING' })] });
    renderPanel();

    const lorryCard = await card('51H-273.14');
    expect(lorryCard).toHaveTextContent('Chưa khai');
    expect(within(lorryCard).queryByRole('button', { name: 'Ghi nhận đổ nhiên liệu' })).toBeNull();
    fireEvent.click(within(lorryCard).getByRole('button', { name: 'Khai nhiên liệu đầu ca' }));

    const dialog = await screen.findByRole('dialog', { name: 'Khai nhiên liệu đầu ca' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Không đổ nhiên liệu đầu ca' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu và tiếp tục' }));

    await waitFor(() =>
      expect(declareDailyFuel).toHaveBeenCalledWith('a1', { outcome: 'no_fuel', clientRequestId: expect.any(String) }),
    );
    await waitFor(() => expect(fetchMyWorkday).toHaveBeenCalledTimes(2));
  });

  it('★ records a fill after the check through the trip in hand — amount and readings, no question asked', async () => {
    fetchMyWorkday.mockResolvedValue({ businessDate: '2026-10-06', vehicles: [lorry({ fuel: 'NO_FUEL' })] });
    renderPanel();

    fireEvent.click(within(await card('51H-273.14')).getByRole('button', { name: 'Ghi nhận đổ nhiên liệu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ghi nhận đổ nhiên liệu' });
    expect(within(dialog).queryByRole('radio')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Số tiền *'), { target: { value: '300000' } });
    fireEvent.change(within(dialog).getByLabelText('Số lít (không bắt buộc)'), { target: { value: '12,5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));

    await waitFor(() =>
      expect(recordFuelFill).toHaveBeenCalledWith('a1', {
        amount: '300000',
        liters: '12.5',
        odometerKm: null,
        note: null,
        clientRequestId: expect.any(String),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open and says why when the server refuses the fill', async () => {
    fetchMyWorkday.mockResolvedValue({ businessDate: '2026-10-06', vehicles: [lorry()] });
    recordFuelFill.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'no', { fuelTransaction: 'NOT_OPERATED_TODAY' }));
    renderPanel();

    fireEvent.click(within(await card('51H-273.14')).getByRole('button', { name: 'Ghi nhận đổ nhiên liệu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ghi nhận đổ nhiên liệu' });
    fireEvent.change(within(dialog).getByLabelText('Số tiền *'), { target: { value: '300000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Xe này không thuộc ca làm việc hôm nay của bạn.');
  });

  it('★ every trip done: no "Tiếp tục chuyến", the fill still offered — fuelling on the way home', async () => {
    fetchMyWorkday.mockResolvedValue({
      businessDate: '2026-10-06',
      vehicles: [lorry({ fuel: 'REQUIRED_MISSING', turns: [turn('done', { closed: true, progress: { reached: 4, next: null } })] })],
    });
    renderPanel();

    const lorryCard = await card('51H-273.14');
    expect(lorryCard).toHaveTextContent('Đã chạy xong các chuyến hôm nay của xe này.');
    // No "Tiếp tục chuyến" — there is nothing in hand. The closed turn is still
    // listed and still openable: a finished trip is read-only, not invisible.
    expect(within(lorryCard).queryByRole('link', { name: /Tiếp tục chuyến/ })).toBeNull();
    expect(within(lorryCard).getAllByRole('link')).toHaveLength(1);
    // Nothing open to answer the check through, so the fill is what is left.
    expect(within(lorryCard).queryByRole('button', { name: 'Khai nhiên liệu đầu ca' })).toBeNull();
    fireEvent.click(within(lorryCard).getByRole('button', { name: 'Ghi nhận đổ nhiên liệu' }));
    expect(await screen.findByRole('dialog', { name: 'Ghi nhận đổ nhiên liệu' })).toBeTruthy();
  });

  it('offers no fuel action on a lorry whose fuel is not declared on it', async () => {
    fetchMyWorkday.mockResolvedValue({
      businessDate: '2026-10-06',
      vehicles: [lorry({ fuel: 'NOT_REQUIRED', fuelOnVehicle: false })],
    });
    renderPanel();

    const lorryCard = await card('51H-273.14');
    expect(lorryCard).toHaveTextContent('Không yêu cầu');
    expect(within(lorryCard).queryAllByRole('button')).toEqual([]);
  });

  it('says so plainly when there is no work today, and offers the way to tomorrow', async () => {
    fetchMyWorkday.mockResolvedValue({ businessDate: '2026-10-06', vehicles: [] });
    renderPanel();

    expect(await screen.findByText('Chưa có chuyến nào')).toBeTruthy();
    expect(screen.getByText('Bạn chưa có chuyến nào hôm nay.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem chuyến sắp tới' }));
    expect(seeUpcoming).toHaveBeenCalled();
  });

  it('★ SAYS a failed read instead of stepping aside — it is the whole tab now', async () => {
    // This panel used to return `null` on an error and let the schedule list
    // below report it. There is no list below any more: silence would read as
    // "no work today", which is a different and much worse sentence.
    fetchMyWorkday.mockRejectedValue(new ApiError(0, undefined, 'offline'));
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Không có kết nối. Kiểm tra mạng rồi thử lại.');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByText('Bạn chưa có chuyến nào hôm nay.')).toBeNull();
  });

  it('picks the turn on the road first, then the first one not started', () => {
    const waiting = turn('w');
    const onRoad = turn('r', { progress: { reached: 1, next: 'PICKUP_CONFIRMED' } });
    const closed = turn('c', { closed: true, progress: { reached: 4, next: null } });
    expect(currentAndNext([closed, waiting, onRoad])).toEqual({ current: onRoad, next: waiting });
    expect(currentAndNext([waiting])).toEqual({ current: waiting, next: null });
    expect(currentAndNext([closed])).toEqual({ current: null, next: null });
  });
});
