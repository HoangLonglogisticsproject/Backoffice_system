import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { BookingExport } from '@/types/bookingExport';
import type { BookingDocument } from './bookingExportModel';

const fetchBookingExport = vi.fn();
const renderBookingPng = vi.fn();
const downloadPng = vi.fn();

vi.mock('@/api/bookingExport', () => ({ fetchBookingExport: (...args: unknown[]) => fetchBookingExport(...args) }));
vi.mock('./renderBookingPng', () => ({ renderBookingPng: (doc: BookingDocument) => renderBookingPng(doc) }));
vi.mock('./downloadPng', async (actual) => ({
  ...(await actual<typeof import('./downloadPng')>()),
  downloadPng: (...args: unknown[]) => downloadPng(...args),
}));

const { BookingExportDialog } = await import('./BookingExportDialog');

/** How both pages own it: a trip id in state, the dialog mounted only while set. */
function Owner() {
  const [exporting, setExporting] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setExporting('trip-1')}>
        Xuất PNG
      </button>
      {exporting && <BookingExportDialog tripId={exporting} onClose={() => setExporting(null)} />}
    </>
  );
}

/**
 * The preview flow: one fetch, one image, the download saving that same image.
 * The renderer and the API are mocked — each has its own spec — so what is
 * pinned is the wiring between them and the dialog's states.
 */
const BOOKING: BookingExport = {
  scheduledOn: '2026-10-06',
  scheduledPickupAt: '2026-10-06T09:00:00.000Z',
  scheduledDeliveryAt: null,
  pickup: { name: 'Kho Củ Chi', address: 'Lô B2-7', contact: null },
  delivery: { name: null, address: '12 Nguyễn Huệ', contact: null },
  customerName: 'KAPV',
  cargoInfo: null,
  driverInstructions: null,
  crew: [],
};
const PNG = new Blob(['png'], { type: 'image/png' });
const createObjectURL = vi.fn(() => 'blob:preview');
const revokeObjectURL = vi.fn();

const open = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <Owner />
        </LanguageProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xuất PNG' }));
  return view;
};

beforeEach(() => {
  localStorage.setItem('language', 'vi');
  fetchBookingExport.mockReset().mockResolvedValue(BOOKING);
  renderBookingPng.mockReset().mockResolvedValue(PNG);
  downloadPng.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BookingExportDialog', () => {
  it('★ previews the generated PNG itself, after one fetch — StrictMode included', async () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Xem trước booking' })).toBeInTheDocument();
    expect(screen.getByText(/Không bao gồm giá, chi phí hoặc dữ liệu tài chính nội bộ/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tạo ảnh booking…');
    expect(screen.getByRole('button', { name: 'Tải ảnh PNG' })).toBeDisabled();

    const image = await screen.findByRole('img', { name: 'Ảnh xem trước phiếu booking' });
    expect(image).toHaveAttribute('src', 'blob:preview');
    expect(createObjectURL).toHaveBeenLastCalledWith(PNG);
    expect(fetchBookingExport).toHaveBeenCalledTimes(1);
    expect(fetchBookingExport).toHaveBeenCalledWith('trip-1');
    // Drawn from the server's document — the model, not the page.
    expect(renderBookingPng.mock.calls[0]![0].sections[0].heading).toBe('Thời gian');
  });

  it('★ downloads the SAME blob the preview shows, under the booking filename', async () => {
    open();
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh PNG' }));
    // The pickup hour (09:00Z = 16:00 in Hồ Chí Minh) and the export's own second.
    expect(downloadPng).toHaveBeenCalledWith(PNG, expect.stringMatching(/^booking-KAPV-2026-10-06-1600-xuat-\d{6}\.png$/));
  });

  it('★ closing revokes the preview URL and drops the dialog; reopening reads the trip afresh', async () => {
    open();
    await screen.findByRole('img');
    // The footer's "Đóng" — the header's × carries the same name.
    const closers = screen.getAllByRole('button', { name: 'Đóng' });
    fireEvent.click(closers[closers.length - 1]!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');

    fireEvent.click(screen.getByRole('button', { name: 'Xuất PNG' }));
    await screen.findByRole('img');
    expect(fetchBookingExport).toHaveBeenCalledTimes(2);
  });

  it('says so — and offers no download — when the trip cannot be read', async () => {
    fetchBookingExport.mockRejectedValue(new Error('404'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tạo được ảnh booking');
    expect(screen.getByRole('button', { name: 'Tải ảnh PNG' })).toBeDisabled();
    expect(renderBookingPng).not.toHaveBeenCalled();
  });

  it('says so when the browser cannot draw the image', async () => {
    renderBookingPng.mockRejectedValue(new Error('no canvas'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tạo được ảnh booking');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
