import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOutsourceHires, fetchTripCostSummary, fetchTripCosts } from '@/api/tripCost';
import { useSession } from '@/contexts/SessionProvider';
import { ApiError, isApiError } from '@/utils/errors';
import type { OutsourceHire, TripCost, TripCostList, TripCostTotals } from '@/types/tripCost';
import { tripKeys } from './keys';

export interface TripCostView {
  costs: TripCostList<TripCost> | null;
  hires: TripCostList<OutsourceHire> | null;
  totals: TripCostTotals | null;
  loading: boolean;
  error: ApiError | null;
  forbidden: boolean;
  /** Re-read all three after recording or withdrawing something. */
  reload: () => void;
}

const asApiError = (error: unknown): ApiError | null => {
  if (!error) return null;
  return isApiError(error) ? error : new ApiError(0, undefined, 'Unexpected error.');
};

/** Nothing to show. Returned whenever the caller may not see the money. */
const NOTHING: Omit<TripCostView, 'reload'> = {
  costs: null,
  hires: null,
  totals: null,
  loading: false,
  error: null,
  forbidden: false,
};

/**
 * A trip's money.
 *
 * ★ `enabled` GATES THE FETCH, AND THAT IS NOT A CONVENIENCE. Without it the
 * panel would fire three requests the server answers 403 to, every time a
 * caller without the permission opened it — noise in the log that looks exactly
 * like an attack. The server still decides; this only stops asking a question
 * whose answer is already known.
 *
 * ★ AND IT GATES THE OUTPUT, WHICH MATTERS MORE. A disabled `useQuery` still
 * RETURNS whatever is in its cache, so a caller who held `cost.read` a moment
 * ago and has since lost it — a revoked assignment, a switched account on a
 * shared machine, a session that ended — would keep seeing the amounts they
 * were shown before, from memory, with no request and nothing to refuse. So the
 * three figures are read from the cache only while `enabled`, and the cache
 * itself is DISCARDED the moment the permission goes away. Both halves are
 * needed: gating alone leaves the data resident, and purging alone leaves a
 * render between the loss and the effect.
 *
 * ⚠ NONE OF THIS IS THE SECURITY. Every route re-decides on the server; a
 * client that skipped all of it would see 403s, not amounts. This is about not
 * showing stale money to somebody who may no longer see it.
 *
 * ★ THREE READS, NOT ONE. The totals come from their own endpoint because the
 * combined figure has to be added by PostgreSQL — `costs + hires` in JavaScript
 * would concatenate two decimal strings or push them through a float.
 *
 * @param includeVoided withdrawn records as well. They are never in a total
 * whichever way this is set; it only decides whether they are listed.
 */
export function useTripCost(tripId: string | null, includeVoided = false): TripCostView {
  const queryClient = useQueryClient();
  const { can, state } = useSession();

  const authorized = state?.status === 'ready' && can('cost.read');
  const enabled = tripId !== null && authorized;

  const costs = useQuery({
    queryKey: tripKeys.costs(tripId ?? '', includeVoided),
    queryFn: () => fetchTripCosts(tripId as string, includeVoided),
    enabled,
  });

  const hires = useQuery({
    queryKey: tripKeys.hires(tripId ?? '', includeVoided),
    queryFn: () => fetchOutsourceHires(tripId as string, includeVoided),
    enabled,
  });

  const totals = useQuery({
    queryKey: tripKeys.costSummary(tripId ?? ''),
    queryFn: () => fetchTripCostSummary(tripId as string),
    enabled,
  });

  /**
   * ★ THE MONEY DOES NOT OUTLIVE THE PERMISSION.
   *
   * Removing rather than invalidating: an invalidated query keeps its data and
   * refetches, which is the opposite of what is wanted here. `removeQueries`
   * drops the cached amounts outright, so nothing is left for a later render —
   * or a React Query devtools panel — to show.
   *
   * Keyed on the whole money prefix, so both lists, both `includeVoided`
   * variants and the summary go together.
   */
  useEffect(() => {
    if (authorized) return;
    queryClient.removeQueries({ queryKey: [...tripKeys.all, 'money'] });
  }, [authorized, queryClient]);

  const reload = useCallback(() => {
    if (tripId === null) return;
    // One prefix covers the lists, both `includeVoided` variants, and the
    // summary: a record that was just voided changes all of them at once, and
    // refreshing only what is on screen would leave the others contradicting it.
    void queryClient.invalidateQueries({ queryKey: tripKeys.money(tripId) });
  }, [queryClient, tripId]);

  // Read from the cache only while the caller may see it. A disabled query
  // still hands back its last data, and that is exactly what must not happen
  // in the render between losing the permission and the effect above running.
  //
  // A trip IS selected but the caller may not see its money — report that as
  // `forbidden` so the panel shows the refusal rather than a set of empty
  // tables that reads as "this trip cost nothing".
  if (!enabled) return { ...NOTHING, forbidden: tripId !== null && !authorized, reload };

  const error = asApiError(costs.error ?? hires.error ?? totals.error);

  return {
    costs: costs.data ?? null,
    hires: hires.data ?? null,
    totals: totals.data ?? null,
    loading: costs.isFetching || hires.isFetching || totals.isFetching,
    error,
    forbidden: error?.status === 403,
    reload,
  };
}
