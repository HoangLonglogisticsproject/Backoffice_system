/**
 * The envelope every paginated list returns.
 *
 * The backend moved these lists from a bare array to a page, because the
 * unpaginated versions sequentially scanned and spilled sort to disk — the
 * department request and invitation lists carry no status filter and grow with
 * the deployment's age, so they had no natural bound at all.
 *
 * KEYSET, not offset: `nextCursor` is an opaque position, not a page number.
 * There is deliberately no total count — producing one costs the full scan that
 * pagination exists to avoid — so a client pages until `hasMore` is false and
 * never computes "page 7 of 41".
 */
export interface Page<T> {
  items: T[];
  /** Opaque. Hand it back verbatim; never construct or parse one. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** What a caller may ask for. `limit` defaults to 50 server-side, max 200. */
export interface PageRequest {
  limit?: number;
  /** Omit for the first page. A malformed value is a 422, not a silent restart. */
  cursor?: string;
}

/**
 * The OTHER envelope, returned by exactly one endpoint: `GET /trip-schedules`.
 *
 * ★ DO NOT WRITE A READER THAT HANDLES BOTH SHAPES. They are different
 * contracts, not two spellings of one — this one has page numbers and a total,
 * the keyset one deliberately has neither. A function that accepts either would
 * have to guess which it got, and would quietly do the wrong thing the first
 * time a field was missing for an unrelated reason.
 *
 * The trip schedule can afford a count because its date range is mandatory and
 * capped at 366 days, so neither the offset nor the `COUNT(*)` is ever deep. If
 * that bound is ever lifted the endpoint goes back to keyset — see
 * `docs/architecture/adr-0003-trip-schedule-offset-pagination.md`. Nothing else
 * in this API should adopt this shape.
 */
export interface OffsetPage<T> {
  items: T[];
  /** 1-based, echoed back. */
  page: number;
  limit: number;
  /** Rows matching the filter, not rows on this page. */
  total: number;
  /** `0` for an empty result — there is no "page 1 of 0" to navigate to. */
  totalPages: number;
}

/**
 * What the trip schedule accepts.
 *
 * `from`/`to` are `YYYY-MM-DD` STRINGS, never `Date`s. The column behind them is
 * a calendar day with no timezone, and `new Date('2026-08-04').toISOString()`
 * silently answers with a different day for anyone west of UTC.
 */
export interface OffsetPageRequest {
  from?: string;
  to?: string;
  /** 1-based. A page past the end is an empty page, not an error. */
  page?: number;
  limit?: number;
}
