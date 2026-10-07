import type { BookingExport } from '@/types/bookingExport';
import { businessClockOf } from '@/utils/format/datetime';

/**
 * Saving the booking PNG — the browser's own download, nothing uploaded.
 */

/**
 * `booking-<customer>-<pickup day>-<pickup HHmm>-xuat-<export HHmmss>.png`, e.g.
 * `booking-KAPV-2026-10-06-1600-xuat-153012.png` — `-<HHmm>` only once an hour
 * is booked, `<customer>` only when there is one.
 *
 * ★ READABLE, AND ONE NAME PER EXPORT. A trip has no user-facing
 * code and its id is internal, so the name is what a person reads on the
 * booking: the customer, the pickup day and hour. One customer may book several
 * lorries for the same hour, and the browser cannot see the download folder —
 * so the export's own second is always appended: the "Ngày xuất" the document
 * prints, on the same Hồ Chí Minh clock.
 *
 * ★ SAFE ON EVERY FILESYSTEM: diacritics folded (`Đông Á` → `Dong-A`), anything
 * but letters and digits collapsed to one hyphen, the customer capped after a
 * whole word. No internal id ever appears.
 */
export function bookingPngFileName(
  booking: Pick<BookingExport, 'customerName' | 'scheduledOn' | 'scheduledPickupAt'>,
  exportedAt: Date,
): string {
  const folded = (booking.customerName ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, (letter) => (letter === 'đ' ? 'd' : 'D'))
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // At most 40 characters, cut after a whole word — never `Thuc-pha`.
  const head = folded.slice(0, 41);
  const lastBreak = head.lastIndexOf('-');
  const cut = lastBreak > 0 ? lastBreak : 40;
  const customer = folded.length <= 40 ? folded : head.slice(0, cut);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(booking.scheduledOn) ? booking.scheduledOn : 'undated';
  const hour = booking.scheduledPickupAt && businessClockOf(booking.scheduledPickupAt).split(':').join('');
  return `${['booking', customer, day, hour, 'xuat', businessSecondOf(exportedAt)].filter(Boolean).join('-')}.png`;
}

/** `HHmmss` on the business clock — fixed +07:00, as `businessInstant` (Vietnam keeps no daylight saving). */
const businessSecondOf = (at: Date): string => {
  const local = new Date(at.getTime() + 7 * 3_600_000).toISOString();
  return local.slice(11, 13) + local.slice(14, 16) + local.slice(17, 19);
};

/**
 * Downloads `blob` — the SAME blob the preview shows — as `fileName`.
 *
 * The object URL lives only for the click. ponytail: revoked after a minute,
 * not at once — Safari reads a blob URL lazily, and an early revoke saves an
 * empty file there. Revoke on the download event if a browser ever offers one.
 */
export function downloadPng(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
