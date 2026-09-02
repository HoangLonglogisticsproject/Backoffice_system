import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveCompletion,
  fetchCompletionRequests,
  fetchCompletionReviewQueue,
  fetchExecutionEvents,
  fetchOperationalBoard,
  rejectCompletion,
} from '@/api/tripCompletion';
import { fetchTripCosts } from '@/api/tripCost';
import { useSession } from '@/contexts/SessionProvider';
import type { CompletionRequest, ExecutionEvent } from '@/types/driver';
import type { OperationalBoardRow } from '@/types/operationalBoard';
import type { TripCost } from '@/types/tripCost';
import { ApiError, isApiError } from '@/utils/errors';
import { tripKeys } from './keys';

/**
 * The completion review queue, one trip's evidence, and the two decisions.
 *
 * ★ NOTHING HERE IS OPTIMISTIC, AND THAT IS THE WHOLE POINT.
 *
 * Approving closes a trip permanently — a database trigger makes `done`
 * irreversible — so rendering the outcome before the server has confirmed it
 * would show a state that might never exist. Two reviewers can click at the
 * same instant and only one wins; the loser must see the truth, not a screen
 * that already told them they succeeded.
 *
 * So both mutations do exactly one thing on success: invalidate and refetch.
 */
const reviewKeys = {
  board: (range: { from: string; to: string }) =>
    [...tripKeys.all, 'operational-board', range] as const,
  /** Outstanding reviews. No range in the key, because there is none in the query. */
  queue: () => [...tripKeys.all, 'completion-queue'] as const,
  completion: (tripId: string) => [...tripKeys.all, 'completion', tripId] as const,
  events: (tripId: string) => [...tripKeys.all, 'events', tripId] as const,
};

const asApiError = (error: unknown): ApiError | null => {
  if (!error) return null;
  return isApiError(error) ? error : new ApiError(0, undefined, 'Unexpected error.');
};

/**
 * The review queue — outstanding completions, whatever month the trip ran.
 *
 * ★ TAKES NO RANGE, so nothing here can lose a pending review at a month
 * boundary and no browser clock decides which month it is.
 */
export function useCompletionQueue(): {
  rows: OperationalBoardRow[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: reviewKeys.queue(),
    queryFn: () => fetchCompletionReviewQueue(),
  });

  return {
    rows: query.data ?? [],
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/** Every trip in the range, with where it actually stands. */
export function useOperationalBoard(range: { from: string; to: string }): {
  rows: OperationalBoardRow[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: reviewKeys.board(range),
    queryFn: () => fetchOperationalBoard(range),
  });

  return {
    rows: query.data ?? [],
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/**
 * The evidence behind one trip's completion.
 *
 * ★ THREE READS, AND THE COST ONE IS GATED ON THE PERMISSION.
 *
 * A reviewer who may decide completions does not automatically hold `cost.read`
 * — they are separate keys with separate tiers. Firing the cost request anyway
 * would produce a 403 in the log on every open, which looks exactly like an
 * attack; and a disabled `useQuery` still returns whatever is in its cache, so
 * the figures are read only while the permission holds.
 *
 * ⚠ NO HIRE READ. A carrier's agreed price is commercial and has nothing to do
 * with whether a driver's trip is finished.
 */
export function useCompletionEvidence(tripId: string | null): {
  requests: CompletionRequest[];
  events: ExecutionEvent[];
  expenses: TripCost[];
  /** True when the caller may not see the figures at all. */
  expensesHidden: boolean;
  loading: boolean;
  error: ApiError | null;
} {
  const { can } = useSession();
  const mayReadCosts = can('cost.read');
  const enabled = Boolean(tripId);

  const requests = useQuery({
    queryKey: reviewKeys.completion(tripId ?? ''),
    queryFn: () => fetchCompletionRequests(tripId as string),
    enabled,
  });

  const events = useQuery({
    queryKey: reviewKeys.events(tripId ?? ''),
    // Withdrawn events included: somebody auditing a correction is looking for
    // exactly those, and the timeline marks them rather than hiding them.
    queryFn: () => fetchExecutionEvents(tripId as string, true),
    enabled,
  });

  const costs = useQuery({
    queryKey: tripKeys.costs(tripId ?? '', false),
    queryFn: () => fetchTripCosts(tripId as string, false),
    enabled: enabled && mayReadCosts,
  });

  return {
    requests: requests.data ?? [],
    events: events.data ?? [],
    // Read from the cache only while the permission holds — see above.
    expenses: mayReadCosts ? (costs.data?.items ?? []) : [],
    expensesHidden: !mayReadCosts,
    loading: requests.isLoading || events.isLoading || (mayReadCosts && costs.isLoading),
    error: asApiError(requests.error ?? events.error ?? costs.error),
  };
}

/**
 * Approve and reject.
 *
 * ★ BOTH INVALIDATE EVERYTHING THE DECISION MOVES. Approving freezes every
 * figure, closes the trip and writes its history in one server transaction, so
 * refreshing only the request would leave the queue, the timeline and the money
 * all contradicting it.
 */
export function useCompletionDecision(tripId: string) {
  const client = useQueryClient();

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: reviewKeys.completion(tripId) }),
      client.invalidateQueries({ queryKey: reviewKeys.events(tripId) }),
      // The queue, and every cached board page — a decision removes the trip
      // from the first and changes its stage on the second.
      client.invalidateQueries({ queryKey: reviewKeys.queue() }),
      client.invalidateQueries({ queryKey: [...tripKeys.all, 'operational-board'] }),
      client.invalidateQueries({ queryKey: tripKeys.money(tripId) }),
    ]);
  };

  const approve = useMutation({
    // No argument at all: there is nothing a caller could add to an approval
    // that the server would accept.
    mutationFn: () => approveCompletion(tripId),
    onSuccess: refresh,
  });

  const reject = useMutation({
    mutationFn: (reason: string) => rejectCompletion(tripId, reason),
    onSuccess: refresh,
  });

  return { approve, reject };
}
