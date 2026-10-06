import { describe, expect, it } from 'vitest';
import type { BookingExport } from '@/types/bookingExport';
import { bookingDocument, type BookingDocument, type DocumentBlock } from './bookingExportModel';

/**
 * The booking document as data — what the PNG will say, decided before a pixel
 * is drawn. The suite runs in UTC (vite.config), so a 16:00 here PROVES the
 * business clock: 09:00Z is 16:00 only in Hồ Chí Minh.
 */
const EXPORTED_AT = new Date('2026-10-07T03:05:00Z');
const LONG_ADDRESS =
  'Lô B2-7, Đường số 12, Khu công nghiệp Tân Phú Trung, Xã Tân Phú Trung, Huyện Củ Chi, Thành phố Hồ Chí Minh — cổng số 3, kho lạnh phía sau nhà điều hành';

const booking = (over: Partial<BookingExport> = {}): BookingExport => ({
  scheduledOn: '2026-10-06',
  scheduledPickupAt: '2026-10-06T09:00:00.000Z',
  scheduledDeliveryAt: '2026-10-07T03:00:00.000Z',
  pickup: { name: 'Kho Củ Chi', address: LONG_ADDRESS, contact: 'Anh Tuấn — 0909 123 456' },
  delivery: { name: null, address: '12 Nguyễn Huệ\nPhường Sài Gòn', contact: null },
  customerName: 'KAPV',
  cargoInfo: '24 kiện · 1.2 tấn · 6 CBM',
  driverInstructions: null,
  crew: [{ plate: '51h27314', driverName: 'Nguyễn Văn A' }],
  ...over,
});

const section = (doc: BookingDocument, heading: string): DocumentBlock[] =>
  doc.sections.find((candidate) => candidate.heading === heading)!.blocks;

describe('bookingDocument', () => {
  it('★ one fixed template: the same headings and rows for any trip, in this order', () => {
    const doc = bookingDocument(booking(), EXPORTED_AT);
    expect([doc.brand, doc.title]).toEqual(['HOÀNG LONG LOGISTICS', 'PHIẾU BOOKING']);
    expect(doc.sections.map((part) => part.heading)).toEqual(['Thời gian', 'Lộ trình', 'Khách hàng & hàng hóa', 'Xe & tài xế']);

    const empty = bookingDocument(
      booking({ customerName: null, cargoInfo: null, scheduledDeliveryAt: null, crew: [] }),
      EXPORTED_AT,
    );
    expect(empty.sections.map((part) => part.blocks.length)).toEqual([2, 2, 3, 1]);
    expect(section(empty, 'Khách hàng & hàng hóa')).toEqual([
      { kind: 'field', label: 'Khách hàng', value: '—' },
      { kind: 'field', label: 'Hàng hóa', value: '—' },
      { kind: 'field', label: 'Ghi chú vận hành', value: '—' },
    ]);
  });

  it('★ times on the business clock, with the weekday; an unbooked hour or delivery is said, not invented', () => {
    expect(section(bookingDocument(booking(), EXPORTED_AT), 'Thời gian')).toEqual([
      { kind: 'field', label: 'Lấy hàng', value: 'Thứ Ba, 06/10/2026 · 16:00' },
      { kind: 'field', label: 'Giao hàng', value: 'Thứ Tư, 07/10/2026 · 10:00' },
    ]);
    const unbooked = bookingDocument(booking({ scheduledPickupAt: null, scheduledDeliveryAt: null }), EXPORTED_AT);
    expect(section(unbooked, 'Thời gian')).toEqual([
      { kind: 'field', label: 'Lấy hàng', value: 'Thứ Ba, 06/10/2026 · chưa có giờ' },
      { kind: 'field', label: 'Giao hàng', value: 'Chưa xác định' },
    ]);
  });

  it('each end: the place, the whole address as typed, the contact; nothing at all reads "—"', () => {
    const route = section(bookingDocument(booking(), EXPORTED_AT), 'Lộ trình');
    expect(route).toEqual([
      { kind: 'stop', label: 'Điểm lấy hàng', name: 'Kho Củ Chi', lines: [LONG_ADDRESS, 'Liên hệ: Anh Tuấn — 0909 123 456'] },
      { kind: 'stop', label: 'Điểm giao hàng', name: null, lines: ['12 Nguyễn Huệ\nPhường Sài Gòn'] },
    ]);
    const blank = bookingDocument(booking({ delivery: { name: null, address: ' ', contact: null } }), EXPORTED_AT);
    expect(section(blank, 'Lộ trình')[1]).toEqual({ kind: 'stop', label: 'Điểm giao hàng', name: null, lines: ['—'] });
  });

  it('★ 0..N crew: "Chưa phân công", one pair, or EVERY pair — formatted plates, never truncated', () => {
    expect(section(bookingDocument(booking({ crew: [] }), EXPORTED_AT), 'Xe & tài xế')).toEqual([
      { kind: 'empty', text: 'Chưa phân công' },
    ]);
    const three = bookingDocument(
      booking({
        crew: [
          { plate: '51H27314', driverName: 'Nguyễn Văn A' },
          { plate: '51D-652.33', driverName: 'Trần Thị Cúc' },
          { plate: null, driverName: 'Lê Văn Đông' },
        ],
      }),
      EXPORTED_AT,
    );
    expect(section(three, 'Xe & tài xế')).toEqual([
      { kind: 'crew', plate: '51H-27314', driver: 'Nguyễn Văn A' },
      { kind: 'crew', plate: '51D-65233', driver: 'Trần Thị Cúc' },
      { kind: 'crew', plate: '—', driver: 'Lê Văn Đông' },
    ]);
  });

  it('the footer: when, on the business clock, and what the document is for — no permission wording', () => {
    const doc = bookingDocument(booking(), EXPORTED_AT);
    expect(doc.footer).toEqual(['Ngày xuất: Thứ Tư, 07/10/2026 · 10:05', 'Thông tin phục vụ xác nhận và vận hành booking.']);
    expect(JSON.stringify(doc)).not.toMatch(/quyền|giá|chi phí|lợi nhuận/i);
  });
});
