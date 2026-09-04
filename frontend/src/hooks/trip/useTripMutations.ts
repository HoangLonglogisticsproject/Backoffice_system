import { useRef } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { updateTripStatus } from '@/api/tripSchedule';
import type { OffsetPage } from '@/types/pagination';
import {
  TRIP_STATUS_LABELS,
  type TripSchedule,
  type TripScheduleWithRefs,
  type TripStatus,
} from '@/types/trip';
import { notifyApiError, notifySuccess, translateNow } from '@/utils/toast';
import { tripKeys } from './keys';

export interface UpdateStatusVariables {
  tripId: string;
  status: TripStatus;
}

interface StatusContext {
  /** Every cached page as it was, for putting back if the server refuses. */
  snapshot: Array<[readonly unknown[], OffsetPage<TripScheduleWithRefs> | undefined]>;
  /**
   * What the row said BEFORE the click — the whole basis of "Hoàn tác".
   *
   * ⚠ `null` when no cached page held the trip: the board was filtered to
   * another month, or the row arrived from a screen this cache has not read.
   * The receipt then drops both the "cũ → mới" line and the button rather than
   * guessing a status to go back to.
   */
  previous: TripStatus | null;
}

/**
 * Moving one trip along the board.
 *
 * ★ ITS OWN ENDPOINT, NOT THE EDIT FORM. `PATCH /trip-schedules/:id/status` is
 * separate from the full PATCH for a reason the controller states: this is the
 * write dispatch performs many times a day, and it is the one edit that is
 * plausibly not administration. Sending the whole row to change one field would
 * also overwrite anything a colleague edited between the form opening and the
 * dropdown being touched.
 *
 * ★ AND IT IS OPTIMISTIC. A status change is a click, and a click that waits
 * for a round trip before showing anything gets clicked twice. The badge
 * changes immediately, the request follows, and a refusal puts the old value
 * back — so the only case anybody waits for is the case that fails.
 *
 * ⚠ THE ROLLBACK RESTORES EVERY CACHED PAGE, not the row. The same trip can sit
 * in several cached pages at once — the same date range at two page sizes, or
 * two overlapping ranges — and patching one copy would leave the others
 * claiming the old status until they happened to be re-read.
 */
export function useUpdateTripStatus(): UseMutationResult<
  TripSchedule,
  Error,
  UpdateStatusVariables,
  StatusContext
> {
  const queryClient = useQueryClient();

  /**
   * The same mutation, reachable from inside its own `onSuccess`.
   *
   * ★ THIS IS WHAT MAKES "HOÀN TÁC" A REAL WRITE AND NOT A SECOND CODE PATH.
   * The button sends the trip back through this very hook, so undoing is
   * optimistic, rolls back on refusal and leaves its own receipt — exactly like
   * the click that caused it. Calling the API directly from the toast would be
   * a quieter, dumber copy of everything below.
   *
   * A ref because the callback closes over a value that does not exist yet when
   * `useMutation` is being built. `mutate` is referentially stable in TanStack
   * v5, so this is assignment, never a moving target.
   */
  const fire = useRef<((variables: UpdateStatusVariables) => void) | null>(null);

  const mutation = useMutation({
    mutationFn: ({ tripId, status }: UpdateStatusVariables) => updateTripStatus(tripId, status),

    onMutate: async ({ tripId, status }) => {
      // In-flight reads would land AFTER the optimistic write and undo it.
      await queryClient.cancelQueries({ queryKey: tripKeys.schedules() });

      const snapshot = queryClient.getQueriesData<OffsetPage<TripScheduleWithRefs>>({
        queryKey: tripKeys.schedules(),
      });

      // Read BEFORE the optimistic patch below, or the "previous" status is the
      // one this click just guessed.
      const previous =
        snapshot
          .flatMap(([, page]) => page?.items ?? [])
          .find((trip) => trip.id === tripId)?.status ?? null;

      queryClient.setQueriesData<OffsetPage<TripScheduleWithRefs>>(
        { queryKey: tripKeys.schedules() },
        (page) =>
          page
            ? {
                ...page,
                items: page.items.map((trip) =>
                  trip.id === tripId ? { ...trip, status } : trip,
                ),
              }
            : page,
      );

      return { snapshot, previous };
    },

    // ★ THE RECEIPT IS THE ONLY THING THAT WAITS FOR THE SERVER. The badge
    // already moved on click (see above), so a toast on `onMutate` would
    // confirm the guess rather than the write — and the guess is precisely what
    // `onError` may take back. Announced here, it means the row is really saved.
    //
    // ★ AND IT CARRIES THE MOVE, NOT JUST THE FACT. "Đã cập nhật trạng thái" over
    // a board of twenty rows does not say WHICH row or to what; "Chờ xe → Đang
    // giao" does, and it is the line that makes the Hoàn tác button safe to
    // press — you can see what you are going back to.
    onSuccess: (_data, { tripId, status }, context) => {
      const previous = context?.previous ?? null;

      if (!previous) return notifySuccess('toastTripStatusUpdated');

      notifySuccess('toastTripStatusUpdated', {
        description: `${translateNow(TRIP_STATUS_LABELS[previous])} → ${translateNow(TRIP_STATUS_LABELS[status])}`,
        // ⚠ NOT A CLIENT-SIDE REWIND. This sends a fresh PATCH back to the old
        // status, so the server decides the undo the way it decided the change
        // — a trip archived in between refuses both, and says so.
        action: { labelKey: 'undo', onClick: () => fire.current?.({ tripId, status: previous }) },
      });
    },

    onError: (error, _variables, context) => {
      // Put back exactly what was there, THEN say why. In this order because
      // the message is about a badge that has already returned to its old
      // value — a dispatcher reading "không đổi được" while the row still shows
      // the new status would not believe either of them.
      for (const [key, page] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, page);
      }
      // The server's own words: it knows about archived trips and about states
      // this client has never heard of, and its sentence is the honest one.
      notifyApiError(error, 'statusChangeFailed');
    },

    onSettled: () => {
      // On success as well as on failure: the server also touches `updatedAt`,
      // and a row whose status decides its position in a future sort must come
      // from the server rather than from this guess.
      void queryClient.invalidateQueries({ queryKey: tripKeys.schedules() });
    },
  });

  fire.current = mutation.mutate;

  return mutation;
}
