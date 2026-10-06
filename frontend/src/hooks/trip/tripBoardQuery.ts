import type { TripScheduleQuery } from '@/api/tripSchedule';
import type { OffsetPage, OffsetPageRequest } from '@/types/pagination';
import type { TripBoardListFilter } from './keys';

/**
 * How the board's list and its tab badge become requests.
 *
 * ★ THE LIST'S CACHE KEY AND ITS REQUEST COME FROM ONE VALUE. `useTripSchedules`
 * builds one `TripBoardListFilter`; the key is that filter, and the request is
 * derived from it here. Built side by side, a parameter added to the request
 * and forgotten in the key would serve one list's cached pages as another's —
 * the exact collision the key exists to prevent.
 */

/**
 * One page of the board list, as `GET /trip-schedules` takes it.
 *
 * ★ A WHITELIST, SO `costs` NEVER LEAVES THE BROWSER. It partitions the cache
 * (`tripKeys.scheduleList`); it is not a parameter. What a caller may see is
 * the server's decision, from the session — never from anything sent here.
 */
export const boardListRequest = (
  { from, to, assignment, lifecycle, sort, direction, customer }: TripBoardListFilter,
  { page, limit }: OffsetPageRequest,
): TripScheduleQuery => ({
  from,
  to,
  assignment,
  lifecycle,
  sort,
  direction,
  page,
  limit,
  // Sent as typed; the server trims it and reads an empty one as "no filter".
  customer,
});

/**
 * The tab badge's read: how many trips in the range still have nobody on them.
 *
 * ★ `limit: 1` IS WHY IT IS AFFORDABLE. The server computes `total` with
 * `COUNT(*) OVER()` on the same statement whatever the page size, so one row is
 * as good as all of them. No order: a count has none, which also means
 * re-sorting the board does not re-read the badge.
 */
export const unassignedCountRequest = ({
  from,
  to,
  customer,
}: Pick<TripBoardListFilter, 'from' | 'to' | 'customer'>): TripScheduleQuery => ({
  from,
  to,
  page: 1,
  limit: 1,
  assignment: 'unassigned',
  // The queue is Lịch xe's: a finished trip is nobody's work to crew.
  lifecycle: 'operational',
  /**
   * ★ THE BADGE OBEYS THE SEARCH TOO, because the two are read together. A
   * dispatcher who has narrowed the board to one customer is looking at a tab
   * saying "chờ phân công"; a number counting every OTHER customer's uncrewed
   * trips beside a list that shows none of them describes a board nobody is on.
   */
  customer,
});

/**
 * A page with its rows dropped — what the badge keeps in the cache.
 *
 * ★ THE ONE ROW IS DROPPED BEFORE ANYTHING IS STORED. For a `cost.read` caller
 * it carries a cost figure, and the badge's key is not one the cost purge in
 * `useTripCost` looks at. It stays an `OffsetPage` rather than becoming a bare
 * number so every entry under `tripKeys.schedules()` keeps one shape.
 */
export const withoutRows = <T>(page: OffsetPage<T>): OffsetPage<T> => ({ ...page, items: [] });
