import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchTripSchedules } from '@/api/tripSchedule';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useOffsetPages, type OffsetPages } from '@/hooks/useOffsetPages';
import { currentMonthRange } from '@/utils/format/datetime';
import type { TripScheduleWithRefs } from '@/types/trip';
import { tripKeys } from './keys';

/** The two `YYYY-MM-DD` strings the endpoint filters on. Never `Date`s — see `types/pagination.ts`. */
export interface DateRange {
  from: string;
  to: string;
}

export interface TripSchedules extends OffsetPages<TripScheduleWithRefs> {
  /** What the filter bar shows — updated on every keystroke. */
  range: DateRange;
  setFrom: (day: string) => void;
  setTo: (day: string) => void;
  /** Back to the month the screen opened on. */
  resetRange: () => void;
  /** Re-read the list — after a save or an archive. */
  reload: () => void;
}

/**
 * How long a fetched page of trips stays fresh: thirty seconds.
 *
 * SHORTER THAN THE APP DEFAULT, and shorter than the catalogues by an order of
 * magnitude, because this is the one list several people write to during the
 * same hour. It is long enough that paging back and forth is free and short
 * enough that a page left open re-reads before the numbers on it are stale.
 */
const SCHEDULE_STALE_MS = 30 * 1000;

/**
 * How long the filter waits after the last keystroke.
 *
 * ★ THE DATE INPUT IS THE REASON. `<input type="date">` reports every component
 * separately, so typing the year `2026` emits `0002`, `0020`, `0202`, `2026` —
 * four ranges, three of them nonsense, and the first of them the widest scan
 * this endpoint can be handed. 300ms is below the threshold where a filter
 * feels laggy and above the interval between two keystrokes.
 */
const FILTER_DEBOUNCE_MS = 300;

/**
 * The dispatch board's list: the date range, the page walk, and the reload.
 *
 * ★ THE RANGE LIVES HERE, NOT IN THE PAGE, because it is not a display
 * preference — it is half the query. `GET /trip-schedules` is offset-paginated
 * only because a mandatory date range bounds it (ADR-0003), so a caller holding
 * the pages without the range could ask for "page 5" of an unbounded list and
 * break the premise the endpoint is built on. Keeping both in one hook makes
 * that combination unspellable.
 *
 * ★ TWO RANGES, DELIBERATELY. `range` is what the inputs show and updates on
 * every keystroke, so typing never feels laggy. `queried` is what reaches the
 * server, and it lags by `FILTER_DEBOUNCE_MS`. Rendering the debounced one
 * instead would make the date field drop characters as the user types.
 *
 * Changing either date resets to page one; `useOffsetPages` does that during
 * render, so narrowing the range never flashes an empty page 5 first.
 *
 * Opens on the current month on the VIEWER's calendar, matching what the server
 * defaults to, so the first render does not flicker between two ranges — and
 * the debounce passes that first value straight through rather than delaying
 * the initial load by 300ms.
 */
export function useTripSchedules(): TripSchedules {
  const queryClient = useQueryClient();

  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const queried = useDebouncedValue(range, FILTER_DEBOUNCE_MS);

  const pages = useOffsetPages<TripScheduleWithRefs>(
    tripKeys.scheduleList(queried),
    // Rebuilt every render, and that is fine: `useOffsetPages` keys the cache on
    // the key it was given, not on this closure's identity.
    (request) => fetchTripSchedules({ ...request, from: queried.from, to: queried.to }),
    { staleTime: SCHEDULE_STALE_MS },
  );

  const setFrom = useCallback(
    (day: string) => setRange((current) => ({ ...current, from: day })),
    [],
  );
  const setTo = useCallback((day: string) => setRange((current) => ({ ...current, to: day })), []);
  const resetRange = useCallback(() => setRange(currentMonthRange()), []);

  const reload = useCallback(() => {
    // EVERY page of EVERY range, not just the one on screen: a new trip lands
    // on the page its date puts it on, which is not necessarily this one, and a
    // stale copy of another page would resurface the moment somebody navigates
    // to it.
    void queryClient.invalidateQueries({ queryKey: tripKeys.schedules() });
  }, [queryClient]);

  return { ...pages, range, setFrom, setTo, resetRange, reload };
}
