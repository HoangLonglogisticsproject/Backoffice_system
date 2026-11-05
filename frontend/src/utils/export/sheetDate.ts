import { businessWallClock } from '@/utils/format/datetime';

/**
 * Days and times as spreadsheet DATES — numbers Excel sorts, filters and
 * subtracts — rather than text that only looks like one.
 *
 * ★ TEXT WAS THE BUG. "5/11/2026" written as a string sorts after "10/11/2026",
 * and the same export from an English screen wrote "11/5/2026". A date cell is
 * a serial number with a display format, so the value is the same for every
 * reader and the format pins the order to dd/mm/yyyy whatever their locale.
 *
 * ★ TWO KINDS OF VALUE, TWO RULES, and mixing them is how a day moves:
 *
 *   `scheduled_on`  a DATE — a day on the wall calendar, no zone. Converted
 *                   from its digits; no `Date` and no time zone ever touch it.
 *   `pickup_at`     a TIMESTAMPTZ — an instant. Converted to Hồ Chí Minh's
 *                   wall clock explicitly, never the browser's zone.
 *
 * An Excel serial carries no zone of its own: the cell shows exactly the wall
 * clock written into it, which is why the conversion happens here.
 */

const DAY_MS = 86_400_000;
/** Excel's day 0 — the serial of a day is its distance from here. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const serialOf = (utcMs: number): number => (utcMs - EXCEL_EPOCH) / DAY_MS;

/** How a day cell reads. */
export const SHEET_DAY_FORMAT = 'dd/mm/yyyy';
/** How an instant reads — to the minute, like the board. */
export const SHEET_TIME_FORMAT = 'dd/mm/yyyy hh:mm';

/** `"2026-11-08"` → 46334. Anything that is not exactly a day is `null`, an empty cell. */
export const sheetDay = (day: string | null): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (!match) return null;
  return serialOf(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};

/** An instant as Hồ Chí Minh's wall clock, as a serial — `null` (an empty cell) when there is none. */
export const sheetInstant = (iso: string | null): number | null => {
  const clock = iso ? businessWallClock(iso) : null;
  if (!clock) return null;
  return serialOf(Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second));
};
