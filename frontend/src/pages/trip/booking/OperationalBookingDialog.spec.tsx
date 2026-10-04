import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';
import { TripFormModal } from '../components/TripFormModal';
import { OperationalBookingDialog } from './OperationalBookingDialog';

const createTripSchedule = vi.fn();
const updateTripSchedule = vi.fn();
const assignDriver = vi.fn();
const fetchEligibleDrivers = vi.fn();
const fetchTripLocations = vi.fn();
const createTripCustomer = vi.fn();
const useSession = vi.fn();

vi.mock('@/hooks/useVnAdministrative', () => ({
  useProvinces: () => ({ items: [], loading: false, failed: false }),
  useWards: () => ({ items: [], loading: false, failed: false }),
}));
vi.mock('@/api/tripSchedule', () => ({
  createTripSchedule: (...a: unknown[]) => createTripSchedule(...a),
  updateTripSchedule: (...a: unknown[]) => updateTripSchedule(...a),
}));
vi.mock('@/api/tripAssignment', () => ({
  assignDriver: (...a: unknown[]) => assignDriver(...a),
  fetchEligibleDrivers: (...a: unknown[]) => fetchEligibleDrivers(...a),
}));
vi.mock('@/api/tripCatalogue', () => ({
  fetchTripLocations: (...a: unknown[]) => fetchTripLocations(...a),
  createTripCustomer: (...a: unknown[]) => createTripCustomer(...a),
  createTripLocation: vi.fn(),
  updateTripLocationById: vi.fn(),
}));
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));

/** A session holding `permissions`, as `useSession` answers it. */
const session = (permissions: string[]) => ({
  state: { status: 'ready', authorization: { userId: 'u1', username: 'dispatch', role: 'MEMBER', departmentIds: [], permissions } },
  can: (permission: string) => permissions.includes(permission),
  loading: false,
});
const BOOKER = ['trip.read', 'trip.create', 'trip.write', 'customer.create', 'location.create', 'trip.price.read', 'trip.price.write'];
const DISPATCHER = ['trip.read', 'trip.create', 'trip.write'];

const CUSTOMERS = [
  {
    id: 'c9',
    name: 'WWL',
    note: null,
    status: 'active' as const,
    createdBy: 'u9',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];
const KHO_OSC = {
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
};

/** An hour on a day in Hồ Chí Minh, as the ISO instant the API is sent. */
const hcm = (day: string, hour: string) => new Date(`${day}T${hour}:00+07:00`).toISOString();

const shared = { customers: CUSTOMERS, vehicles: [], mayDispatch: false, cataloguesLoaded: true };
const LORRY = {
  id: 'v1',
  plate: '50H49266',
  note: null,
  status: 'active' as const,
  dailyFuelCheckRequired: false,
  createdBy: 'u9',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const onSaved = vi.fn();
const onClose = vi.fn();
const onCatalogueChanged = vi.fn();

const renderIn = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <LanguageProvider>{ui}</LanguageProvider>
    </QueryClientProvider>,
  );
const renderBooking = (props: Partial<Parameters<typeof OperationalBookingDialog>[0]> = {}) =>
  renderIn(
    <OperationalBookingDialog
      isOpen
      {...shared}
      onSaved={onSaved}
      onClose={onClose}
      onCatalogueChanged={onCatalogueChanged}
      {...props}
    />,
  );

/**
 * ★ ONE BOOKING, TYPED THE SAME WAY INTO EITHER PRESENTATION: a customer, a
 * named pickup place, a hand-typed delivery, the three times, both prices,
 * cargo and a note.
 */
const typeBooking = async () => {
  fireEvent.change(screen.getByLabelText('Khách hàng'), { target: { value: 'c9' } });
  const pickup = screen.getByLabelText('Điểm lấy hàng');
  await within(pickup).findByRole('option', { name: 'Kho OSC' });
  fireEvent.change(pickup, { target: { value: 'l1' } });
  fireEvent.change(screen.getByLabelText('Địa chỉ giao hàng'), { target: { value: 'Bãi tạm Q9\nCổng 2' } });
  fireEvent.change(screen.getByLabelText('Liên hệ giao hàng'), { target: { value: 'Chị Lan 0909' } });
  fireEvent.change(screen.getByLabelText('Thông tin hàng'), { target: { value: '17CTN / 1.22CBM' } });
  fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'Gọi trước 30 phút' } });
  fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: '2099-09-01' } });
  fireEvent.change(screen.getByLabelText('Giờ lấy hàng'), { target: { value: '08:30' } });
  fireEvent.change(screen.getByLabelText('Thời gian giao hàng'), { target: { value: '2099-09-02' } });
  fireEvent.change(screen.getByLabelText('Giờ giao hàng'), { target: { value: '17:00' } });
  fireEvent.change(screen.getByLabelText('Giá cước mua (VND)'), { target: { value: '3000000' } });
  fireEvent.change(screen.getByLabelText('Giá cước bán (VND) *'), { target: { value: '4500000' } });
};

/** The canonical body for that booking — what `POST /trip-schedules` has always been sent for it. */
const CANONICAL = {
  customerId: 'c9',
  cargoInfo: '17CTN / 1.22CBM',
  pickupLocationId: 'l1',
  pickupAddress: null,
  pickupContact: null,
  deliveryLocationId: null,
  deliveryAddress: 'Bãi tạm Q9\nCổng 2',
  deliveryContact: 'Chị Lan 0909',
  scheduledOn: '2099-09-01',
  pickupAt: hcm('2099-09-01', '08:30'),
  deliveryAt: hcm('2099-09-02', '17:00'),
  purchasePrice: '3000000',
  sellPrice: '4500000',
  note: 'Gọi trước 30 phút',
  entryMode: 'operational',
};

beforeEach(() => {
  vi.clearAllMocks();
  useSession.mockReturnValue(session(BOOKER));
  fetchTripLocations.mockImplementation(async (customerId: string) => (customerId === 'c9' ? [KHO_OSC] : []));
  fetchEligibleDrivers.mockResolvedValue([]);
  createTripSchedule.mockResolvedValue({ id: 't-new' });
});
afterEach(() => cleanup());

describe('★ the booking workspace replaces the old form for "Thêm chuyến" — the same booking', () => {
  it('★ same input → the same POST /trip-schedules body the trip form sent', async () => {
    renderIn(
      <TripFormModal isOpen mode="operational" {...shared} onSaved={onSaved} onClose={onClose} onCatalogueChanged={onCatalogueChanged} />,
    );
    await typeBooking();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(createTripSchedule).toHaveBeenCalledTimes(1));
    const before = createTripSchedule.mock.calls[0]![0];
    cleanup();
    createTripSchedule.mockClear();

    renderBooking();
    await typeBooking();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));
    await waitFor(() => expect(createTripSchedule).toHaveBeenCalledTimes(1));
    const after = createTripSchedule.mock.calls[0]![0];

    expect(after).toEqual(before);
    expect(after).toEqual(CANONICAL);
  });

  it('★ 09:30 PM tonight and 09:30 AM tomorrow, picked — never typed — and sent as the same instants', async () => {
    renderBooking();
    const choose = (label: string, hour: string, minute: string, period: 'AM' | 'PM') => {
      fireEvent.click(screen.getByLabelText(label));
      const column = (name: RegExp) => within(screen.getByRole('listbox', { name }));
      fireEvent.click(column(/^Giờ$/).getByRole('option', { name: hour }));
      fireEvent.click(column(/^Phút$/).getByRole('option', { name: minute }));
      fireEvent.click(column(/AM\/PM/).getByRole('option', { name: period }));
      fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    };
    fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: '01092099' } });
    choose('Giờ lấy hàng', '09', '30', 'PM');
    fireEvent.change(screen.getByLabelText('Thời gian giao hàng'), { target: { value: '02092099' } });
    choose('Giờ giao hàng', '09', '30', 'AM');
    fireEvent.change(screen.getByLabelText('Giá cước bán (VND) *'), { target: { value: '4500000' } });

    const shown = ['Ngày lấy hàng *', 'Giờ lấy hàng', 'Thời gian giao hàng', 'Giờ giao hàng'].map(
      (label) => (screen.getByLabelText(label) as HTMLInputElement).value,
    );
    expect(shown).toEqual(['01/09/2099', '09:30 PM', '02/09/2099', '09:30 AM']);
    // The summary reads the form's 24-hour value.
    expect(within(screen.getByRole('complementary', { name: 'Tóm tắt booking' })).getByText('01/09/2099 · 21:30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));
    await waitFor(() => expect(createTripSchedule).toHaveBeenCalledTimes(1));
    expect(createTripSchedule.mock.calls[0]![0]).toMatchObject({
      scheduledOn: '2099-09-01',
      pickupAt: hcm('2099-09-01', '21:30'),
      deliveryAt: hcm('2099-09-02', '09:30'),
    });
    // 21:30 in Hồ Chí Minh is 14:30 UTC — the normalisation is the one it always was.
    expect(hcm('2099-09-01', '21:30')).toBe('2099-09-01T14:30:00.000Z');
  });

  it('★ sends no price key for a booker who may not see prices — and draws no price field', async () => {
    useSession.mockReturnValue(session(DISPATCHER));
    renderBooking();
    fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: '2099-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));

    await waitFor(() => expect(createTripSchedule).toHaveBeenCalledTimes(1));
    const [body] = createTripSchedule.mock.calls[0] as [Record<string, unknown>];
    expect(body).not.toHaveProperty('sellPrice');
    expect(body).not.toHaveProperty('purchasePrice');
    expect(screen.queryByLabelText('Giá cước bán (VND) *')).toBeNull();
  });
});

describe('★ the workspace: sections, summary, action', () => {
  it('★ lays the form out in its sections, with "Tạo booking" and "Hủy bỏ" — no "Lưu"', () => {
    renderBooking();
    const dialog = screen.getByRole('dialog');

    for (const title of ['Khách hàng & hàng hoá', 'Thời gian', 'Lộ trình', 'Giá cước', 'Tóm tắt booking']) {
      expect(within(dialog).getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('button', { name: 'Tạo booking' })).toHaveAttribute('type', 'submit');
    expect(within(dialog).getByRole('button', { name: 'Hủy bỏ' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Lưu' })).toBeNull();
    expect(
      within(dialog).getByText('Booking sẽ được tạo ở trạng thái Chờ xử lý. Bạn có thể phân công xe và tài xế sau.'),
    ).toBeInTheDocument();
    // No draft: the server has no such thing.
    expect(within(dialog).queryByRole('button', { name: /nháp|draft/i })).toBeNull();
    // The crew rows only for somebody who may dispatch.
    expect(within(dialog).queryByRole('heading', { name: /Phân công xe/ })).toBeNull();
  });

  it('★ folds the optional crew away for somebody who may dispatch — drawn only once opened', () => {
    renderBooking({ mayDispatch: true, vehicles: [LORRY] });
    const toggle = screen.getByRole('button', { name: /Phân công xe ngay \(không bắt buộc\)/ });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Thêm phương tiện' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm phương tiện' }));
    expect(screen.getByLabelText('Xe')).toBeInTheDocument();

    // Folded again with a row in it: it says how many will be sent.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Đã thêm xe: 1');
  });

  it('★ a lorry the server refused keeps the crew open, its refusal in sight', async () => {
    assignDriver.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Xe này đã có trên chuyến.'));
    fetchEligibleDrivers.mockResolvedValue([{ id: 'd1', displayName: 'Tài Xế A' }]);
    renderBooking({ mayDispatch: true, vehicles: [LORRY] });
    fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: '2099-09-01' } });
    fireEvent.change(screen.getByLabelText('Giá cước bán (VND) *'), { target: { value: '4500000' } });
    const toggle = screen.getByRole('button', { name: /Phân công xe ngay/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm phương tiện' }));
    fireEvent.change(screen.getByLabelText('Xe'), { target: { value: 'v1' } });
    await screen.findByRole('option', { name: 'Tài Xế A' });
    fireEvent.change(screen.getByLabelText('Chọn tài xế'), { target: { value: 'd1' } });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));

    expect(await screen.findByText('Xe này đã có trên chuyến.')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The trip exists; the crew failed in part — the dialog stays, the board is refreshed.
    expect(createTripSchedule).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('★ reads the booking back as it is typed — the same form state, prices for whoever may see them', async () => {
    renderBooking();
    await typeBooking();
    const summary = within(screen.getByRole('complementary', { name: 'Tóm tắt booking' }));

    expect(summary.getByText('Chờ xử lý')).toBeInTheDocument();
    expect(summary.getByText('WWL')).toBeInTheDocument();
    expect(summary.getByText('17CTN / 1.22CBM')).toBeInTheDocument();
    expect(summary.getByText('Kho OSC')).toBeInTheDocument();
    // A hand-typed address is named by its first line.
    expect(summary.getByText('Bãi tạm Q9')).toBeInTheDocument();
    expect(summary.getByText('01/09/2099 · 08:30')).toBeInTheDocument();
    expect(summary.getByText('02/09/2099 · 17:00')).toBeInTheDocument();
    expect(summary.getByText('3,000,000')).toBeInTheDocument();
    expect(summary.getByText('4,500,000')).toBeInTheDocument();
  });

  it('shows no price in the summary to a booker who may not see prices', async () => {
    useSession.mockReturnValue(session(DISPATCHER));
    renderBooking();
    const summary = within(screen.getByRole('complementary', { name: 'Tóm tắt booking' }));
    expect(summary.queryByText(/Giá/)).toBeNull();
  });
});

describe('★ saving', () => {
  it('★ a double press books ONE trip — and the button says it is working meanwhile', async () => {
    let answer: (value: unknown) => void = () => {};
    createTripSchedule.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderBooking();
    fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: '2099-09-01' } });
    fireEvent.change(screen.getByLabelText('Giá cước bán (VND) *'), { target: { value: '4500000' } });

    const form = screen.getByRole('button', { name: 'Tạo booking' }).closest('dialog')!.querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    const working = await screen.findByRole('button', { name: /Đang tạo booking/ });
    expect(working).toBeDisabled();
    expect(createTripSchedule).toHaveBeenCalledTimes(1);

    await act(async () => answer({ id: 't-new' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(createTripSchedule).toHaveBeenCalledTimes(1);
  });

  it('★ closes only once the server has confirmed — and refreshes Lịch xe', async () => {
    renderBooking();
    await typeBooking();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('★ a refusal keeps every field as typed, and says why where the actions are', async () => {
    createTripSchedule.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Khách hàng này đã ngừng hoạt động.', { customerId: 'ARCHIVED' }),
    );
    renderBooking();
    await typeBooking();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Khách hàng này đã ngừng hoạt động.');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Khách hàng')).toHaveValue('c9');
    expect(screen.getByLabelText('Điểm lấy hàng')).toHaveValue('l1');
    expect(screen.getByLabelText('Địa chỉ giao hàng')).toHaveValue('Bãi tạm Q9\nCổng 2');
    expect(screen.getByLabelText('Giờ lấy hàng')).toHaveValue('08:30 AM');
    expect(screen.getByLabelText('Giá cước bán (VND) *')).toHaveValue('4,500,000');
    expect(screen.getByLabelText('Ghi chú')).toHaveValue('Gọi trước 30 phút');
  });

  it('★ a refusal of the hour takes the focus to the hour, said in the form’s words', async () => {
    // A dialog left open past midnight: "tomorrow, no hour" became today.
    createTripSchedule.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'A booking for today needs a pickup time.', { pickupAt: 'TIME_REQUIRED' }),
    );
    renderBooking();
    fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: '2099-09-01' } });
    fireEvent.change(screen.getByLabelText('Giá cước bán (VND) *'), { target: { value: '4500000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));

    expect(await screen.findByText('Chuyến hôm nay phải có giờ lấy hàng.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Giờ lấy hàng/)));
  });

  it('★ files a new customer from the form and books against it', async () => {
    createTripCustomer.mockResolvedValue({ id: 'c-new', name: 'Khách mới' });
    renderBooking();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm khách hàng' }));
    fireEvent.change(screen.getByPlaceholderText('Nhập tên khách hàng'), { target: { value: 'Khách mới' } });
    const section = within(screen.getByRole('region', { name: 'Khách hàng & hàng hoá' }));
    fireEvent.click(section.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(createTripCustomer).toHaveBeenCalledWith({ name: 'Khách mới' }));
    expect(onCatalogueChanged).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Ngày lấy hàng *'), { target: { value: '2099-09-01' } });
    fireEvent.change(screen.getByLabelText('Giá cước bán (VND) *'), { target: { value: '4500000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));
    await waitFor(() => expect(createTripSchedule).toHaveBeenCalledTimes(1));
    expect(createTripSchedule.mock.calls[0]![0]).toMatchObject({ customerId: 'c-new' });
  });
});
