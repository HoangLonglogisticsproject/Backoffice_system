import type { BookingExport, BookingExportStop } from '@/types/bookingExport';
import { formatPlate } from '@/utils/format';
import { businessClockOf, formatCalendarWeekday, todayAsCalendarDay } from '@/utils/format/datetime';

/**
 * "Phiếu booking" as data — every string the PNG shows, in order. A pure
 * function of the export DTO and the moment of export: no React, no canvas, no
 * permission. The renderer draws this and nothing else.
 *
 * ★ A FIXED TEMPLATE, IN VIETNAMESE. The document goes to customers, drivers
 * and partners, so it reads the same whoever exports it and whatever language
 * their screen speaks. The same rows every time: a missing value reads "—",
 * never a missing row.
 *
 * ★ ON THE BUSINESS CLOCK (Asia/Ho_Chi_Minh), not the exporter's — a laptop
 * abroad must not move a pickup to another hour on a document sent to a driver.
 */

export type DocumentBlock =
  | { kind: 'field'; label: string; value: string }
  | { kind: 'stop'; label: string; name: string | null; lines: string[] }
  | { kind: 'crew'; plate: string; driver: string }
  | { kind: 'empty'; text: string };

export interface DocumentSection {
  heading: string;
  blocks: DocumentBlock[];
}

export interface BookingDocument {
  brand: string;
  title: string;
  subtitle: string;
  sections: DocumentSection[];
  footer: string[];
}

const NONE = '—';

const field = (label: string, value: string | null): DocumentBlock => ({ kind: 'field', label, value: value?.trim() || NONE });

/** "Thứ Ba, 06/10/2026 · 16:00" — the office's day and hour. */
const businessMoment = (iso: string): string =>
  `${formatCalendarWeekday(todayAsCalendarDay(new Date(iso)), 'vi')} · ${businessClockOf(iso)}`;

/** One end: the place's name, then its address and contact as they were booked. */
const stop = (label: string, place: BookingExportStop): DocumentBlock => {
  const lines = [place.address?.trim(), place.contact?.trim() && `Liên hệ: ${place.contact.trim()}`].filter(
    (line): line is string => Boolean(line),
  );
  const name = place.name?.trim() || null;
  return { kind: 'stop', label, name, lines: name || lines.length > 0 ? lines : [NONE] };
};

export function bookingDocument(booking: BookingExport, exportedAt: Date): BookingDocument {
  const pickupDay = formatCalendarWeekday(booking.scheduledOn, 'vi');
  return {
    brand: 'HOÀNG LONG LOGISTICS',
    title: 'PHIẾU BOOKING',
    subtitle: 'Booking confirmation',
    sections: [
      {
        heading: 'Thời gian',
        blocks: [
          field('Lấy hàng', booking.scheduledPickupAt ? businessMoment(booking.scheduledPickupAt) : `${pickupDay} · chưa có giờ`),
          field('Giao hàng', booking.scheduledDeliveryAt ? businessMoment(booking.scheduledDeliveryAt) : 'Chưa xác định'),
        ],
      },
      {
        heading: 'Lộ trình',
        blocks: [stop('Điểm lấy hàng', booking.pickup), stop('Điểm giao hàng', booking.delivery)],
      },
      {
        heading: 'Khách hàng & hàng hóa',
        blocks: [
          field('Khách hàng', booking.customerName),
          field('Hàng hóa', booking.cargoInfo),
          field('Ghi chú vận hành', booking.driverInstructions),
        ],
      },
      {
        heading: 'Xe & tài xế',
        // Every lorry the server listed — never truncated (ADR-0004: 0..N).
        blocks:
          booking.crew.length > 0
            ? booking.crew.map((member) => ({ kind: 'crew', plate: formatPlate(member.plate) || NONE, driver: member.driverName }))
            : [{ kind: 'empty', text: 'Chưa phân công' }],
      },
    ],
    footer: [`Ngày xuất: ${businessMoment(exportedAt.toISOString())}`, 'Thông tin phục vụ xác nhận và vận hành booking.'],
  };
}
