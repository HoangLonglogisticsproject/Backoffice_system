/**
 * Offset pagination — THE EXCEPTION, not the default.
 *
 * ★ READ THIS BEFORE COPYING THIS FILE INTO A NEW LIST.
 *
 * The house style is keyset (`./cursor`), and ADR-0002 gives the measurements:
 * `OFFSET 800000` cost 941.9 ms and spilled 22 MB of sort to disk where the
 * equivalent keyset page cost 0.279 ms — and, worse than the milliseconds,
 * OFFSET is WRONG under concurrent writes, because a row inserted at the head
 * shifts every later row by one and the page boundary is read twice.
 *
 * Both objections are arguments about an UNBOUNDED list. Neither survives a
 * mandatory date range:
 *
 *   - `OFFSET` is never deep, because the range caps the result set. The trip
 *     schedule defaults to the current month (~60–100 rows) and refuses a span
 *     over 366 days, so the deepest reachable offset is a few hundred rows.
 *   - `COUNT(*)` never scans the table, for the same reason and because the
 *     partial index leads with the range column.
 *   - The boundary-shift defect needs an insert INSIDE the range being read
 *     while it is read. Rows are dated dispatch work, so a same-second insert
 *     into the month somebody is paging is possible but rare, and its cost is
 *     one row seen twice on a screen that is refreshed constantly — not the
 *     silent loss that made it unacceptable for a membership audit list.
 *
 * What offset buys in return is what keyset deliberately refuses to provide:
 * `total`, and therefore "page 2 of 3". Dispatch needs both — "how many trips
 * this month" is the question the sheet existed to answer.
 *
 * ⚠ THE JUSTIFICATION IS THE BOUNDED RANGE, NOT A PREFERENCE. If a caller ever
 * gets to ask for this list without a range, or the 366-day cap is lifted, the
 * reasoning above is void and the list has to go back to keyset. That is why
 * `date-range-page-query.dto.ts` DEFAULTS the range rather than allowing it to
 * be absent.
 *
 * See `docs/architecture/adr-0003-trip-schedule-offset-pagination.md`.
 */

/**
 * A page of rows addressed by number.
 *
 * Unlike `Page<T>` this carries `total`, which is the whole reason it exists.
 * `totalPages` is derived rather than sent separately so a client can never
 * hold two numbers that disagree.
 */
export interface OffsetPage<T> {
  items: T[];
  /** 1-based, echoed back so a client can trust what it is looking at. */
  page: number;
  limit: number;
  /** Rows matching the filter, not rows on this page. */
  total: number;
  /** `0` when `total` is `0` — there is no "page 1 of 0" to navigate to. */
  totalPages: number;
}

/**
 * Assembles the envelope.
 *
 * `total` comes from `COUNT(*) OVER()` on the same query that fetched the rows,
 * so the count and the page are consistent by construction — two round trips
 * could see two different states and produce a page that does not fit its own
 * total.
 *
 * ⚠ A page past the end is EMPTY, NOT AN ERROR. `?page=99` on a 3-page list
 * returns `items: []` with the real `total`, which lets a client that held a
 * stale page number recover by reading `totalPages` instead of by handling a
 * 404 that says nothing about where to go instead.
 */
export function toOffsetPage<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): OffsetPage<T> {
  return {
    items,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
