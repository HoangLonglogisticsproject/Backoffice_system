import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { updateTripStatus } from '@/api/tripSchedule';
import type { OffsetPage } from '@/types/pagination';
import type { TripSchedule, TripScheduleWithRefs, TripStatus } from '@/types/trip';
import { tripKeys } from './keys';

export interface UpdateStatusVariables {
  tripId: string;
  status: TripStatus;
}

interface StatusContext {
  /** Every cached page as it was, for putting back if the server refuses. */
  snapshot: Array<[readonly unknown[], OffsetPage<TripScheduleWithRefs> | undefined]>;
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

  return useMutation({
    mutationFn: ({ tripId, status }: UpdateStatusVariables) => updateTripStatus(tripId, status),

    onMutate: async ({ tripId, status }) => {
      // In-flight reads would land AFTER the optimistic write and undo it.
      await queryClient.cancelQueries({ queryKey: tripKeys.schedules() });

      const snapshot = queryClient.getQueriesData<OffsetPage<TripScheduleWithRefs>>({
        queryKey: tripKeys.schedules(),
      });

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

      return { snapshot };
    },

    onError: (_error, _variables, context) => {
      // Put back exactly what was there. The component surfaces the server's
      // message; this only undoes the guess.
      for (const [key, page] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, page);
      }
    },

    onSettled: () => {
      // On success as well as on failure: the server also touches `updatedAt`,
      // and a row whose status decides its position in a future sort must come
      // from the server rather than from this guess.
      void queryClient.invalidateQueries({ queryKey: tripKeys.schedules() });
    },
  });
}
