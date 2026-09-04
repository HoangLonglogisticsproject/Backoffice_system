import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  declareExpense,
  editExpense,
  fetchMyTrip,
  fetchMyTrips,
  recordExecutionEvent,
  submitCompletion,
  type DeclareExpenseInput,
  type RecordEventInput,
} from '@/api/driverPortal';
import type { DriverTrip, DriverTripDetail, ExpenseDeclaration } from '@/types/driver';
import type { TripCostCategory } from '@/types/tripCost';
import { ApiError, isApiError } from '@/utils/errors';
import { notifySuccess } from '@/utils/toast';

/**
 * Every cache key and every mutation the Driver Portal uses.
 *
 * ★ ONE FILE BECAUSE THERE IS ONE RESOURCE. The trip screens split theirs
 * across five files because they serve four endpoints, three permissions and
 * two pagination styles. The portal reads one trip and writes to it; splitting
 * that would be structure without a reason.
 *
 * ★ EVERY MUTATION INVALIDATES THE WHOLE TRIP, NOT THE PIECE IT TOUCHED.
 * Reporting a delivery can close the journey and make the completion button
 * appear; submitting a completion freezes every expense line at once. The
 * pieces move together, so refreshing one and leaving the others is how a
 * screen ends up contradicting itself.
 */
export const driverKeys = {
  all: ['driver'] as const,
  trips: () => [...driverKeys.all, 'trips'] as const,
  trip: (tripId: string) => [...driverKeys.trips(), tripId] as const,
};

const asApiError = (error: unknown): ApiError | null => {
  if (!error) return null;
  return isApiError(error) ? error : new ApiError(0, undefined, 'Unexpected error.');
};

/**
 * The trips this driver is on right now.
 *
 * ★ NO PARAMETER, AND THAT IS THE SECURITY MODEL SHOWING THROUGH. The scope is
 * the session: the server reads the caller's own assignments, so there is no id
 * a client could supply to widen it.
 */
export function useMyTrips(): {
  trips: DriverTrip[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: driverKeys.trips(),
    // Wrapped rather than passed by reference: TanStack hands its query context
    // to `queryFn`, and an API function that took a parameter later would then
    // silently receive it.
    queryFn: () => fetchMyTrips(),
    // A driver on the road opens this repeatedly; a short window keeps a
    // back-navigation instant without showing yesterday's work.
    staleTime: 30_000,
  });

  return {
    trips: query.data ?? [],
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/** One trip, with its timeline, the driver's own figures, and the completion. */
export function useMyTrip(tripId: string | undefined): {
  trip: DriverTripDetail | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: driverKeys.trip(tripId ?? ''),
    queryFn: () => fetchMyTrip(tripId as string),
    enabled: Boolean(tripId),
    // ★ NEVER RETRIED ON A REFUSAL. A 403 means this trip is not theirs and a
    // 404 means it is not there; asking twice more changes neither answer and
    // fills the server's log with what looks like probing.
    retry: (failureCount, error) => {
      const status = isApiError(error) ? error.status : 0;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });

  return {
    trip: query.data ?? null,
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/**
 * The four writes, sharing one invalidation.
 *
 * Each returns the TanStack mutation so a screen can read `isPending` for the
 * button it owns — a driver tapping "đã đến" on a slow connection has to see
 * that the tap landed.
 */
export function useDriverActions(tripId: string) {
  const client = useQueryClient();

  // The list shows nothing that a write changes today, but it is invalidated
  // too: a completion approval removes a trip from "what am I driving", and
  // leaving a closed trip on the home screen is worse than one extra request.
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: driverKeys.trip(tripId) }),
      client.invalidateQueries({ queryKey: driverKeys.trips() }),
    ]);
  };

  // ★ EVERY TAP GETS AN ANSWER, AND THAT MATTERS MORE HERE THAN ANYWHERE.
  // A driver taps "đã đến" on one bar of signal and cannot tell a slow request
  // from a lost one; `isPending` says the tap landed, this says the server kept
  // it. Raised before `refresh` so the confirmation does not wait on two
  // refetches over the same connection that just struggled with the write.
  const report = useMutation({
    mutationFn: (input: RecordEventInput) => recordExecutionEvent(tripId, input),
    onSuccess: () => {
      notifySuccess('toastEventReported');
      return refresh();
    },
  });

  const declare = useMutation({
    mutationFn: (input: DeclareExpenseInput) => declareExpense(tripId, input),
    onSuccess: () => {
      notifySuccess('toastExpenseDeclared');
      return refresh();
    },
  });

  const correct = useMutation({
    mutationFn: (input: {
      costId: string;
      category?: TripCostCategory;
      amount?: string;
      note?: string | null;
    }) => {
      const { costId, ...patch } = input;
      return editExpense(tripId, costId, patch);
    },
    onSuccess: () => {
      notifySuccess('toastExpenseCorrected');
      return refresh();
    },
  });

  const complete = useMutation({
    mutationFn: (declaration: ExpenseDeclaration) => submitCompletion(tripId, declaration),
    // Names what happens next: the trip is not finished, it is waiting for the
    // office — and the figures the driver just sent are frozen until it decides.
    onSuccess: () => {
      notifySuccess('toastCompletionSubmitted');
      return refresh();
    },
  });

  return { report, declare, correct, complete };
}
