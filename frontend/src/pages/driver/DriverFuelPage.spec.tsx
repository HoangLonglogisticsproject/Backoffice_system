import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { fuelDeclaredKey } from '@/hooks/driver';
import type { DriverWorkday } from '@/types/driver';
import type { DriverFuelSubmission } from '@/types/fuel';
import { driverErrorKey } from '@/utils/driverErrors';
import { ApiError } from '@/utils/errors';
import DriverFuelPage from './DriverFuelPage';

/**
 * "Nhiên liệu" on the driver's phone (0038).
 *
 * ★ "TÔI VỪA ĐỔ DẦU CHO XE TÔI ĐANG CHẠY." The button comes from today's work;
 * the lorry is the turn's, never picked. Photos go up as they are taken; the
 * driver never sees a ledger, a cost or a candidate — only where Accounting's
 * check stands, and what it asked.
 */
const fetchMyWorkday = vi.fn();
const recordFuelFill = vi.fn();
const declareDailyFuel = vi.fn();
const fetchMyFuelSubmissions = vi.fn();
const fetchMyFuelSubmission = vi.fn();
const resubmitFuelSubmission = vi.fn();
const stageDriverFuelPhoto = vi.fn();
const fetchDriverWaitingPhotos = vi.fn();
const discardDriverFuelPhoto = vi.fn();

vi.mock('@/api/driverPortal', () => ({
  fetchMyWorkday: (...a: unknown[]) => fetchMyWorkday(...a),
  recordFuelFill: (...a: unknown[]) => recordFuelFill(...a),
  declareDailyFuel: (...a: unknown[]) => declareDailyFuel(...a),
}));
vi.mock('@/api/driverFuel', () => ({
  fetchMyFuelSubmissions: (...a: unknown[]) => fetchMyFuelSubmissions(...a),
  fetchMyFuelSubmission: (...a: unknown[]) => fetchMyFuelSubmission(...a),
  resubmitFuelSubmission: (...a: unknown[]) => resubmitFuelSubmission(...a),
  stageDriverFuelPhoto: (...a: unknown[]) => stageDriverFuelPhoto(...a),
  fetchDriverWaitingPhotos: (...a: unknown[]) => fetchDriverWaitingPhotos(...a),
  discardDriverFuelPhoto: (...a: unknown[]) => discardDriverFuelPhoto(...a),
  driverFuelPhotoUrl: (id: string) => `/api/driver/fuel-evidence/${id}/content`,
}));
vi.mock('@/utils/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/toast')>()),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

const workday = (fuel: DriverWorkday['vehicles'][number]['fuel'] = 'FUEL_ADDED'): DriverWorkday => ({
  businessDate: '2026-10-08',
  vehicles: [
    {
      vehicle: { id: 'v1', plate: '51H27314' },
      fuel,
      fuelOnVehicle: true,
      turns: [
        {
          tripId: 'trip-1', scheduledOn: '2026-10-08', vehicle: { id: 'v1', plate: '51H27314' }, customer: null,
          pickupAddress: 'Kho', pickupContact: null, deliveryAddress: 'Cảng', deliveryContact: null, cargoInfo: null,
          pickupLocation: null, deliveryLocation: null, scheduledPickupAt: null, scheduledDeliveryAt: null, driverInstructions: null,
          assignment: { id: 'a1', assignedAt: '2026-10-08T01:00:00.000Z' }, closed: false, progress: { reached: 1, next: 'PICKUP_CONFIRMED' },
        },
      ],
    },
  ],
});
const submission = (over: Partial<DriverFuelSubmission> = {}): DriverFuelSubmission => ({
  fuelTransactionId: 'ft-1',
  vehicle: { id: 'v1', plate: '51H27314' },
  businessDate: '2026-10-08',
  occurredAt: null,
  recordedAt: '2026-10-08T03:00:00.000Z',
  amount: '772460.00',
  liters: '26.00',
  odometerKm: null,
  vendor: null,
  document: null,
  evidenceCount: 1,
  status: 'submitted',
  statusNote: null,
  statusAt: '2026-10-08T03:00:00.000Z',
  ...over,
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter>
          <DriverFuelPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );

describe('DriverFuelPage', () => {
  beforeEach(() => {
    for (const mock of [fetchMyWorkday, recordFuelFill, declareDailyFuel, fetchMyFuelSubmissions, fetchMyFuelSubmission, resubmitFuelSubmission, stageDriverFuelPhoto, fetchDriverWaitingPhotos, discardDriverFuelPhoto]) {
      mock.mockReset();
    }
    fetchMyWorkday.mockResolvedValue(workday());
    fetchMyFuelSubmissions.mockResolvedValue([]);
    fetchDriverWaitingPhotos.mockResolvedValue([]);
    recordFuelFill.mockResolvedValue({ id: 'cost-1' });
    URL.createObjectURL = vi.fn(() => 'blob:photo');
  });

  it('★ records a fill on the lorry the driver runs today — with the pump photo, the QR and the station — never choosing a lorry', async () => {
    stageDriverFuelPhoto
      .mockResolvedValueOnce({ id: 'img-pump', originalFilename: 'p.jpg', evidenceType: null })
      .mockResolvedValueOnce({ id: 'img-qr', originalFilename: 'q.jpg', evidenceType: null });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ghi nhận nhiên liệu.*51H-27314/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ghi nhận đổ nhiên liệu' });
    expect(within(dialog).queryByRole('combobox')).toBeNull(); // no lorry to pick
    fireEvent.change(within(dialog).getByLabelText('Số tiền *'), { target: { value: '772460' } });
    fireEvent.change(within(dialog).getByLabelText('Đồng hồ bơm'), { target: { files: [new File(['p'], 'p.jpg', { type: 'image/jpeg' })] } });
    await within(dialog).findByRole('img', { name: 'Đồng hồ bơm' });
    fireEvent.change(within(dialog).getByLabelText('QR thanh toán'), { target: { files: [new File(['q'], 'q.jpg', { type: 'image/jpeg' })] } });
    await within(dialog).findByRole('img', { name: 'QR thanh toán' });
    fireEvent.change(within(dialog).getByLabelText('Cây xăng'), { target: { value: ' Petrolimex CH 12 ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(recordFuelFill).toHaveBeenCalledTimes(1));
    expect(recordFuelFill).toHaveBeenCalledWith('a1', {
      amount: '772460',
      liters: null,
      odometerKm: null,
      note: null,
      clientRequestId: expect.any(String),
      vendorName: 'Petrolimex CH 12',
      evidence: [{ id: 'img-pump', type: 'pump_meter' }, { id: 'img-qr', type: 'payment_qr' }],
    });
    expect(document.body.textContent).not.toMatch(/Chi phí xe|Chi phí chuyến|Gắn vào chi phí|ledger/);
  });

  it('★ offers photos left unsent last time — used only when the driver says so', async () => {
    fetchDriverWaitingPhotos.mockResolvedValue([
      { id: 'old-1', originalFilename: 'old.jpg', evidenceType: null },
      { id: 'old-2', originalFilename: 'other.jpg', evidenceType: null },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ghi nhận nhiên liệu.*51H-27314/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ghi nhận đổ nhiên liệu' });
    const leftover = await within(dialog).findByRole('region', { name: 'Ảnh đã chụp trước đó, chưa gửi' });
    fireEvent.change(within(dialog).getByLabelText('Số tiền *'), { target: { value: '500000' } });
    fireEvent.click(within(leftover).getAllByRole('button', { name: 'Dùng' })[0] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(recordFuelFill).toHaveBeenCalledTimes(1));
    // Only the photo chosen goes with the fill; the other stays waiting, offered next time.
    expect(recordFuelFill.mock.calls[0]?.[1].evidence).toEqual([{ id: 'old-1' }]);
  });

  it('★ shows where each fill stands — and answers "Cần bổ sung" with what was missing', async () => {
    const asked = submission({ status: 'needs_info', statusNote: 'Thiếu ảnh hoá đơn', vendor: { name: 'Petrolimex', taxCode: null } });
    fetchMyFuelSubmissions.mockImplementation(async (filter: { statuses?: string[] }) =>
      filter.statuses?.includes('needs_info') ? [asked] : [],
    );
    fetchMyFuelSubmission.mockResolvedValue({ ...asked, history: [{ status: 'submitted', note: null, at: asked.recordedAt }, { status: 'needs_info', note: 'Thiếu ảnh hoá đơn', at: asked.recordedAt }], evidence: [] });
    stageDriverFuelPhoto.mockResolvedValue({ id: 'img-inv', originalFilename: 'inv.jpg', evidenceType: null });
    resubmitFuelSubmission.mockResolvedValue({});
    renderPage();

    const tab = await screen.findByRole('tab', { name: 'Cần bổ sung (1)' });
    fireEvent.click(tab);
    await waitFor(() => expect(fetchMyFuelSubmissions).toHaveBeenCalledWith({ statuses: ['needs_info'] }));
    fireEvent.click(await screen.findByText('“Thiếu ảnh hoá đơn”'));
    const dialog = await screen.findByRole('dialog', { name: 'Lần đổ nhiên liệu' });
    expect(await within(dialog).findByRole('note')).toHaveTextContent('Thiếu ảnh hoá đơn');
    // The station was recorded: it is shown, not offered again.
    expect(within(dialog).queryByLabelText('Cây xăng')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Hoá đơn / phiếu'), { target: { files: [new File(['i'], 'inv.jpg', { type: 'image/jpeg' })] } });
    await within(dialog).findByRole('img', { name: 'Hoá đơn / phiếu' });
    fireEvent.change(within(dialog).getByLabelText('Số hoá đơn'), { target: { value: '0007' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi lại' }));
    await waitFor(() =>
      expect(resubmitFuelSubmission).toHaveBeenCalledWith('ft-1', { documentNumber: '0007', evidence: [{ id: 'img-inv', type: 'receipt' }] }),
    );
  });

  it('offers no answer on a fill that is not waiting for the driver', async () => {
    fetchMyFuelSubmissions.mockResolvedValue([submission({ status: 'approved' })]);
    fetchMyFuelSubmission.mockResolvedValue({ ...submission({ status: 'approved' }), history: [], evidence: [] });
    renderPage();
    fireEvent.click(await screen.findByText('Đã duyệt'));
    const dialog = await screen.findByRole('dialog', { name: 'Lần đổ nhiên liệu' });
    await within(dialog).findByText('51H-27314');
    expect(within(dialog).queryByRole('button', { name: 'Gửi lại' })).toBeNull();
  });
});

describe('★ a stale start-of-shift declaration is never shown as saved', () => {
  it('says the fill was NOT saved when the day was already declared with money', () => {
    expect(driverErrorKey(new ApiError(422, 'VALIDATION_FAILED', 'x', { dailyFuelCheck: 'CHECK_ALREADY_ANSWERED' }))).toBe(
      'driverErrCheckAlreadyAnswered',
    );
  });

  it('says the day was already declared when the answer that stands is not the driver’s', () => {
    expect(fuelDeclaredKey('fuel_added', 'no_fuel')).toBe('toastFuelCheckAlreadyStood');
    expect(fuelDeclaredKey('no_fuel', 'no_fuel')).toBe('toastFuelDeclared');
  });

  it('names a receipt already sent with another fill, and a fact that cannot be rewritten', () => {
    expect(driverErrorKey(new ApiError(422, 'VALIDATION_FAILED', 'x', { evidence: 'ON_ANOTHER_FILL' }))).toBe('driverErrReceiptOnAnotherFill');
    expect(driverErrorKey(new ApiError(422, 'VALIDATION_FAILED', 'x', { vendorName: 'FACT_ALREADY_SET' }))).toBe('driverErrFactAlreadySet');
  });
});
