import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyAssignmentRequests,
  fetchOpenBookings,
  requestOpenBooking,
  withdrawAssignmentRequest,
} from '@/api/openBooking';
import type { DriverAssignmentRequest, DriverOpenBookingItem } from '@/types/openBooking';
import { ApiError, isApiError } from '@/utils/errors';
import { driverErrorKey } from '@/utils/driverErrors';
import { notifyError, notifySuccess } from '@/utils/toast';
import { driverKeys } from './index';

/**
 * Open bookings and the driver's own asks (0035).
 *
 * ★ ONE PREFIX FOR BOTH, because every change moves both at once: asking puts
 * a "đang chờ duyệt" on the booking AND a row in "Yêu cầu của tôi". The
 * notification stream reconciles this prefix too, so an approval, a rejection
 * or another driver winning re-reads both lists.
 */
export const bookingKeys = {
  all: [...driverKeys.all, 'bookings'] as const,
  open: () => [...bookingKeys.all, 'open'] as const,
  requests: () => [...bookingKeys.all, 'requests'] as const,
};

const asApiError = (error: unknown): ApiError | null => {
  if (!error) return null;
  return isApiError(error) ? error : new ApiError(0, undefined, 'Unexpected error.');
};

interface ListState<T> {
  items: T[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

/** Same freshness as the driver's own trips: offline is an error to say, not a pause. */
const LIST_OPTIONS = { staleTime: 30_000, networkMode: 'always' } as const;

export function useOpenBookings(): ListState<DriverOpenBookingItem> {
  const query = useQuery({ queryKey: bookingKeys.open(), queryFn: fetchOpenBookings, ...LIST_OPTIONS });
  return { items: query.data ?? [], loading: query.isLoading, error: asApiError(query.error), reload: () => void query.refetch() };
}

export function useMyAssignmentRequests(): ListState<DriverAssignmentRequest> {
  const query = useQuery({ queryKey: bookingKeys.requests(), queryFn: fetchMyAssignmentRequests, ...LIST_OPTIONS });
  return { items: query.data ?? [], loading: query.isLoading, error: asApiError(query.error), reload: () => void query.refetch() };
}

/**
 * "Xin nhận chuyến" and "Rút yêu cầu".
 *
 * ★ BOTH RE-READ ON FAILURE TOO. A refusal here usually means the screen is
 * behind — the booking was taken, the ask already decided — so the answer to
 * an error is the server's current lists, not a retry of the same tap.
 */
export function useBookingRequests() {
  const client = useQueryClient();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: bookingKeys.all }),
      // An approval may already have put the trip in "Chuyến của tôi".
      client.invalidateQueries({ queryKey: driverKeys.assignments() }),
    ]);
  // ★ SAID BY TOAST, NOT ON THE CARD: the re-read may take the card away (the
  // booking was taken), and the reason must outlive it.
  const failed = (error: unknown) => {
    notifyError(isApiError(error) && error.status === 409 ? 'driverErrRequestResolved' : driverErrorKey(error));
    return refresh();
  };

  const ask = useMutation({
    mutationFn: (tripId: string) => requestOpenBooking(tripId),
    onSuccess: () => {
      notifySuccess('toastBookingRequested');
      return refresh();
    },
    onError: failed,
  });

  const withdraw = useMutation({
    mutationFn: (requestId: string) => withdrawAssignmentRequest(requestId),
    onSuccess: () => {
      notifySuccess('toastBookingRequestWithdrawn');
      return refresh();
    },
    onError: failed,
  });

  return { ask, withdraw };
}
