/**
 * The text of the date and time controls (`DateInput`, `TimeInput`): what is
 * shown, what is read back, and the canonical value it becomes.
 *
 * ★ PRESENTATION ONLY. The canonical values are the ones the forms already
 * hold — a day as `YYYY-MM-DD`, an hour as 24-hour `HH:mm` — so nothing here
 * knows about time zones or instants; turning a day and an hour into an
 * instant stays where it was (`businessInstant`).
 */

const pad2 = (value: string | number): string => String(value).padStart(2, '0');
const digitsOf = (text: string, max: number): string => text.replace(/\D/g, '').slice(0, max);

/** Before noon, after noon — in this order, always, whatever the browser's locale. */
export type Period = 'AM' | 'PM';
export const PERIODS: readonly Period[] = ['AM', 'PM'];

const to24 = (hour12: number, period: Period): number => (hour12 % 12) + (period === 'PM' ? 12 : 0);

/**
 * An hour as written — 24-hour `21:30`, `930`, or 12-hour `9:30 PM` — as
 * 24-hour `HH:mm`, or `null`. The picker writes the value itself; this reads
 * the value the form hands back, and an hour pasted into the field.
 */
export const parseClockTime = (text: string): string | null => {
  const match = /^(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i.exec(text.trim());
  if (!match) return null;
  const written = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.toUpperCase() as Period | undefined;
  if (minutes > 59) return null;
  if (period) return written >= 1 && written <= 12 ? `${pad2(to24(written, period))}:${pad2(minutes)}` : null;
  return written < 24 ? `${pad2(written)}:${pad2(minutes)}` : null;
};

/** What the time picker has chosen so far: hour 1–12, minute 0–59, AM or PM — any of them still open. */
export interface ClockParts {
  hour: number | null;
  minute: number | null;
  period: Period | null;
}

export const NO_CLOCK_PARTS: ClockParts = { hour: null, minute: null, period: null };

/** `21:30` as the picker shows it: 9, 30, PM. `''` is nothing chosen. */
export const partsOf = (value: string): ClockParts => {
  const canonical = parseClockTime(value);
  if (!canonical) return NO_CLOCK_PARTS;
  const [hours = 0, minutes = 0] = canonical.split(':').map(Number);
  return { hour: hours % 12 === 0 ? 12 : hours % 12, minute: minutes, period: hours < 12 ? 'AM' : 'PM' };
};

/** The picker's choice as the form holds it — 9, 30, PM is `21:30` — or `null` while a part is open. */
export const canonicalOf = ({ hour, minute, period }: ClockParts): string | null =>
  hour === null || minute === null || period === null ? null : `${pad2(to24(hour, period))}:${pad2(minute)}`;

/** The closed field: `09:30 PM`, `09:-- --` while half chosen, `''` when nothing is. */
export const displayClock12 = ({ hour, minute, period }: ClockParts): string =>
  hour === null && minute === null && period === null
    ? ''
    : `${hour === null ? '--' : pad2(hour)}:${minute === null ? '--' : pad2(minute)} ${period ?? '--'}`;

const minuteOfDay = (canonical: string): number => {
  const [hours = 0, minutes = 0] = canonical.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Which picks would land before `min` (24-hour `HH:mm`), each judged with the
 * parts already chosen. An hour or a period is closed only when even its last
 * minute is too early; a minute is closed once the hour says which. Mirrors
 * the form's rule — the server holds it.
 */
export const blockedPicks = (min: string | undefined, parts: ClockParts) => {
  const floor = min ? minuteOfDay(min) : -1;
  const at = (hour12: number, period: Period, minute: number) => to24(hour12, period) * 60 + minute;
  const periods = parts.period ? [parts.period] : PERIODS;
  return {
    hour: (hour12: number) => periods.every((period) => at(hour12, period, 59) < floor),
    minute: (minute: number) => {
      const { hour } = parts;
      return hour !== null && periods.every((period) => at(hour, period, minute) < floor);
    },
    period: (period: Period) => at(parts.hour ?? 11, period, 59) < floor,
  };
};

/** A real calendar day — 31/02 is not one. */
const isCalendarDay = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/**
 * A day as typed — `03/10/2026`, `3/10/2026`, `03102026`, or a pasted
 * `2026-10-03` — as `YYYY-MM-DD`, or `null`. Day first, as Vietnam writes it.
 */
export const parseCalendarDate = (text: string): string | null => {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const written = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const packed = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  let parts: [string, string, string] | null = null;
  if (iso) parts = [iso[1]!, iso[2]!, iso[3]!];
  else if (written) parts = [written[3]!, written[2]!, written[1]!];
  else if (packed) parts = [packed[3]!, packed[2]!, packed[1]!];
  if (!parts) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  return year >= 1900 && isCalendarDay(year, month, day) ? `${parts[0]}-${pad2(month)}-${pad2(day)}` : null;
};

/**
 * The day as it is being typed: `dd/mm/yyyy`, the slashes put in as the digits
 * arrive. A slash typed by hand is kept (`3/10/2026`), and a digit typed past
 * a full part moves on to the next one — `05/10` then `2` is `05/10/2`, not a
 * dropped keystroke. A pasted ISO day (`2026-…`) is left for
 * `parseCalendarDate` to read.
 */
export const maskCalendarDate = (text: string): string => {
  if (/^\d{4}-/.test(text)) return text.slice(0, 10);
  if (!text.includes('/')) {
    const digits = digitsOf(text, 8);
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
  }
  const typed = text.split('/').map((part) => part.replace(/\D/g, ''));
  const parts: string[] = [];
  let carry = '';
  for (const [index, max] of [2, 2, 4].entries()) {
    const part = carry + (typed[index] ?? '');
    parts.push(part.slice(0, max));
    carry = part.slice(max);
  }
  const [day, month, year] = parts as [string, string, string];
  const withMonth = typed.length > 1 || month !== '';
  const withYear = typed.length > 2 || year !== '';
  return `${day}${withMonth ? `/${month}` : ''}${withYear ? `/${year}` : ''}`;
};

/** `YYYY-MM-DD` as Vietnam writes it, `dd/mm/yyyy`; `''` stays `''`. */
export const displayCalendarDate = (day: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};
