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
  /** The LIST, identified by its filter. `useOffsetPages` appends the page. */
  scheduleList: (range: { from: string; to: string }) =>
    [...tripKeys.schedules(), range] as const,

  catalogues: () => [...tripKeys.all, 'catalogue'] as const,
  vehicles: (includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'vehicles', { includeArchived }] as const,
  customers: (includeArchived: boolean) =>
    [...tripKeys.catalogues(), 'customers', { includeArchived }] as const,
};
