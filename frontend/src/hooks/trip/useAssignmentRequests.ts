import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveAssignmentRequest,
  fetchAssignmentRequestQueue,
  fetchTripAssignmentRequests,
  rejectAssignmentRequest,
} from '@/api/assignmentRequests';
import { useSession } from '@/contexts/SessionProvider';
import type { DispatchAssignmentRequest } from '@/types/openBooking';
import { isApiError } from '@/utils/errors';
import { notifyApiError, notifyError, notifySuccess } from '@/utils/toast';
import { tripKeys } from './keys';

/**
 * Drivers' asks for open bookings, as Dispatch sees them (0035).
 *
 * ★ `dispatch.write` OR NOTHING. A seller, customer service or accounting reads
 * the board but is not offered the review — so these reads do not even run for
 * them, and the server refuses them anyway.
 */
export const requestKeys = {
  all: [...tripKeys.all, 'assignment-requests'] as const,
  queue: () => [...requestKeys.all, 'queue'] as const,
  trip: (tripId: string) => [...requestKeys.all, 'trip', tripId] as const,
};

const countByTrip = (requests: DispatchAssignmentRequest[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const request of requests) counts.set(request.tripId, (counts.get(request.tripId) ?? 0) + 1);
  return counts;
};

/**
 * How many drivers are asking for each booking. ★ ONE READ FOR THE WHOLE
 * BOARD: every row asks this hook, react-query fetches once and each row
 * reads its own count from the same answer.
 */
export function usePendingRequestCount(tripId: string): number {
  const { can } = useSession();
  const query = useQuery({
    queryKey: requestKeys.queue(),
    queryFn: fetchAssignmentRequestQueue,
    enabled: can('dispatch.write'),
    staleTime: 30_000,
    select: countByTrip,
  });
  return query.data?.get(tripId) ?? 0;
}

/** Every ask on one trip, decided ones included — the review in "Phương tiện điều độ". */
export function useTripAssignmentRequests(tripId: string | null) {
  const { can } = useSession();
  return useQuery({
    queryKey: requestKeys.trip(tripId ?? ''),
    queryFn: () => fetchTripAssignmentRequests(tripId as string),
    enabled: tripId !== null && can('dispatch.write'),
  });
}

export type RequestDecision =
  | { kind: 'approve'; tripId: string; requestId: string; vehicleId: string }
  | { kind: 'reject'; tripId: string; requestId: string; reason: string | null };

/**
 * Approve (with the lorry) or reject one ask.
 *
 * ★ BOTH RE-READ EVERYTHING THE DECISION MOVES: an approval is an assignment
 * — the board row, the trip's crew — and it supersedes the other asks. A 409
 * is the board having moved (another dispatcher, a direct assignment); the
 * re-read shows what is true now.
 */
export function useDecideAssignmentRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (decision: RequestDecision) =>
      decision.kind === 'approve'
        ? approveAssignmentRequest(decision.tripId, decision.requestId, decision.vehicleId)
        : rejectAssignmentRequest(decision.tripId, decision.requestId, decision.reason),
    onSuccess: (_data, decision) =>
      notifySuccess(decision.kind === 'approve' ? 'toastRequestApproved' : 'toastRequestRejected'),
    onError: (error) => {
      if (isApiError(error) && (error.status === 409 || error.details?.['booking'] === 'BOOKING_NOT_OPEN')) {
        notifyError('requestReviewConflict');
      } else notifyApiError(error, 'saveFailed');
    },
    onSettled: (_data, _error, decision) =>
      Promise.all([
        client.invalidateQueries({ queryKey: requestKeys.all }),
        client.invalidateQueries({ queryKey: tripKeys.schedules() }),
        client.invalidateQueries({ queryKey: tripKeys.assignments(decision.tripId) }),
      ]),
  });
}
