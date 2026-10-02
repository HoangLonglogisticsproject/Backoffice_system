import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { completeTrip, updateTripStatus } from '@/api/tripSchedule';
import { TRIP_STATUS_LABELS, type TripSchedule, type TripStatus } from '@/types/trip';
import { notifyApiError, notifySuccess, translateNow } from '@/utils/toast';
import { tripKeys } from './keys';
import { reviewKeys } from './useCompletionReview';

export interface UpdateStatusVariables {
  tripId: string;
  /** Where the trip stands now — for the receipt's "cũ → mới", never sent. */
  from: TripStatus;
  /** `pending` or `executing`. Completion is `useCompleteTrip`, not a move. */
  to: TripStatus;
}

/**
 * Moving one trip between Chờ xử lý and Đang thực hiện — "Bắt đầu thực hiện"
 * and "Đưa về Chờ xử lý".
 *
 * ★ ITS OWN ENDPOINT, NOT THE EDIT FORM. `PATCH /trip-schedules/:id/status` is
 * separate from the full PATCH for a reason the controller states: this is the
 * write dispatch performs many times a day. Sending the whole row to change one
 * field would also overwrite anything a colleague edited in between.
 *
 * ★ SERVER-CONFIRMED, NOT OPTIMISTIC. A lifecycle write shows nothing until
 * the server has accepted it: click → the button waits → success → the board
 * is re-read → the new status appears. The server can refuse a move the
 * browser cannot judge — going back to `pending` after a driver has reported
 * is a 409 — and a badge that changed on click would have announced a move
 * that never happened.
 *
 * ★ SO THERE IS NO UNDO EITHER. The way back is the opposite action, offered
 * by the panel under the same server rule, not a toast that replays a guess.
 */
export function useUpdateTripStatus(): UseMutationResult<TripSchedule, Error, UpdateStatusVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tripId, to }: UpdateStatusVariables) => updateTripStatus(tripId, to),

    // ★ RETURNED, SO THE MUTATION STAYS PENDING UNTIL THE BOARD HAS BEEN
    // RE-READ. Resolving on the write alone would let the button come back
    // while the row still showed the old status.
    onSuccess: async (_data, { from, to }) => {
      await queryClient.invalidateQueries({ queryKey: tripKeys.schedules() });
      notifySuccess('toastTripStatusUpdated', {
        description: `${translateNow(TRIP_STATUS_LABELS[from])} → ${translateNow(TRIP_STATUS_LABELS[to])}`,
      });
    },

    // The server's own words: it knows about archived trips, reported
    // milestones and states this client has never heard of.
    onError: (error) => notifyApiError(error, 'statusChangeFailed'),
  });
}

/**
 * "Đánh dấu Đã xác nhận" — the SuperAdmin closes the trip
 * (`POST /trip-schedules/:id/complete`, `trip.complete.review`). TEMPORARY,
 * while the Driver flow is not the only way a trip finishes.
 *
 * ★ NOTHING IS OPTIMISTIC, AND NOTHING IS ANNOUNCED HERE ON FAILURE. The write
 * is irreversible — 0025's trigger makes `finished` permanent — so the board
 * changes only once the server has done it; the confirmation dialog shows a
 * refusal in place, beside the button that caused it.
 *
 * The trip leaves Lịch xe for Lịch sử chuyến — both under `schedules()` — and
 * a completion a driver had waiting on leaves the review queue with it.
 */
export function useCompleteTrip(): UseMutationResult<TripSchedule, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tripId: string) => completeTrip(tripId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tripKeys.schedules() }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.queue() }),
        queryClient.invalidateQueries({ queryKey: [...tripKeys.all, 'operational-board'] }),
      ]);
      notifySuccess('toastTripConfirmed');
    },
  });
}
