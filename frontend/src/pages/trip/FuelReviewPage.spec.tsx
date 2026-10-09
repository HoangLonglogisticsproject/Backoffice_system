import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { tripKeys } from '@/hooks/trip/keys';
import type { FuelReviewDetail, FuelReviewStatus, FuelSubmission } from '@/types/fuel';
import FuelReviewPage from './FuelReviewPage';

/**
 * "Kế toán → Nhiên liệu" (0038), as an accountant uses it.
 *
 * ★ THE SERVER'S MACHINE, OFFERED — NEVER DECIDED HERE. Each state offers only
 * its next moves; asking for more and refusing need a note the driver reads;
 * paying is recorded, never made. The QR is an image to pay from.
 */
const fetchFuelReviews = vi.fn();
const fetchFuelReview = vi.fn();
const decideFuelReview = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/fuelReview', () => ({
  FUEL_REVIEW_PAGE_LIMIT: 50,
  fetchFuelReviews: (...a: unknown[]) => fetchFuelReviews(...a),
  fetchFuelReview: (...a: unknown[]) => fetchFuelReview(...a),
  decideFuelReview: (...a: unknown[]) => decideFuelReview(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));

const session = (permissions: string[]) => ({ can: (p: string) => permissions.includes(p), loading: false });
const row = (over: Partial<FuelSubmission> = {}): FuelSubmission => ({
  fuelTransactionId: 'ft-1',
  costId: 'cost-1',
  vehicle: { id: 'v1', plate: '51H27314' },
  businessDate: '2026-10-08',
  occurredAt: null,
  recordedAt: '2026-10-08T03:00:00.000Z',
  amount: '772460.00',
  liters: '26.00',
  odometerKm: 182345,
  driver: { id: 'd1', displayName: 'Tài Xế A' },
  vendor: { name: 'Petrolimex CH 12', taxCode: '0100109106' },
  document: null,
  evidenceCount: 2,
  status: 'submitted',
  statusNote: null,
  statusAt: '2026-10-08T03:00:00.000Z',
  ...over,
});
const detail = (status: FuelReviewStatus): FuelReviewDetail => ({
  status,
  fill: {
    fuelTransactionId: 'ft-1',
    backing: { ledger: 'vehicle', costId: 'cost-1', source: 'driver_portal', voided: false },
    vehicle: { id: 'v1', plate: '51H27314' },
    businessDate: '2026-10-08',
    occurredAt: null,
    recordedAt: '2026-10-08T03:00:00.000Z',
    amount: '772460.00',
    liters: '26.00',
    odometerKm: 182345,
    unitPrice: '29710.00',
    driver: { id: 'd1', displayName: 'Tài Xế A' },
    vendor: { name: 'Petrolimex CH 12', taxCode: '0100109106' },
    document: null,
    trip: { id: 't1', scheduledOn: '2026-10-08', customerName: 'VIỄN ĐẠT' },
    flags: [],
    recordedBy: { id: 'd1', displayName: 'Tài Xế A' },
    evidence: [
      {
        id: 'img-qr', sha256: 'a'.repeat(64), mimeType: 'image/jpeg', byteSize: 10, originalFilename: 'qr.jpg', evidenceType: 'payment_qr',
        capturedAt: null, uploadedBy: { id: 'd1', displayName: 'Tài Xế A' }, uploadedAt: '2026-10-08T03:00:00.000Z',
        fuelTransactionId: 'ft-1', attachedAt: '2026-10-08T03:00:00.000Z', retiredAt: null, retireReason: null,
      },
    ],
  },
  history: [{ seq: 1, status: 'submitted', note: null, actor: { id: 'd1', displayName: 'Tài Xế A' }, at: '2026-10-08T03:00:00.000Z' }],
  warnings: [],
});

const renderPage = (client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) =>
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter>
          <FuelReviewPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
const openRow = async () => {
  fireEvent.click(await screen.findByText('Tài Xế A'));
  return screen.findByRole('dialog', { name: 'Kiểm tra lần đổ nhiên liệu' });
};

describe('FuelReviewPage', () => {
  beforeEach(() => {
    for (const mock of [fetchFuelReviews, fetchFuelReview, decideFuelReview]) mock.mockReset();
    useSession.mockReturnValue(session(['cost.import']));
    fetchFuelReviews.mockResolvedValue({ items: [row()], page: 1, limit: 50, total: 1, totalPages: 1 });
    fetchFuelReview.mockResolvedValue(detail('submitted'));
    decideFuelReview.mockResolvedValue(detail('approved'));
  });

  it('is Accounting’s: without cost.import there is no list and nothing is read', () => {
    useSession.mockReturnValue(session(['trip.read']));
    renderPage();
    expect(screen.getByText('Màn hình này dành cho Kế toán.')).toBeInTheDocument();
    expect(fetchFuelReviews).not.toHaveBeenCalled();
  });

  it('★ lists one state at a time — the date, plate, driver, amount, liters, station, status', async () => {
    renderPage();
    const table = await screen.findByRole('tabpanel', { name: 'Chờ kiểm tra' });
    await within(table).findByText('Tài Xế A');
    expect(table).toHaveTextContent('51H-27314');
    expect(table).toHaveTextContent('772,460');
    expect(table).toHaveTextContent('Petrolimex CH 12');
    expect(fetchFuelReviews).toHaveBeenCalledWith('submitted', 1);
    fireEvent.click(screen.getByRole('tab', { name: 'Đã thanh toán' }));
    await waitFor(() => expect(fetchFuelReviews).toHaveBeenCalledWith('paid', 1));
  });

  it('★ shows the payment QR as an image to pay from, and offers only a waiting fill’s three decisions', async () => {
    renderPage();
    const dialog = await openRow();
    expect(await within(dialog).findByRole('img', { name: 'QR thanh toán' })).toHaveAttribute('src', expect.stringContaining('/fuel-evidence/img-qr/content'));
    expect(within(dialog).getByRole('button', { name: 'Duyệt' })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: 'Đánh dấu đã thanh toán' })).toBeNull();
    // Asking for more and refusing say why, to the driver.
    expect(within(dialog).getByRole('button', { name: 'Yêu cầu bổ sung' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Từ chối' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Ghi chú'), { target: { value: 'Thiếu ảnh hoá đơn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yêu cầu bổ sung' }));
    await waitFor(() => expect(decideFuelReview).toHaveBeenCalledWith('ft-1', 'request-info', 'Thiếu ảnh hoá đơn'));
  });

  it('★ approves, and only an approved fill is marked paid — with its transfer reference', async () => {
    renderPage();
    let dialog = await openRow();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(decideFuelReview).toHaveBeenCalledWith('ft-1', 'approve', undefined));

    fetchFuelReview.mockResolvedValue(detail('approved'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    dialog = await openRow();
    const pay = await within(dialog).findByRole('button', { name: 'Đánh dấu đã thanh toán' });
    expect(within(dialog).queryByRole('button', { name: 'Duyệt' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Ghi chú'), { target: { value: 'CK VCB 4589' } });
    fireEvent.click(pay);
    await waitFor(() => expect(decideFuelReview).toHaveBeenLastCalledWith('ft-1', 'mark-paid', 'CK VCB 4589'));
  });

  it('★ a refusal says it withdraws the cost, and reads the lorry’s costs and the board again — an approval does not', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const refreshed = vi.spyOn(client, 'invalidateQueries');
    const withdrawnKeys = () => refreshed.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    renderPage(client);
    let dialog = await openRow();
    expect(await within(dialog).findByText(/Từ chối sẽ huỷ chi phí này khỏi Chi phí xe/)).toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(decideFuelReview).toHaveBeenCalledWith('ft-1', 'approve', undefined));
    await waitFor(() => expect(withdrawnKeys()).toContain(JSON.stringify(tripKeys.fuel())));
    expect(withdrawnKeys()).not.toContain(JSON.stringify(tripKeys.vehicleLedgers()));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    dialog = await openRow();
    decideFuelReview.mockResolvedValue(detail('rejected'));
    fireEvent.change(within(dialog).getByLabelText('Ghi chú'), { target: { value: 'Trùng lần đổ khác' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(decideFuelReview).toHaveBeenLastCalledWith('ft-1', 'reject', 'Trùng lần đổ khác'));
    await waitFor(() => expect(withdrawnKeys()).toContain(JSON.stringify(tripKeys.vehicleLedgers())));
    expect(withdrawnKeys()).toContain(JSON.stringify(tripKeys.fleets()));
  });

  it('follows a queue that shrank under the page being read back to its last page', async () => {
    fetchFuelReviews.mockImplementation(async (_status: string, page: number) =>
      page === 1
        ? { items: [row()], page: 1, limit: 50, total: 51, totalPages: 2 }
        : { items: [], page, limit: 50, total: 50, totalPages: 1 },
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(fetchFuelReviews).toHaveBeenCalledWith('submitted', 2));
    // Page 2 came back with only one page left: the screen goes back to page 1, never an empty page 2.
    await waitFor(() => expect(fetchFuelReviews).toHaveBeenLastCalledWith('submitted', 1));
  });

  it('offers nothing on a paid or a rejected fill', async () => {
    fetchFuelReview.mockResolvedValue(detail('paid'));
    renderPage();
    const dialog = await openRow();
    await within(dialog).findByRole('img', { name: 'QR thanh toán' });
    for (const name of ['Duyệt', 'Từ chối', 'Yêu cầu bổ sung', 'Đánh dấu đã thanh toán']) {
      expect(within(dialog).queryByRole('button', { name })).toBeNull();
    }
  });
});
