import type { SortDirection, TripBoardOrder, TripBoardSort } from '../domain/trip-board';

/**
 * The board's `ORDER BY`, as trusted SQL.
 *
 * ★ NOT BUILT FROM INPUT. Both maps are TOTAL over unions the DTO has already
 * narrowed, so the only strings that can reach a statement are the ones written
 * here. `ORDER BY ${query.sort}` is the shape this file exists to prevent.
 */
const SORT_COLUMN: Record<TripBoardSort, string> = {
  executionDate: 't.scheduled_on',
  bookingCreated: 't.created_at',
  lastUpdated: 't.updated_at',
};

const DIRECTION_SQL: Record<SortDirection, 'ASC' | 'DESC'> = { asc: 'ASC', desc: 'DESC' };

/**
 * ★ EVERY ORDER ENDS IN `t.id`, IN THE SAME DIRECTION. Two trips on one day,
 * or two rows written in one transaction, share the sort value; without a
 * unique tiebreaker PostgreSQL may return them in either order on each read,
 * and an offset page boundary between them shows one row twice and the other
 * never.
 *
 * Same direction as the key so `executionDate desc` stays exactly
 * `idx_trip_schedule_page`'s `(scheduled_on DESC, id DESC)` — and `asc` is that
 * index read backwards. A mixed direction would add a sort step on top.
 */
export const orderBySql = ({ sort, direction }: TripBoardOrder): string => {
  const dir = DIRECTION_SQL[direction];
  return `ORDER BY ${SORT_COLUMN[sort]} ${dir}, t.id ${dir}`;
};
