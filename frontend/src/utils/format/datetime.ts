import type { Language } from '@/types/translate';

/**
 * Dates rendered in the language the interface is speaking.
 *
 * ★ NOT THE BROWSER'S LOCALE. `toLocaleDateString()` with no argument reads the
 * browser, which is a different setting from the one the user picked in this
 * app — so a Vietnamese interface on an en-US machine renders `8/21/2026` in
 * the middle of Vietnamese text. The language the user chose is the one that
 * should decide.
 */
const LOCALES: Record<Language, string> = {
  vi: 'vi-VN',
  en: 'en-US',
};

/**
 * ★ THE FORMATTERS ARE BUILT ONCE AND KEPT.
 *
 * `date.toLocaleDateString(locale)` constructs a fresh `Intl.DateTimeFormat` on
 * EVERY call, and building one is the expensive half of formatting: it resolves
 * the locale and loads its data. The dispatch board renders up to three dates
 * per row over a full page, so a naive render pays for a hundred locale
 * resolutions to produce a hundred short strings.
 *
 * ⚠ THE OPTIONS BELOW ARE NOT A RESTYLING. They are exactly what ECMA-402 fills
 * in when `toLocaleDateString`/`toLocaleString` is called with no options —
 * `ToDateTimeOptions` defaults every component to `numeric` — so the rendered
 * text is unchanged. Verify that before touching them: a difference here is a
 * silent change to every date in the app.
 */
type FormatterKind = 'date' | 'dateTime' | 'utcDay';

const OPTIONS: Record<FormatterKind, Intl.DateTimeFormatOptions> = {
  // `toLocaleDateString()` with no options.
  date: { year: 'numeric', month: 'numeric', day: 'numeric' },

  // `toLocaleString()` with no options — date AND time, seconds included.
  dateTime: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  },

  // A calendar day, pinned to UTC. See `formatCalendarDay` for why.
  utcDay: { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' },
};

// Two languages times three kinds: six entries at most, so this never grows
// into a leak worth bounding.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(kind: FormatterKind, language: Language): Intl.DateTimeFormat {
  const key = `${kind}:${language}`;
  const cached = formatters.get(key);
  if (cached) return cached;

  const built = new Intl.DateTimeFormat(LOCALES[language], OPTIONS[kind]);
  formatters.set(key, built);
  return built;
}

/** An ISO timestamp from the API as a date, in `language`. */
export function formatDate(iso: string, language: Language): string {
  const date = new Date(iso);
  // A malformed timestamp is the server's problem to fix, not a reason to throw
  // inside a table cell — show the raw value so it is visibly wrong.
  return Number.isNaN(date.getTime()) ? iso : formatter('date', language).format(date);
}

/** The same, with the time of day — for queues where ordering matters. */
export function formatDateTime(iso: string, language: Language): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatter('dateTime', language).format(date);
}

/**
 * A CALENDAR DAY — `"2026-08-04"` — rendered in `language`.
 *
 * ★ SEPARATE FROM `formatDate` BECAUSE THE INPUT IS NOT AN INSTANT. The trip
 * schedule's `scheduledOn` comes from a PostgreSQL `DATE`: a day on a wall
 * calendar, with no time and no timezone. Handing it to `new Date()` makes it
 * midnight UTC, and `toLocaleDateString` then renders THE PREVIOUS DAY for
 * every viewer west of UTC — silently, on every row.
 *
 * So the parts are split by hand and fed to a UTC-pinned formatter, which never
 * shifts anything. Anything that is not exactly `YYYY-MM-DD` is shown raw, as
 * `formatDate` does, so a server-side mistake is visible rather than disguised.
 */
export function formatCalendarDay(day: string, language: Language): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;

  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const asUtc = new Date(Date.UTC(year, month - 1, date));

  // A day that does not exist — `2026-02-31` — rolls over into the next month
  // rather than throwing, so it is caught here and shown as it arrived.
  if (asUtc.getUTCMonth() !== month - 1 || asUtc.getUTCDate() !== date) return day;

  return formatter('utcDay', language).format(asUtc);
}

/**
 * Today as `YYYY-MM-DD` on the VIEWER's calendar.
 *
 * `toISOString().slice(0, 10)` is the tempting one-liner and it is wrong for the
 * same reason as above: it converts to UTC first, so at 06:00 in Hồ Chí Minh on
 * 1 September it answers `2026-08-31`, and the schedule opens on the wrong
 * month at exactly the hour that month's first trips are entered.
 */
/**
 * ★ THE BUSINESS CALENDAR, AND IT IS NOT THE VIEWER'S.
 *
 * The company operates on `Asia/Ho_Chi_Minh` (contract §10.6), and the server
 * resolves every unbounded date range on that calendar. A browser reading its
 * own clock disagrees for a slice of every day: at 23:30 UTC on 31 August it is
 * already 1 September in Hồ Chí Minh, so a laptop in London would open the
 * board on August while the server — and everybody in the office — is on
 * September.
 *
 * That is not a display preference. It decides which MONTH is queried and which
 * DAY a new trip defaults to, so it has to be the same calendar the server uses.
 * `Intl` with an explicit `timeZone` is exactly what the backend's
 * `businessToday` does, deliberately mirrored here.
 *
 * ⚠ THIS IS THE ONLY PLACE THE FRONTEND MAY DERIVE A BUSINESS DATE. Formatting
 * an instant for display still uses the viewer's zone — a driver in the cab
 * should see their own wall clock — but what is ASKED FOR is decided here.
 */
const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Built once: resolving a locale is the expensive half of formatting. */
const businessParts = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `[year, monthIndex, day]` on the business calendar. */
function businessYmd(now: Date): [number, number, number] {
  const parts = businessParts.formatToParts(now);
  const value = (type: 'year' | 'month' | 'day'): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '1');

  return [value('year'), value('month') - 1, value('day')];
}

export function todayAsCalendarDay(now: Date = new Date()): string {
  const [year, monthIndex, dayOfMonth] = businessYmd(now);
  const month = String(monthIndex + 1).padStart(2, '0');
  const day = String(dayOfMonth).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The first and last day of the month containing `now`, on the viewer's calendar. */
/**
 * The month a date filter opens on.
 *
 * ★ ON THE BUSINESS CALENDAR, so it matches what the server resolves when a
 * caller sends no range at all. Computed from the viewer's clock this returned
 * a different month for part of every day depending on where the browser was,
 * and the board would then query a month nobody in the office was looking at.
 */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  const [year, month] = businessYmd(now);

  // Day 0 of the next month is the last day of this one, for every month length
  // and every leap year, with no table to maintain. `Date.UTC` because the
  // arithmetic must not re-enter the viewer's zone.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const asDay = (date: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;

  return { from: asDay(1), to: asDay(lastDay) };
}

/**
 * An ISO instant as the value an `<input type="datetime-local">` wants.
 *
 * That control has no timezone: it shows and returns wall-clock time in the
 * viewer's zone, formatted `YYYY-MM-DDTHH:mm`. The local getters below produce
 * exactly that — `toISOString().slice(0, 16)` would put UTC into a local
 * control and shift every time by the viewer's offset.
 */
export function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * The inverse: a `datetime-local` value as the ISO instant the API stores.
 *
 * `new Date('2026-08-04T08:30')` — no trailing `Z` — is interpreted as LOCAL
 * time, which is what the control meant, so this is the one place a bare
 * `new Date` on a date-ish string is correct.
 */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
