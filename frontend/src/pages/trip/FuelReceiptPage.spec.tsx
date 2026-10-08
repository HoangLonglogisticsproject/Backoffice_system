import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { FuelCandidate, FuelMatchResult } from '@/types/fuel';
import { ApiError } from '@/utils/errors';
import { todayAsCalendarDay } from '@/utils/format/datetime';
import FuelReceiptPage from './FuelReceiptPage';

/**
 * "Chứng từ nhiên liệu", as an accountant uses it.
 *
 * ★ ATTACH-ONLY. The screen searches both ledgers, shows what it found, and
 * writes only when a person presses "Gắn" on ONE cost and confirms. It never
 * chooses for them and never offers to create a cost.
 */
const findFuelMatches = vi.fn();
const attachFuelReceipt = vi.fn();
const stageFuelEvidence = vi.fn();
const discardFuelEvidence = vi.fn();
const fetchTripVehicles = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/fuelEvidence', () => ({
  findFuelMatches: (...a: unknown[]) => findFuelMatches(...a),
  attachFuelReceipt: (...a: unknown[]) => attachFuelReceipt(...a),
  stageFuelEvidence: (...a: unknown[]) => stageFuelEvidence(...a),
  discardFuelEvidence: (...a: unknown[]) => discardFuelEvidence(...a),
}));
vi.mock('@/api/tripCatalogue', () => ({ fetchTripVehicles: (...a: unknown[]) => fetchTripVehicles(...a) }));
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));

const session = (permissions: string[]) => ({ can: (p: string) => permissions.includes(p), loading: false });

let ids = 0;
const candidate = (over: Partial<FuelCandidate> = {}): FuelCandidate => ({
  fuelTransactionId: null,
  backing: { ledger: 'vehicle', costId: `cost-${++ids}`, source: 'driver_portal', voided: false },
  vehicle: { id: 'lorry-1', plate: '51D12345' },
  businessDate: '2026-10-06',
  occurredAt: null,
  recordedAt: '2026-10-06T03:00:00.000Z',
  amount: '772460.00',
  liters: '26.00',
  odometerKm: null,
  unitPrice: null,
  driver: { id: 'd1', displayName: 'Tài Xế A' },
  vendor: null,
  document: null,
  trip: null,
  flags: [],
  recordedBy: { id: 'd1', displayName: 'Tài Xế A' },
  evidenceCount: 0,
  level: 'possible',
  basis: ['fingerprint'],
  conflicts: [],
  ...over,
});
const tripCandidate = (over: Partial<FuelCandidate> = {}) =>
  candidate({
    backing: { ledger: 'trip', costId: `line-${++ids}`, source: 'backoffice', voided: false },
    vehicle: null,
    businessDate: null,
    liters: null,
    trip: { id: 'trip-1', scheduledOn: '2026-10-05', customerName: 'VIỄN ĐẠT' },
    ...over,
  });
const result = (over: Partial<FuelMatchResult>): FuelMatchResult => ({ outcome: 'none', matches: [], dayRows: [], ...over });

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter>
          <FuelReceiptPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );

/** Base UI commits a choice on pointer-up — see AdminAreaFields.spec. */
const chooseLorry = async () => {
  const box = screen.getByLabelText('Xe');
  fireEvent.pointerDown(box);
  fireEvent.mouseDown(box);
  fireEvent.click(box);
  fireEvent.change(box, { target: { value: '51D' } });
  const option = await screen.findByRole('option', { name: /51D/ });
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
};
const searchFor = async (amount = '772460') => {
  await chooseLorry();
  fireEvent.change(screen.getByLabelText('Số tiền'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Số hoá đơn'), { target: { value: ' 0001234 ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tìm chi phí đã ghi' }));
};

describe('FuelReceiptPage', () => {
  beforeEach(() => {
    for (const mock of [findFuelMatches, attachFuelReceipt, stageFuelEvidence, discardFuelEvidence, fetchTripVehicles]) mock.mockReset();
    useSession.mockReturnValue(session(['cost.import', 'trip.read']));
    fetchTripVehicles.mockResolvedValue([{ id: 'lorry-1', plate: '51D12345', status: 'active' }]);
    attachFuelReceipt.mockResolvedValue({});
    discardFuelEvidence.mockResolvedValue(undefined);
  });

  it('is Accounting’s screen: without `cost.import` there is no form and nothing is read', () => {
    useSession.mockReturnValue(session(['trip.read']));
    renderPage();
    expect(screen.getByText('Màn hình này dành cho Kế toán.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tìm chi phí đã ghi' })).toBeNull();
    expect(fetchTripVehicles).not.toHaveBeenCalled();
  });

  it('★ searches with the receipt as typed — blanks left out — and with nothing found offers NO way to create a cost', async () => {
    findFuelMatches.mockResolvedValue(result({ outcome: 'none', dayRows: [candidate({ amount: '500000.00', level: null, basis: [] })] }));
    renderPage();
    expect(screen.getByRole('button', { name: 'Tìm chi phí đã ghi' })).toBeDisabled();
    await searchFor();
    await waitFor(() =>
      expect(findFuelMatches).toHaveBeenCalledWith('lorry-1', { businessDate: todayAsCalendarDay(), amount: '772460', documentNumber: '0001234' }, []),
    );
    expect(await screen.findByText('Không có chi phí nhiên liệu đã ghi nào khớp chứng từ này.')).toBeInTheDocument();
    expect(screen.getByText(/Hãy ghi chi phí theo đúng quy trình trước/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tạo|Ghi chi phí|Lưu giao dịch/ })).toBeNull();
    expect(attachFuelReceipt).not.toHaveBeenCalled();
  });

  it('★ shows an ambiguous answer grouped by ledger and chooses nothing until a person presses “Gắn”', async () => {
    const [lorryCost, tripLine] = [candidate(), tripCandidate()];
    findFuelMatches.mockResolvedValue(result({ outcome: 'ambiguous', matches: [lorryCost, tripLine] }));
    renderPage();
    await searchFor();
    const onLorry = await screen.findByRole('region', { name: 'Đã ghi ở Chi phí xe' });
    const onTrip = screen.getByRole('region', { name: 'Đã ghi ở Chi phí chuyến' });
    expect(screen.getByText(/Nhiều chi phí giống chứng từ \(2\)/)).toBeInTheDocument();
    expect(within(onLorry).getAllByRole('listitem')).toHaveLength(1);
    expect(attachFuelReceipt).not.toHaveBeenCalled();

    fireEvent.click(within(onTrip).getByRole('button', { name: 'Gắn vào chi phí này' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Không tạo chi phí mới/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gắn chứng từ' }));
    await waitFor(() => expect(attachFuelReceipt).toHaveBeenCalledTimes(1));
    expect(attachFuelReceipt).toHaveBeenCalledWith(tripLine, {
      evidenceIds: [],
      facts: { documentNumber: '0001234' },
      acknowledgedMatches: [],
      vehicleId: 'lorry-1',
      businessDate: todayAsCalendarDay(),
    });
  });

  it('★ asks the person to confirm every OTHER fill already holding the receipt before it attaches', async () => {
    const elsewhere = candidate({ fuelTransactionId: 'fill-9', level: 'exact', basis: ['evidence_hash'], vehicle: { id: 'lorry-2', plate: '51C99999' } });
    const target = candidate();
    findFuelMatches.mockResolvedValue(result({ outcome: 'ambiguous', matches: [elsewhere, target] }));
    renderPage();
    await searchFor();
    const buttons = await screen.findAllByRole('button', { name: 'Gắn vào chi phí này' });
    fireEvent.click(buttons[1] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Gắn chứng từ' });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(attachFuelReceipt).toHaveBeenCalledTimes(1));
    expect(attachFuelReceipt.mock.calls[0]?.[1]).toMatchObject({ acknowledgedMatches: ['fill-9'] });
  });

  it('★ an image added after the search that sits on another fill is searched again — so it can be confirmed', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    stageFuelEvidence.mockResolvedValue({ id: 'img-late', originalFilename: 'late.jpg' });
    findFuelMatches.mockResolvedValue(result({ outcome: 'single', matches: [candidate()] }));
    attachFuelReceipt.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'on another fill', { evidence: 'ON_ANOTHER_FILL' }));
    renderPage();
    await searchFor();
    await screen.findByRole('button', { name: 'Gắn vào chi phí này' });
    fireEvent.change(screen.getByLabelText('Thêm ảnh'), { target: { files: [new File(['x'], 'late.jpg', { type: 'image/jpeg' })] } });
    await screen.findByRole('img', { name: 'late.jpg' });

    fireEvent.click(screen.getByRole('button', { name: 'Gắn vào chi phí này' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Gắn chứng từ' }));
    await waitFor(() => expect(findFuelMatches).toHaveBeenLastCalledWith('lorry-1', expect.anything(), ['img-late']));
  });

  it('will not attach to a withdrawn cost, or to a fill whose own receipt says otherwise', async () => {
    findFuelMatches.mockResolvedValue(
      result({
        outcome: 'single',
        matches: [candidate({ backing: { ledger: 'vehicle', costId: 'v', source: 'driver_portal', voided: true } })],
        dayRows: [candidate({ fuelTransactionId: 'fill-1', level: null, basis: [], conflicts: ['documentNumber'] })],
      }),
    );
    renderPage();
    await searchFor();
    for (const button of await screen.findAllByRole('button', { name: 'Gắn vào chi phí này' })) expect(button).toBeDisabled();
    expect(screen.getByText('Chi phí đã huỷ — không gắn được.')).toBeInTheDocument();
    expect(screen.getByText(/đây là chứng từ khác/)).toBeInTheDocument();
  });
});
