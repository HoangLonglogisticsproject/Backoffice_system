import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripCostSummary } from '../domain/trip-board';
import type { TripCostCategory } from '../domain/trip-cost';

interface SummaryRow {
  trip_id: string;
  total: string;
  item_count: number;
  hires: string;
  /** `jsonb`, which `pg` parses: category → amount text, only where lines exist. */
  by_category: Partial<Record<TripCostCategory, string>>;
}

/**
 * How PostgreSQL renders a zero here — the value a category with no live line
 * is given, so every amount in a summary reads the same way.
 */
const NONE_RECORDED = '0.00';

/**
 * What each trip on one board page has cost — one statement for the page.
 *
 * ★ ONE QUERY PER PAGE, NEVER ONE PER TRIP. The ids arrive as one array and
 * every trip comes back in the same round trip.
 *
 * ★ `UNION ALL`, NEVER A JOIN OF THE TWO LEDGERS. A trip with three cost lines
 * and two hires joined across both would produce six rows and count every
 * amount two or three times. Stacking the two tables into one column of amounts
 * and grouping keeps each record exactly once.
 *
 * ★ THE SAME PREDICATE AS `TripCostTotalsRepository.forTrip` — live records,
 * `voided_at IS NULL`, whatever their `state` — so the cell and the dialog it
 * opens say the same number.
 *
 * Two grouping steps, each with one job: `per_category` sums the lines of each
 * (trip, ledger, category); the outer query folds those into one row per trip —
 * the total, the count, the hires, and the categories as one JSON object. The
 * total is the sum of the parts, in SQL, so the breakdown cannot disagree
 * with it.
 *
 * `ids` drives the read so a trip with nothing recorded still comes back, as
 * `"0.00"` and `0` — `DISTINCT` because an id passed twice would meet every one
 * of its lines twice in the join and double its total. `ROUND(…, 2)` rather than
 * a cast to `NUMERIC(14,2)`: both decimals, without a precision ceiling the
 * combined figure never had. `ANY($1)` is repeated inside each branch so both
 * are answered from their `trip_id` index rather than the whole ledger.
 */
@Injectable()
export class TripBoardCostRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async forTrips(
    tripIds: readonly string[],
    executor: DatabaseQuery = this.db,
  ): Promise<Map<string, TripCostSummary>> {
    const rows = await executor.query<SummaryRow>(
      `WITH ids AS (
         SELECT DISTINCT unnest($1::uuid[]) AS trip_id
       ), lines AS (
         SELECT trip_id, 'cost' AS ledger, category, amount
           FROM trip_costs
          WHERE trip_id = ANY($1::uuid[]) AND voided_at IS NULL
         UNION ALL
         SELECT trip_id, 'hire', NULL, agreed_amount
           FROM trip_outsource_hires
          WHERE trip_id = ANY($1::uuid[]) AND voided_at IS NULL
       ), per_category AS (
         SELECT trip_id, ledger, category, SUM(amount) AS amount, COUNT(*) AS line_count
           FROM lines
          GROUP BY trip_id, ledger, category
       )
       SELECT ids.trip_id,
              ROUND(COALESCE(SUM(pc.amount), 0), 2)::text AS total,
              COALESCE(SUM(pc.line_count), 0)::int AS item_count,
              ROUND(COALESCE(SUM(pc.amount) FILTER (WHERE pc.ledger = 'hire'), 0), 2)::text AS hires,
              COALESCE(
                jsonb_object_agg(pc.category, ROUND(pc.amount, 2)::text)
                  FILTER (WHERE pc.ledger = 'cost'),
                '{}'::jsonb
              ) AS by_category
         FROM ids
         LEFT JOIN per_category pc ON pc.trip_id = ids.trip_id
        GROUP BY ids.trip_id`,
      [tripIds],
    );

    return new Map(rows.map((row) => [row.trip_id, toSummary(row)]));
  }
}

/**
 * Every canonical category present — one with no live line is a counted zero,
 * not a missing key a caller has to guess about.
 *
 * ★ SPELLED OUT, NOT BUILT FROM THE ENUM LIST. `Record<TripCostCategory, …>`
 * makes this literal total: a sixth category fails to compile HERE, where a
 * loop over the list would need a cast to say the same thing.
 */
const categoryAmounts = (
  found: Partial<Record<TripCostCategory, string>>,
): Record<TripCostCategory, string> => ({
  fuel: found.fuel ?? NONE_RECORDED,
  toll: found.toll ?? NONE_RECORDED,
  warehouse: found.warehouse ?? NONE_RECORDED,
  loading: found.loading ?? NONE_RECORDED,
  overtime: found.overtime ?? NONE_RECORDED,
});

const toSummary = (row: SummaryRow): TripCostSummary => ({
  total: row.total,
  itemCount: row.item_count,
  hires: row.hires,
  byCategory: categoryAmounts(row.by_category),
});
