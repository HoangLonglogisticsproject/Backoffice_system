import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  declareExpense,
  editExpense,
  fetchMyAssignment,
  fetchMyAssignments,
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
 * ★ ONE FILE BECAUSE THERE IS ONE RESOURCE: the assignment (ADR-0004). The
 * trip screens split theirs across five files because they serve four
 * endpoints, three permissions and two pagination styles. The portal reads one
 * assignment and writes to it; splitting that would be structure without a
 * reason.
 *
 * ★ KEYED BY ASSIGNMENT, NEVER BY TRIP. A driver on two lorries of one trip
 * holds two turns with two timelines and two sets of figures; a trip-keyed
 * cache would serve one lorry's progress to the other's screen.
 *
 * ★ EVERY MUTATION INVALIDATES THE WHOLE ASSIGNMENT, NOT THE PIECE IT TOUCHED.
 * Reporting a delivery can close the journey and make the completion button
 * appear; submitting a completion freezes every expense line at once. The
 * pieces move together, so refreshing one and leaving the others is how a
 * screen ends up contradicting itself.
 */
export const driverKeys = {
  all: ['driver'] as const,
  assignments: () => [...driverKeys.all, 'assignments'] as const,
  assignment: (assignmentId: string) => [...driverKeys.assignments(), assignmentId] as const,
};

const asApiError = (error: unknown): ApiError | null => {
  if (!error) return null;
  return isApiError(error) ? error : new ApiError(0, undefined, 'Unexpected error.');
};

/**
 * The turns this driver holds right now — one per lorry.
 *
 * ★ NO PARAMETER, AND THAT IS THE SECURITY MODEL SHOWING THROUGH. The scope is
 * the session: the server reads the caller's own assignments, so there is no id
 * a client could supply to widen it.
 */
export function useMyAssignments(): {
  assignments: DriverTrip[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: driverKeys.assignments(),
    // Wrapped rather than passed by reference: TanStack hands its query context
    // to `queryFn`, and an API function that took a parameter later would then
    // silently receive it.
    queryFn: () => fetchMyAssignments(),
    // A driver on the road opens this repeatedly; a short window keeps a
    // back-navigation instant without showing yesterday's work.
    staleTime: 30_000,
  });

  return {
    assignments: query.data ?? [],
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/** One assignment, with its timeline, the driver's own figures on it, and its completion. */
export function useMyAssignment(assignmentId: string | undefined): {
  trip: DriverTripDetail | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: driverKeys.assignment(assignmentId ?? ''),
    queryFn: () => fetchMyAssignment(assignmentId as string),
    enabled: Boolean(assignmentId),
    // ★ NEVER RETRIED ON A REFUSAL. A 403 means this turn is not theirs (or has
    // ended) and a 404 means it is not there; asking twice more changes neither
    // answer and fills the server's log with what looks like probing.
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
export function useDriverActions(assignmentId: string) {
  const client = useQueryClient();

  // The list shows nothing that a write changes today, but it is invalidated
  // too: a completion approval removes a turn from "what am I driving", and
  // leaving a closed one on the home screen is worse than one extra request.
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: driverKeys.assignment(assignmentId) }),
      client.invalidateQueries({ queryKey: driverKeys.assignments() }),
    ]);
  };

  // ★ EVERY TAP GETS AN ANSWER, AND THAT MATTERS MORE HERE THAN ANYWHERE.
  // A driver taps "đã đến" on one bar of signal and cannot tell a slow request
  // from a lost one; `isPending` says the tap landed, this says the server kept
  // it. Raised before `refresh` so the confirmation does not wait on two
  // refetches over the same connection that just struggled with the write.
  const report = useMutation({
    mutationFn: (input: RecordEventInput) => recordExecutionEvent(assignmentId, input),
    onSuccess: () => {
      notifySuccess('toastEventReported');
      return refresh();
    },
  });

  const declare = useMutation({
    mutationFn: (input: DeclareExpenseInput) => declareExpense(assignmentId, input),
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
      return editExpense(assignmentId, costId, patch);
    },
    onSuccess: () => {
      notifySuccess('toastExpenseCorrected');
      return refresh();
    },
  });

  const complete = useMutation({
    mutationFn: (declaration: ExpenseDeclaration) => submitCompletion(assignmentId, declaration),
    // Names what happens next: the turn is not finished, it is waiting for the
    // office — and the figures the driver just sent are frozen until it decides.
    onSuccess: () => {
      notifySuccess('toastCompletionSubmitted');
      return refresh();
    },
  });

  return { report, declare, correct, complete };
}
