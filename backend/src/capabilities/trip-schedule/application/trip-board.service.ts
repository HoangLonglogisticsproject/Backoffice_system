import { Inject, Injectable } from '@nestjs/common';
import type { OffsetPage } from '../../../common/pagination/offset-page';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripBoardRow, TripCostSummary, TripExportSnapshot } from '../domain/trip-board';
import { EXPORT_MAX_TRIPS, ExportTooLargeError } from '../domain/trip-export';
import type { TripScheduleWithRefs } from '../domain/trip-schedule';
import { TripBoardCostRepository } from '../persistence/trip-board-cost.repository';
import { TripScheduleService, type TripBoardQuery, type TripExportQuery } from './trip-schedule.service';

/**
 * The dispatch board as the list route serves it: a page of trips, and — for a
 * caller who may see money — what each of them has cost.
 *
 * ★ AT MOST ONE EXTRA STATEMENT PER PAGE, AND OFTEN NONE. The page is read as
 * before; the cost summary is one batched aggregate over the page's ids, and it
 * is not run at all when the caller may not see it or the page is empty.
 *
 * ★ TWO STATEMENTS, NOT ONE SNAPSHOT, AND THAT IS ACCEPTED — FOR A SCREEN. A
 * cost recorded between the page read and the aggregate shows up a moment early
 * on a row that is already on screen. The list's own promise — the page and its
 * total agree — is untouched: the aggregate never adds, drops or reorders a row.
 * A FILE is different: it is reconciled against, so `exportSnapshot` reads one.
 *
 * WHO may see the money is decided by the caller of `page`, from the same
 * authorization context the route was judged by; this service only honours it.
 */
@Injectable()
export class TripBoardService {
  constructor(
    private readonly trips: TripScheduleService,
    private readonly costs: TripBoardCostRepository,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async page(query: TripBoardQuery, costVisible: boolean): Promise<OffsetPage<TripBoardRow>> {
    const page = await this.trips.list(query);
    const summaries = await this.summariesFor(
      page.items.map((trip) => trip.id),
      costVisible,
    );

    return {
      ...page,
      items: withCosts(page.items, summaries),
    };
  }

  /**
   * Everything one Excel file holds, read as ONE state of the database.
   *
   * ★ ONE TRANSACTION, REPEATABLE READ, READ ONLY. At that level PostgreSQL takes
   * the snapshot at the transaction's FIRST statement and every later statement
   * reads the same one. So the trips — crew, customer and author are joined
   * into that one statement — and the cost aggregate describe a single instant:
   * a trip archived, added, re-dated or re-costed while this runs is read as it
   * was before, or not at all. Paging over separate requests cannot promise
   * that: archive one row of a page already read and every later offset shifts,
   * so one trip is never read — with the count unchanged and no id repeated.
   *
   * ★ THE LEVEL IS SET BEFORE THE FIRST READ. PostgreSQL refuses `SET
   * TRANSACTION` after a query, and the statement takes no snapshot itself. A
   * read-only transaction at this level cannot fail serialization, so there is
   * nothing to retry.
   *
   * `readAt` is `statement_timestamp()` of the statement that took the snapshot —
   * when the read BEGAN, on the server's clock. Not a commit time of anything.
   *
   * ★ NOTHING LEAVES BEFORE COMMIT. `transaction` rolls back and rethrows on any
   * failure and releases the connection either way, so the route answers with
   * the whole set or with an error — never with the part read so far.
   *
   * ★ TOO MANY TRIPS IS KNOWN BEFORE ANY ROW IS READ. The count runs in the same
   * snapshot as the read it guards, so a range over `maxTrips` is refused whole
   * — no rows loaded, no cost aggregated, nothing cut short — and a range under
   * it reads exactly the number counted.
   */
  async exportSnapshot(
    query: TripExportQuery,
    costVisible: boolean,
    maxTrips: number = EXPORT_MAX_TRIPS,
  ): Promise<TripExportSnapshot> {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const [clock] = await tx.query<{ read_at: Date }>('SELECT statement_timestamp() AS read_at');
      const count = await this.trips.countForExport(query, tx);
      if (count > maxTrips) throw new ExportTooLargeError(count, maxTrips);
      const trips = await this.trips.listForExport(query, tx);
      const summaries = await this.summariesFor(
        trips.map((trip) => trip.id),
        costVisible,
        tx,
      );

      // A `SELECT` with no `FROM` answers exactly one row.
      return { items: withCosts(trips, summaries), readAt: clock!.read_at };
    });
  }

  private async summariesFor(
    tripIds: string[],
    costVisible: boolean,
    // The board reads outside any transaction; the export passes its own.
    executor: DatabaseQuery = this.db,
  ): Promise<Map<string, TripCostSummary> | null> {
    if (!costVisible || tripIds.length === 0) return null;
    return this.costs.forTrips(tripIds, executor);
  }
}

/**
 * ★ A TRIP MISSING FROM THE ANSWER IS `null`, NEVER A ZERO. The aggregate
 * returns every id it was given, so a gap is a fault — and a fault drawn as
 * "0 ₫" would read as a trip that cost nothing.
 */
const withCosts = (
  trips: readonly TripScheduleWithRefs[],
  summaries: Map<string, TripCostSummary> | null,
): TripBoardRow[] => trips.map((trip) => ({ ...trip, costSummary: summaries?.get(trip.id) ?? null }));
