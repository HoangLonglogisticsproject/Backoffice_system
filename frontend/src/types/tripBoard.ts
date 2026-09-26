import type { TripScheduleWithRefs } from './trip';

/**
 * The dispatch board's read model: its orders, and the one cost figure a row
 * may carry. Mirrors `backend/.../domain/trip-board.ts`.
 */

/**
 * ★ WHAT A DISPATCHER MEANS, NOT A COLUMN NAME. The server maps each to a
 * column and refuses anything else with a 422; this client never names a
 * column.
 *
 *   executionDate    the day the run happens (the default)
 *   bookingCreated   when the trip was entered on the board
 *   lastUpdated      the last edit to the trip row itself — a new crew or a new
 *                    cost line does not move it
 */
export type TripBoardSort = 'executionDate' | 'bookingCreated' | 'lastUpdated';

export const TRIP_BOARD_SORTS: readonly TripBoardSort[] = [
  'executionDate',
  'bookingCreated',
  'lastUpdated',
];

export type SortDirection = 'asc' | 'desc';

export interface TripBoardOrder {
  sort: TripBoardSort;
  direction: SortDirection;
}

/** The order the board opens in — and the one the server applies to a request naming none. */
export const DEFAULT_TRIP_BOARD_ORDER: TripBoardOrder = { sort: 'executionDate', direction: 'desc' };

/**
 * What one trip has cost — the same figure as the cost dialog's "Tổng chi phí
 * chuyến". `total` is a decimal STRING; format it, never parse it.
 */
export interface TripCostSummary {
  total: string;
  /** Live cost lines plus live hires. `0` exactly when nothing is recorded. */
  itemCount: number;
}

/**
 * One row of `GET /trip-schedules`.
 *
 * ★ `costSummary` IS `null` UNLESS THE CALLER HOLDS `cost.read` — the server
 * does not compute it for anybody else. `null` means "not yours to see", never
 * "cost nothing": that is `{ total: "0.00", itemCount: 0 }`.
 */
export interface TripBoardRow extends TripScheduleWithRefs {
  costSummary: TripCostSummary | null;
}
