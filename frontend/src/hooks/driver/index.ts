import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  declareDailyFuel,
  declareExpense,
  editExpense,
  fetchMyAssignment,
  fetchMyAssignments,
  fetchMyHistory,
  fetchMyWorkday,
  recordExecutionEvent,
  recordFuelFill,
  submitCompletion,
  type DeclareExpenseInput,
  type RecordEventInput,
} from '@/api/driverPortal';
import type {
  DailyFuelDeclarationInput,
  DriverHistoryCursor,
  DriverTrip,
  DriverTripDetail,
  DriverWorkday,
  ExpenseDeclaration,
  FuelFillInput,
} from '@/types/driver';
import type { TripCostCategory } from '@/types/tripCost';
import { isFinalRefusal } from '@/utils/driverErrors';
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
  /**
   * ★ UNDER `assignments()`, ON PURPOSE. Every write a driver makes moves the
   * day — a milestone, a completion, a check — and every write already
   * invalidates `assignments()`; nesting the day there keeps it current with no
   * mutation having to remember it.
   */
  workday: () => [...driverKeys.assignments(), 'workday'] as const,
  /**
   * ★ NOT UNDER `assignments()`. Finishing a trip removes it from the live list
   * and adds it to this one, and every mutation invalidates `assignments()` —
   * nesting history beneath it would throw away every page the driver had
   * scrolled each time they tapped anything.
   */
  history: () => [...driverKeys.all, 'history'] as const,
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
    // ★ OFFLINE IS AN ERROR HERE, NOT A PAUSE. TanStack's default parks a
    // query while the browser says it is offline — no data, no error, not
    // loading — and the schedule would read that as "no trips today". Asking
    // anyway fails fast as "no connection", with a retry button.
    networkMode: 'always',
  });

  return {
    assignments: query.data ?? [],
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/** "Ca làm việc hôm nay" — the session driver's lorries today, each with its turns. */
export function useMyWorkday(): {
  workday: DriverWorkday | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: driverKeys.workday(),
    queryFn: () => fetchMyWorkday(),
    staleTime: 30_000,
    // Offline fails as "no connection" rather than parking — see the list.
    networkMode: 'always',
    retry: (failureCount, error) => !isFinalRefusal(error) && failureCount < 2,
  });

  return {
    workday: query.data ?? null,
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/**
 * The day's two fuel writes, from the board: the beginning-of-shift check and a
 * fill after it. ★ THE TURN IS NAMED AT THE CALL, not the hook — one day spans
 * several lorries, and each card writes through its own turn.
 */
export function useWorkdayFuel() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: driverKeys.workday() });

  const declareCheck = useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: string; input: DailyFuelDeclarationInput }) =>
      declareDailyFuel(assignmentId, input),
    onSuccess: () => {
      notifySuccess('toastFuelDeclared');
      return refresh();
    },
  });

  const recordFill = useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: string; input: FuelFillInput }) =>
      recordFuelFill(assignmentId, input),
    onSuccess: () => {
      notifySuccess('toastFuelFillRecorded');
      return refresh();
    },
  });

  return { declareCheck, recordFill };
}

/**
 * The trips this driver has already run to the end — a page at a time.
 *
 * ★ `useInfiniteQuery`, BECAUSE HISTORY IS READ BY SCROLLING AND NEVER BY PAGE
 * NUMBER. Each page is keyed by the cursor the previous one returned, so pages
 * accumulate rather than replace — going back from a trip's detail finds the
 * scroll position still loaded instead of restarting at the top.
 *
 * ★ A LONGER `staleTime` THAN THE LIVE LIST, AND THE REASON IS THE DATA. A
 * finished trip does not change again — DONE is permanent, enforced by a
 * database trigger. Re-reading it on every focus would spend a driver's mobile
 * data on an answer that cannot have moved.
 */
export function useMyHistory(): {
  trips: DriverTrip[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: ApiError | null;
  loadMore: () => void;
  reload: () => void;
} {
  const query = useInfiniteQuery({
    queryKey: driverKeys.history(),
    queryFn: ({ pageParam }) => fetchMyHistory({ before: pageParam }),
    initialPageParam: null as DriverHistoryCursor | null,
    // `null` is the server saying there is nothing older. TanStack reads
    // `undefined` as "no more", so the two are mapped here rather than leaving
    // a `null` that would look like a valid cursor forever.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
    // Same reason as the live list: offline must fail fast and say so, not park
    // the query and leave an empty history looking like "you have run nothing".
    networkMode: 'always',
  });

  return {
    trips: query.data?.pages.flatMap((page) => page.trips) ?? [],
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    error: asApiError(query.error),
    loadMore: () => void query.fetchNextPage(),
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
    // Offline fails as "no connection" rather than parking — see the list.
    networkMode: 'always',
    // ★ NEVER RETRIED ON A REFUSAL — see `isFinalRefusal`. Anything else is
    // tried twice more, so a dropped packet on the road is not an error screen.
    retry: (failureCount, error) => !isFinalRefusal(error) && failureCount < 2,
  });

  return {
    trip: query.data ?? null,
    loading: query.isLoading,
    error: asApiError(query.error),
    reload: () => void query.refetch(),
  };
}

/**
 * The writes, sharing one invalidation — and the lorry's daily fuel check.
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

  // The lorry's daily fuel check. No refresh of its own: the milestone it was
  // asked for is retried at once, and that write refreshes the screen.
  const fuel = useMutation({
    mutationFn: (input: DailyFuelDeclarationInput) => declareDailyFuel(assignmentId, input),
    onSuccess: () => notifySuccess('toastFuelDeclared'),
  });

  return { report, declare, correct, complete, fuel };
}
