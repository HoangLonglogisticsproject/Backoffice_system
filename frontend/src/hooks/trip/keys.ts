import type { TripAssignmentFilter, TripLifecycle } from '@/types/trip';
import type { TripBoardOrder } from '@/types/tripBoard';

/**
 * What identifies one board list. `costs` is whether it was fetched by a caller
 * who may see money — see `scheduleList`.
 */
export interface TripBoardListFilter extends TripBoardOrder {
  from: string;
  to: string;
  assignment: TripAssignmentFilter;
  /** Lịch xe or Lịch sử chuyến — two lists, two totals, two cache entries. */
  lifecycle: TripLifecycle;
  /**
   * The customer search, as typed. Part of the IDENTITY of the list: narrowing
   * it is a different list with a different total, so sharing a key would serve
   * one customer's page under another's search.
   */
  customer: string;
  costs: boolean;
}

/**
 * Every cache key the trip screens use, in one place.
 *
 * ★ WRITTEN AS A HIERARCHY SO INVALIDATION CAN BE COARSE. TanStack matches keys
 * by PREFIX, so `invalidateQueries({ queryKey: tripKeys.schedules() })` clears
 * every page of every date range at once. That is the behaviour a save needs:
 * after adding a trip, the caller has no idea which cached pages the new row
 * belongs on — it depends on its date and on the sort — so invalidating the one
 * page currently on screen would leave stale copies of all the others.
 *
 * ⚠ THE OBJECT LITERALS INSIDE A KEY ARE HASHED BY VALUE, not by identity, and
 * their keys are sorted first — so `{ page: 1, limit: 20 }` built fresh on every
 * render hits the same cache entry. That is what makes it safe to construct
 * these inline.
 */
export const tripKeys = {
  all: ['trip'] as const,

  schedules: () => [...tripKeys.all, 'schedules'] as const,
  /**
   * The LIST, identified by its filter. `useOffsetPages` appends the page.
   *
   * ★ `assignment` IS PART OF THE IDENTITY, not a detail of the request. The
   * three tabs are three different lists with three different totals; sharing
   * one key would serve the crewed page's rows to the uncrewed tab, and
   * `useOffsetPages` would keep the page number across a switch that changes how
   * many pages there are.
   *
   * ★ SO ARE `sort` AND `direction` — page 2 of one order is not page 2 of
   * another, and a new key is what sends the walk back to page 1.
   *
   * ★ AND SO IS `costs`. A page fetched with `cost.read` carries money; one
   * fetched without carries `null`. Sharing a key would show a stale zero-less
   * board to somebody just granted the permission, and — worse — keep figures
   * cached for somebody who just lost it (`holdsTripCosts` finds those).
   */
  scheduleList: (filter: TripBoardListFilter) => [...tripKeys.schedules(), filter] as const,

  /**
   * How many trips in a range still have nobody on them — the number on the tab.
   *
   * Under `schedules()` on purpose: assigning a driver already invalidates that
   * whole prefix, so the badge cannot go on claiming work that has just been
   * handed out.
   */
  unassignedCount: (scope: { from: string; to: string; customer: string }) =>
    [...tripKeys.schedules(), 'unassigned-count', scope] as const,

  /**
   * Everything money-related for ONE trip.
   *
   * A prefix rather than three separate roots so that recording or voiding
   * something invalidates the cost list, the hire list, both `includeVoided`
   * variants and the summary together — they all change at the same instant,
   * and refreshing one would leave the others contradicting it.
   */
  money: (tripId: string) => [...tripKeys.all, 'money', tripId] as const,
  costs: (tripId: string, includeVoided: boolean) =>
    [...tripKeys.money(tripId), 'costs', { includeVoided }] as const,
  hires: (tripId: string, includeVoided: boolean) =>
    [...tripKeys.money(tripId), 'hires', { includeVoided }] as const,
  costSummary: (tripId: string) => [...tripKeys.money(tripId), 'summary'] as const,
  /**
   * One lorry's costs over a range. ★ UNDER THE MONEY ROOT, so losing
   * `cost.read` drops them with every trip's figures (`useTripCosts`).
   */
  vehicleCosts: (vehicleId: string, range: { from: string; to: string }) =>
    [...tripKeys.all, 'money', 'vehicle', vehicleId, range] as const,

  /**
   * "Chứng từ nhiên liệu" (`cost.import`): the costs a receipt may already be.
   * Its own root, dropped when the key is lost (`useFuelReceipt`).
   */
  fuel: () => [...tripKeys.all, 'fuel'] as const,
  fuelMatches: (search: unknown) => [...tripKeys.fuel(), 'matches', search] as const,
  fuelStaged: () => [...tripKeys.fuel(), 'staged'] as const,
  /** "Kế toán → Nhiên liệu" (0038): one review state's page, and one fill. Under `fuel()`, so a decision refreshes both. */
  fuelReviews: (status: string, page: number) => [...tripKeys.fuel(), 'reviews', status, page] as const,
  fuelReview: (id: string) => [...tripKeys.fuel(), 'review', id] as const,

  /** The drivers a dispatcher may assign. One list, company-wide. */
  drivers: () => [...tripKeys.all, 'drivers'] as const,

  /**
   * "Điều hành xe" for one business day. ★ `withMoney` partitions the cache as
   * `costs` does for the board: a day read with `cost.read` carries amounts, and
   * is never the entry served once that permission is gone.
   */
  fleets: () => [...tripKeys.all, 'fleet'] as const,
  fleet: (day: string, withMoney: boolean) => [...tripKeys.fleets(), { day, withMoney }] as const,

  /**
   * One trip's dispatch history — every turn, active and ended. Its own root
   * rather than a child of `schedules()`: the panel reads it while the board
   * page stays as it is, and a dispatch write invalidates both explicitly.
   */
  assignments: (tripId: string) => [...tripKeys.all, 'assignments', tripId] as const,

  /**
   * The booking document's data for ONE open preview. Its own root, held only
   * while the dialog is (`gcTime: 0`): every opening reads the trip afresh.
   */
  bookingExport: (tripId: string) => [...tripKeys.all, 'booking-export', tripId] as const,

  catalogues: () => [...tripKeys.all, 'catalogue'] as const,
  /** One customer's places. Under the catalogue prefix, so a reload clears them too. */
  locations: (customerId: string, includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'locations', customerId, { includeArchived }] as const,
  /**
   * Every place, for the locations catalogue.
   *
   * Under the same prefix as the per-customer lists on purpose: adding a place
   * from either screen has to clear the other, and a shared `reload()` that
   * misses one leaves two screens disagreeing about the same table.
   */
  allLocations: (includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'locations', 'all', { includeArchived }] as const,
  vehicles: (includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'vehicles', { includeArchived }] as const,
  customers: (includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'customers', { includeArchived }] as const,
};

/**
 * Is this cached query a board list holding cost figures?
 *
 * For `queryClient.removeQueries` / `invalidateQueries` predicates: the board
 * lists fetched with `cost.read` are exactly the `scheduleList` keys whose
 * filter says `costs: true`.
 */
export const holdsFleetMoney = (queryKey: readonly unknown[]): boolean => {
  const [root, list, filter] = queryKey;
  if (root !== tripKeys.all[0] || list !== 'fleet') return false;
  return typeof filter === 'object' && filter !== null && 'withMoney' in filter && filter.withMoney === true;
};

export const holdsTripCosts = (queryKey: readonly unknown[]): boolean => {
  const [root, list, filter] = queryKey;
  if (root !== tripKeys.all[0] || list !== 'schedules') return false;
  return typeof filter === 'object' && filter !== null && 'costs' in filter && filter.costs === true;
};
