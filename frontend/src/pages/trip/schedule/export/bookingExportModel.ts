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
 * their screen speaks.
 *
 * ★ NO EMPTY PLACEHOLDERS ON AN EXTERNAL DOCUMENT. An optional value that is
 * absent — delivery time, customer, cargo, operational note — is left out, and
 * a section left with nothing is left out too. What the document is FOR always
 * prints: the pickup day, both ends of the route, and the crew (or "Chưa phân
 * công"). Only content decides what is omitted — never the exporter's role.
 *
 * ★ ON THE BUSINESS CLOCK (Asia/Ho_Chi_Minh), not the exporter's — a laptop
 * abroad must not move a pickup to another hour on a document sent to a driver.
 */

export type DocumentBlock =
  | { kind: 'field'; label: string; value: string }
  | { kind: 'moment'; label: string; day: string; time: string | null }
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

/** The row, or nothing when the value is absent. */
const field = (label: string, value: string | null | undefined): DocumentBlock[] => {
  const text = value?.trim();
  return text ? [{ kind: 'field', label, value: text }] : [];
};

/** "Thứ Ba, 06/10/2026" — the office's day for an instant. */
const businessDay = (iso: string): string => formatCalendarWeekday(todayAsCalendarDay(new Date(iso)), 'vi');

/** "Thứ Ba, 06/10/2026 · 16:00" — the office's day and hour. */
const businessMoment = (iso: string): string => `${businessDay(iso)} · ${businessClockOf(iso)}`;

/** When one end happens: its day, and its hour once one is booked — apart, so the hour can stand out. */
const moment = (label: string, day: string, at: string | null): DocumentBlock => ({
  kind: 'moment',
  label,
  day,
  time: at ? businessClockOf(at) : null,
});

/** One end: the place's name, then its address and contact as they were booked. */
const stop = (label: string, place: BookingExportStop): DocumentBlock => {
  const lines = [place.address?.trim(), place.contact?.trim() && `Liên hệ: ${place.contact.trim()}`].filter(
    (line): line is string => Boolean(line),
  );
  const name = place.name?.trim() || null;
  // A route end is structural: one with nothing on file still says so.
  return { kind: 'stop', label, name, lines: name || lines.length > 0 ? lines : ['Chưa xác định'] };
};

export function bookingDocument(booking: BookingExport, exportedAt: Date): BookingDocument {
  const sections: DocumentSection[] = [
    {
      heading: 'Thời gian',
      blocks: [
        // Always a day; the hour only once one is booked. Delivery only when one is.
        moment(
          'Lấy hàng',
          booking.scheduledPickupAt ? businessDay(booking.scheduledPickupAt) : formatCalendarWeekday(booking.scheduledOn, 'vi'),
          booking.scheduledPickupAt,
        ),
        ...(booking.scheduledDeliveryAt
          ? [moment('Giao hàng', businessDay(booking.scheduledDeliveryAt), booking.scheduledDeliveryAt)]
          : []),
      ],
    },
    {
      heading: 'Lộ trình',
      blocks: [stop('Điểm lấy hàng', booking.pickup), stop('Điểm giao hàng', booking.delivery)],
    },
    {
      heading: 'Khách hàng & hàng hóa',
      blocks: [
        ...field('Khách hàng', booking.customerName),
        ...field('Hàng hóa', booking.cargoInfo),
        ...field('Ghi chú vận hành', booking.driverInstructions),
      ],
    },
    {
      heading: 'Xe & tài xế',
      // Every lorry the server listed — never truncated (ADR-0004: 0..N).
      blocks:
        booking.crew.length > 0
          ? booking.crew.map((member) => ({ kind: 'crew', plate: formatPlate(member.plate) || 'Chưa có xe', driver: member.driverName }))
          : [{ kind: 'empty', text: 'Chưa phân công' }],
    },
  ];
  return {
    brand: 'HOÀNG LONG LOGISTICS',
    title: 'PHIẾU BOOKING',
    subtitle: 'Booking confirmation',
    sections: sections.filter((section) => section.blocks.length > 0),
    footer: [`Ngày xuất: ${businessMoment(exportedAt.toISOString())}`, 'Thông tin phục vụ xác nhận và vận hành booking.'],
  };
}
