import type { TripAssignmentFilter } from '@/types/trip';

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
   */
  scheduleList: (filter: { from: string; to: string; assignment: TripAssignmentFilter }) =>
    [...tripKeys.schedules(), filter] as const,

  /**
   * How many trips in a range still have nobody on them — the number on the tab.
   *
   * Under `schedules()` on purpose: assigning a driver already invalidates that
   * whole prefix, so the badge cannot go on claiming work that has just been
   * handed out.
   */
  unassignedCount: (range: { from: string; to: string }) =>
    [...tripKeys.schedules(), 'unassigned-count', range] as const,

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

  /** The drivers a dispatcher may assign. One list, company-wide. */
  drivers: () => [...tripKeys.all, 'drivers'] as const,

  catalogues: () => [...tripKeys.all, 'catalogue'] as const,
  /** One customer's places. Under the catalogue prefix, so a reload clears them too. */
  locations: (customerId: string, includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'locations', customerId, { includeArchived }] as const,
  vehicles: (includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'vehicles', { includeArchived }] as const,
  customers: (includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'customers', { includeArchived }] as const,
};
