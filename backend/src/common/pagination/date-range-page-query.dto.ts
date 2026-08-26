import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT } from './cursor';

/**
 * `?from=&to=&page=&limit=` — the query for a list paginated by page number over
 * a bounded date range.
 *
 * The bound is not a convenience. It is the entire premise that makes offset
 * pagination defensible here rather than the keyset the rest of the project
 * uses — see the header of `./offset-page` and ADR-0003. Everything below
 * exists to guarantee the range is present and small, so no reader of this list
 * can ever escape the argument that justified it.
 */

/**
 * The calendar the business runs on.
 *
 * ★ NOT THE SERVER'S CLOCK. `scheduled_on` is a `DATE` — a day on a wall
 * calendar, with no timezone — and the default range has to mean "this month"
 * to the person in the office. A server in UTC computing `new Date()` answers
 * AUGUST to a dispatcher who is looking at 06:00 on 1 September in Hồ Chí Minh,
 * because UTC+7 has not rolled over yet. That is a wrong answer roughly every
 * month, at exactly the hour the month's first trips are being entered.
 *
 * Hardcoded rather than configured: this deployment is one operator in one
 * country, and a setting nobody sets is a setting nobody keeps correct.
 */
const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * The widest range a caller may ask for.
 *
 * A year plus a day, so "the whole of last year" and "the last 12 months" both
 * fit without a caller having to know about the boundary. Past this the result
 * set stops being bounded in any useful sense and the offset argument fails.
 */
const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Milliseconds at midnight UTC of a `YYYY-MM-DD` already known to be real. */
const epochOf = (iso: string): number => Date.UTC(...splitDate(iso));

const splitDate = (iso: string): [number, number, number] => {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return [year, month - 1, day];
};

/**
 * Is this a real day, written the one way this API accepts?
 *
 * ONE check rather than a regex followed by a calendar check, so a malformed
 * value produces ONE issue. Two issues on the same field would reach
 * `ZodValidationPipe`, which keys `details` by path — the second would
 * overwrite the first, and which message survived would depend on issue order.
 *
 * The calendar half is not pedantry: the shape `2026-02-31` passes any regex
 * and reaches PostgreSQL as a cast error, which surfaces as a 500 rather than
 * "your query string is wrong". Round-tripping through UTC catches it, because
 * an overflowing day silently rolls into the next month.
 */
const isRealIsoDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;

  const [year, monthIndex, day] = splitDate(value);
  const date = new Date(Date.UTC(year, monthIndex, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthIndex &&
    date.getUTCDate() === day
  );
};

const isoDate = z
  // The empty string is what a client sends when it forwards a cleared filter
  // input without checking. Treated as absent, exactly as `cursor` is.
  .preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().refine(isRealIsoDate, 'Expected a real date written as YYYY-MM-DD.').optional(),
  )
  .optional();

/** Today on the business calendar, as `YYYY-MM-DD`. */
export function businessToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const part = (type: 'year' | 'month' | 'day'): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '01';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The month containing `now`, on the business calendar.
 *
 * This is what a caller gets when they name neither end of the range — the view
 * the Excel sheet gave them, where one sheet was one month.
 */
export function currentBusinessMonth(now: Date): { from: string; to: string } {
  const today = businessToday(now);
  const [year, monthIndex] = splitDate(today);

  // Day 0 of the NEXT month is the last day of this one, for every month
  // length, leap years included.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const month = String(monthIndex + 1).padStart(2, '0');

  return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Builds the schema. Takes its clock so the defaulting is testable without
 * mocking global time.
 */
export const buildDateRangePageQuerySchema = (now: () => Date = () => new Date()) =>
  z
    .object({
      from: isoDate,
      to: isoDate,

      /**
       * 1-based, because that is what the page shows. Coerced because query
       * strings are always strings; `.int()` rejects `1.5`, and there is no
       * upper bound because a page past the end is a legal empty page rather
       * than an error (see `toOffsetPage`).
       */
      page: z.coerce.number().int().min(1).default(1),

      /**
       * Same contract as the keyset lists — one maximum for the whole API. Out
       * of range is refused rather than clamped: a caller asking for 5,000 rows
       * has misunderstood something, and quietly handing back 200 hides that.
       */
      limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    })
    /**
     * ★ THE RANGE IS ALWAYS PRESENT AFTER THIS POINT.
     *
     * A caller may omit one end or both; what a caller may NOT do is read this
     * list unbounded, because the pagination strategy is only correct while it
     * is bounded. Omitting both means the current month; omitting one means the
     * matching end of the month that the other one falls in.
     */
    .transform(({ from, to, page, limit }) => {
      const month = currentBusinessMonth(now());

      const resolvedFrom = from ?? (to ? monthStartOf(to) : month.from);
      const resolvedTo = to ?? (from ? monthEndOf(from) : month.to);

      return { from: resolvedFrom, to: resolvedTo, page, limit };
    })
    .refine((query) => epochOf(query.to) >= epochOf(query.from), {
      message: 'The end of the range must not be before its start.',
      path: ['to'],
    })
    .refine(
      (query) => (epochOf(query.to) - epochOf(query.from)) / DAY_MS + 1 <= MAX_RANGE_DAYS,
      {
        message: `A range may span at most ${MAX_RANGE_DAYS} days.`,
        path: ['to'],
      },
    );

const monthStartOf = (iso: string): string => `${iso.slice(0, 7)}-01`;

const monthEndOf = (iso: string): string => {
  const [year, monthIndex] = splitDate(iso);
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
};

export const dateRangePageQuerySchema = buildDateRangePageQuerySchema();

export type DateRangePageQuery = z.infer<typeof dateRangePageQuerySchema>;
