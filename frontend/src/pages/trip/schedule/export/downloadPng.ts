/**
 * Saving the booking PNG — the browser's own download, nothing uploaded.
 */

/**
 * `booking-<reference>-YYYY-MM-DD.png` — the customer stands in for the
 * reference (a trip has no user-facing booking code), the day is the pickup day.
 *
 * ★ SAFE ON EVERY FILESYSTEM: diacritics folded (`Đông Á` → `Dong-A`), anything
 * but letters and digits collapsed to one hyphen, length capped. No internal id
 * ever appears. A trip with no customer is just `booking-<day>.png`.
 */
export function bookingPngFileName(customerName: string | null, scheduledOn: string): string {
  const folded = (customerName ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, (letter) => (letter === 'đ' ? 'd' : 'D'))
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // At most 40 characters, cut after a whole word — never `Thuc-pha`.
  const head = folded.slice(0, 41);
  const lastBreak = head.lastIndexOf('-');
  const reference = folded.length <= 40 ? folded : head.slice(0, lastBreak > 0 ? lastBreak : 40);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(scheduledOn) ? scheduledOn : 'undated';
  return reference ? `booking-${reference}-${day}.png` : `booking-${day}.png`;
}

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
