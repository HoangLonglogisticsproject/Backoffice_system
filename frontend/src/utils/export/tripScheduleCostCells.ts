import { TRIP_COST_CATEGORIES, TRIP_COST_CATEGORY_LABELS } from '@/types/tripCost';
import type { TripCostSummary } from '@/types/tripBoard';
import { sheetMoney } from './sheetMoney';
import type { Translate } from './tripScheduleSheet';

/**
 * The cost block of the exported sheet — what each trip cost us, split the way
 * the workbook's CHI PHÍ block split it.
 *
 * ★ NO ARITHMETIC HERE. Every figure is the server's `costSummary`, the same
 * one the board's cost column and the cost dialog show; this module only turns
 * each into a number cell. The total is the server's total — never the sum of
 * the cells beside it, and never touched by the trip's "Giá cước mua".
 *
 * ★ ONE ROW PER TRIP, BY CONSTRUCTION. A trip carries one summary however many
 * lines, categories or lorries it has, so nothing here can add a row.
 */

/**
 * The block's headings, in sheet order: one per canonical category (the
 * dialog's own words), the outsourced hires, then the total.
 */
export const tripSheetCostHeadings = (t: Translate): string[] => [
  ...TRIP_COST_CATEGORIES.map((category) => t(TRIP_COST_CATEGORY_LABELS[category])),
  t('costOutsource'),
  t('totalTripCost'),
];

/** How wide each of those columns opens, in the same order: 12 · 14 · 16. */
export const TRIP_SHEET_COST_WIDTHS: readonly number[] = [
  ...TRIP_COST_CATEGORIES.map(() => 12),
  14,
  16,
];

/**
 * One trip's cost cells, keyed by the headings above.
 *
 * Only ever called for a viewer holding `cost.read` — without it the block is
 * left out of the sheet altogether (`toTripSheetRows`), decided from the
 * session, never from the rows.
 *
 * ★ NO LIVE LINE IS A BLANK, NEVER A 0 — the trip finished or not. The server
 * answers a category with nothing recorded as "0.00", which in a FILE reads as
 * "confirmed to have cost nothing" — a claim nobody made. Every recorded
 * amount is > 0 (`trip_costs.amount`, `trip_outsource_hires.agreed_amount`,
 * 0012), so a sum of "0.00" can only mean no live line was summed, and that
 * cell is left empty. `SUM` over the column is unchanged.
 *
 * ★ NO SUMMARY IS BLANK TOO. A row can arrive without one only when the
 * session said `cost.read` and the server did not agree (a stale session) or
 * failed to answer for that trip. That is "not known" — the same empty cell.
 */
export const tripSheetCostCells = (
  summary: Pick<TripCostSummary, 'total' | 'hires' | 'byCategory'> | null | undefined,
  headings: readonly string[],
): Record<string, number | null> => {
  const amounts = summary
    ? [...TRIP_COST_CATEGORIES.map((category) => summary.byCategory[category]), summary.hires, summary.total]
    : [];
  return Object.fromEntries(headings.map((heading, index) => [heading, recorded(amounts[index])]));
};

/** An amount of something recorded, or `null` when nothing was. */
const recorded = (amount: string | undefined): number | null => {
  const value = sheetMoney(amount);
  return value === 0 ? null : value;
};
