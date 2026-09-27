import { can, type AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import type { TripCostCategory } from './trip-cost';
import type { TripScheduleWithRefs } from './trip-schedule';

/**
 * The dispatch board's read model: how its rows are ordered, and the one money
 * figure a row may carry.
 */

/**
 * ★ THREE ORDERS, NAMED FOR WHAT A DISPATCHER MEANS, NOT FOR A COLUMN.
 *
 *   executionDate    the day the run happens — `scheduled_on`. The default.
 *   bookingCreated   when the trip was entered on the board — `created_at`.
 *   lastUpdated      the last edit to the trip ROW — `updated_at`.
 *
 * ⚠ `lastUpdated` IS THE ROW, NOT THE TRIP'S WHOLE STORY. The trigger moves it
 * on an edit, a status move or an archive. Dispatching a crew, recording a cost
 * or a driver milestone write other tables and leave it where it was.
 *
 * The column each one reads is decided in exactly one place,
 * `persistence/trip-board-order.ts`, from this union — never from the string a
 * caller sent.
 */
export const TRIP_BOARD_SORTS = ['executionDate', 'bookingCreated', 'lastUpdated'] as const;
export type TripBoardSort = (typeof TRIP_BOARD_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface TripBoardOrder {
  sort: TripBoardSort;
  direction: SortDirection;
}

/** What the board was ordered by before it could be ordered by anything else. */
export const DEFAULT_TRIP_BOARD_ORDER: TripBoardOrder = { sort: 'executionDate', direction: 'desc' };

/**
 * What one trip has cost, for a board cell.
 *
 * ★ THE SAME FIGURE AS `GET /trip-schedules/:id/cost-summary`'s `combined`.
 * Live `trip_costs` lines plus live `trip_outsource_hires`, voided records
 * excluded, added by PostgreSQL. A cell that disagreed with the dialog it opens
 * would make one of them a lie.
 *
 * ⚠ THAT INCLUDES A DRIVER'S LINE STILL AWAITING COMPLETION REVIEW (`editable`
 * or `locked`), because the canonical total does. Whether an unapproved figure
 * belongs in a trip's cost is a P&L question this read model does not decide.
 *
 * Every amount is a decimal STRING, `"0.00"` when nothing is recorded — see
 * `trip-cost.ts` for why an amount never becomes a `number`.
 *
 * ★ THE BREAKDOWN IS THE SAME LINES, SPLIT — NOT A SECOND FORMULA. The five
 * categories and `hires` add up to `total`, all summed by PostgreSQL in one
 * statement, so a sheet that shows both can never show two different sums.
 *
 * ⚠ `hires` IS NOT "GIÁ CƯỚC MUA". The trip's `purchasePrice` is a separate
 * field that may describe the same carrier payment; nothing reconciles the
 * two, so nothing here adds one to the other.
 */
export interface TripCostSummary {
  total: string;
  /** Live cost lines plus live hires. `0` exactly when `total` is `"0.00"`. */
  itemCount: number;
  /** Live own-vehicle lines, per canonical category; `"0.00"` where none. */
  byCategory: Record<TripCostCategory, string>;
  /** Live outsourced hires (`trip_outsource_hires`). */
  hires: string;
}

/**
 * One element of `GET /trip-schedules`.
 *
 * ★ `costSummary` IS `null` FOR A CALLER WITHOUT `cost.read`, AND IS NEVER
 * COMPUTED FOR ONE. Not blanked after the fact like the prices: the figure is
 * not read at all, so there is nothing in memory to leak.
 */
export type TripBoardRow = TripScheduleWithRefs & { costSummary: TripCostSummary | null };

/**
 * May this caller see what trips cost?
 *
 * `cost.read`, the key every cost route is guarded by, asked through the same
 * `can()` so the board and the cost dialog cannot come to different answers.
 * An absent context — a route that lost its guard — fails closed.
 */
export const canSeeTripCosts = (authorization: AuthorizationContext | undefined): boolean =>
  authorization !== undefined && can(authorization, 'cost.read');
