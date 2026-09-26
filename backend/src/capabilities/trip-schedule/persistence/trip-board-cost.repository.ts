import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripCostSummary } from '../domain/trip-board';

interface SummaryRow {
  trip_id: string;
  total: string;
  item_count: number;
}

/**
 * What each trip on one board page has cost — one statement for the page.
 *
 * ★ ONE QUERY PER PAGE, NEVER ONE PER TRIP. The ids arrive as one array and
 * every trip comes back in the same round trip.
 *
 * ★ `UNION ALL`, NEVER A JOIN OF THE TWO LEDGERS. A trip with three cost lines
 * and two hires joined across both would produce six rows and count every
 * amount two or three times. Stacking the two tables into one column of amounts
 * and grouping once keeps each record exactly once.
 *
 * ★ THE SAME PREDICATE AS `TripCostTotalsRepository.forTrip` — live records,
 * `voided_at IS NULL`, whatever their `state` — so the cell and the dialog it
 * opens say the same number.
 *
 * `unnest` drives the read so a trip with nothing recorded still comes back,
 * as `"0.00"` and `0`, from PostgreSQL — `DISTINCT` because an id passed twice
 * would meet every one of its lines twice in the join and double its total. `ROUND(…, 2)` rather than a cast to
 * `NUMERIC(14,2)`: it renders both decimals, like every other amount, without
 * a precision ceiling the combined figure never had. `ANY($1)` is repeated
 * inside each branch so both are answered from their `trip_id` index rather
 * than by reading the whole ledger.
 */
@Injectable()
export class TripBoardCostRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async forTrips(
    tripIds: readonly string[],
    executor: DatabaseQuery = this.db,
  ): Promise<Map<string, TripCostSummary>> {
    const rows = await executor.query<SummaryRow>(
      `SELECT ids.trip_id,
              ROUND(COALESCE(SUM(lines.amount), 0), 2)::text AS total,
              COUNT(lines.amount)::int AS item_count
         FROM (SELECT DISTINCT unnest($1::uuid[]) AS trip_id) ids
         LEFT JOIN (
           SELECT trip_id, amount
             FROM trip_costs
            WHERE trip_id = ANY($1::uuid[]) AND voided_at IS NULL
           UNION ALL
           SELECT trip_id, agreed_amount
             FROM trip_outsource_hires
            WHERE trip_id = ANY($1::uuid[]) AND voided_at IS NULL
         ) lines ON lines.trip_id = ids.trip_id
        GROUP BY ids.trip_id`,
      [tripIds],
    );

    return new Map(
      rows.map((row) => [row.trip_id, { total: row.total, itemCount: row.item_count }]),
    );
  }
}
