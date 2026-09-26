import { Injectable } from '@nestjs/common';
import type { OffsetPage } from '../../../common/pagination/offset-page';
import type { TripBoardRow, TripCostSummary } from '../domain/trip-board';
import { TripBoardCostRepository } from '../persistence/trip-board-cost.repository';
import { TripScheduleService, type TripBoardQuery } from './trip-schedule.service';

/**
 * The dispatch board as the list route serves it: a page of trips, and — for a
 * caller who may see money — what each of them has cost.
 *
 * ★ AT MOST ONE EXTRA STATEMENT PER PAGE, AND OFTEN NONE. The page is read as
 * before; the cost summary is one batched aggregate over the page's ids, and it
 * is not run at all when the caller may not see it or the page is empty.
 *
 * ★ TWO STATEMENTS, NOT ONE SNAPSHOT, AND THAT IS ACCEPTED. A cost recorded
 * between the page read and the aggregate shows up a moment early on a row
 * that is already on screen. The list's own promise — the page and its total
 * agree — is untouched: the aggregate never adds, drops or reorders a row.
 *
 * WHO may see the money is decided by the caller of `page`, from the same
 * authorization context the route was judged by; this service only honours it.
 */
@Injectable()
export class TripBoardService {
  constructor(
    private readonly trips: TripScheduleService,
    private readonly costs: TripBoardCostRepository,
  ) {}

  async page(query: TripBoardQuery, costVisible: boolean): Promise<OffsetPage<TripBoardRow>> {
    const page = await this.trips.list(query);
    const summaries = await this.summariesFor(
      page.items.map((trip) => trip.id),
      costVisible,
    );

    return {
      ...page,
      // ★ A TRIP MISSING FROM THE ANSWER IS `null`, NEVER A ZERO. The aggregate
      // returns every id it was given, so a gap is a fault — and a fault drawn
      // as "0 ₫" would read as a trip that cost nothing.
      items: page.items.map((trip) => ({ ...trip, costSummary: summaries?.get(trip.id) ?? null })),
    };
  }

  private async summariesFor(
    tripIds: string[],
    costVisible: boolean,
  ): Promise<Map<string, TripCostSummary> | null> {
    if (!costVisible || tripIds.length === 0) return null;
    return this.costs.forTrips(tripIds);
  }
}
