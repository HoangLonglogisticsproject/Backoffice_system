import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchOutsourceHires,
  fetchTripCostSummary,
  fetchTripCosts,
} from '@/api/tripCost';
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

/**
 * A trip's money.
 *
 * ★ `enabled` GATES ON `cost.read`, AND THAT IS NOT A CONVENIENCE. Without it
 * the modal would fire three requests the server answers 403 to, every time a
 * caller without the permission opened it — noise in the log that looks exactly
 * like an attack. The server still decides; this only stops asking a question
 * whose answer is already known.
 *
 * ⚠ THE GATE IS NOT THE SECURITY. Every one of these routes re-decides on the
 * server. A client that removed this check would see 403s, not amounts.
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

  const enabled = tripId !== null && state?.status === 'ready' && can('cost.read');

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

  const reload = useCallback(() => {
    if (tripId === null) return;
    // One prefix covers the lists, both `includeVoided` variants, and the
    // summary: a line that was just voided changes all of them at once, and
    // refreshing only what is on screen would leave the others contradicting it.
    void queryClient.invalidateQueries({ queryKey: tripKeys.money(tripId) });
  }, [queryClient, tripId]);

  const error = asApiError(costs.error ?? hires.error ?? totals.error);

  return {
    costs: costs.data ?? null,
    hires: hires.data ?? null,
    totals: totals.data ?? null,
    loading: enabled && (costs.isFetching || hires.isFetching || totals.isFetching),
    error,
    forbidden: error?.status === 403,
    reload,
  };
}
