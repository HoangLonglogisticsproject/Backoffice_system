import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignDriver,
  endDriverAssignment,
  fetchDriverAssignments,
  fetchEligibleDrivers,
  replaceDriver,
  type DriverAssignment,
} from '@/api/tripAssignment';
import { isApiError } from '@/utils/errors';
import { notifyApiError, notifyError, notifySuccess } from '@/utils/toast';
import type { TranslationKey } from '@/types/translate';
import { tripKeys } from './keys';

/** The drivers a dispatcher may choose from. Read when the panel opens. */
export function useEligibleDrivers(enabled: boolean) {
  return useQuery({
    queryKey: tripKeys.drivers(),
    queryFn: () => fetchEligibleDrivers(),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * One trip's dispatch: every turn it has had, newest first.
 *
 * ★ READ WHEN THE PANEL OPENS, NOT WITH THE BOARD. The board row already
 * carries the active pairs; the ended turns and their reasons are history a
 * dispatcher opens on purpose.
 */
export function useTripAssignments(tripId: string | null): {
  assignments: DriverAssignment[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: tripKeys.assignments(tripId ?? ''),
    queryFn: () => fetchDriverAssignments(tripId as string),
    enabled: tripId !== null,
  });
  return { assignments: query.data ?? [], loading: query.isLoading };
}

/**
 * The three dispatch writes.
 *
 * ★ EVERY ONE NAMES A PAIR OR A TURN, NEVER "THE TRIP'S DRIVER" (ADR-0004).
 * A trip carries any number of lorries; adding one is a pair, and swapping or
 * removing one names WHICH turn.
 */
export type AssignmentChange =
  | { kind: 'assign'; tripId: string; vehicleId: string; driverUserId: string }
  | { kind: 'replace'; tripId: string; assignmentId: string; driverUserId: string; reason: string }
  | { kind: 'end'; tripId: string; assignmentId: string; reason: string };

/**
 * One write, three different things to have happened.
 *
 * ★ THE RECEIPT NAMES WHICH. "Đã lưu" after ending an assignment would leave a
 * dispatcher wondering whether the trip now has a driver or none — and this is
 * the write where that question matters.
 */
const ASSIGNMENT_RECEIPT: Record<AssignmentChange['kind'], TranslationKey> = {
  assign: 'toastDriverAssigned',
  replace: 'toastDriverReplaced',
  end: 'toastAssignmentEnded',
};

/**
 * One mutation for the three assignment writes.
 *
 * ★ NOT OPTIMISTIC, UNLIKE A STATUS MOVE. Who is driving is decided under a
 * lock on the server and can be refused for reasons the client cannot see —
 * the lorry is already on the trip, the account is not a driver, the turn has
 * already started, a colleague dispatched first. The board and the trip's
 * dispatch history are re-read on settle either way, so a refusal shows the
 * truth rather than a guess.
 */
export function useChangeDriverAssignment() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (change: AssignmentChange) => {
      switch (change.kind) {
        case 'assign':
          return assignDriver(change.tripId, {
            vehicleId: change.vehicleId,
            driverUserId: change.driverUserId,
          });
        case 'replace':
          return replaceDriver(change.tripId, change.assignmentId, {
            driverUserId: change.driverUserId,
            reason: change.reason,
          });
        case 'end':
          return endDriverAssignment(change.tripId, change.assignmentId, change.reason);
      }
    },
    onSuccess: (_data, change) => notifySuccess(ASSIGNMENT_RECEIPT[change.kind]),

    // ★ THE 409 GETS ITS OWN SENTENCE. Every other refusal is the server
    // explaining something this client could not have known, and its wording is
    // the honest one. A 409 is the ONE case where the raw message says less
    // than we can: somebody else moved this trip while the panel was open, or
    // the turn has started — and `onSettled` below has already re-read it, so
    // the useful instruction is "look again", not the server's noun phrase.
    onError: (error) => {
      if (isApiError(error) && error.status === 409) notifyError('assignConflict');
      else notifyApiError(error, 'saveFailed');
    },

    onSettled: (_data, _error, change) =>
      Promise.all([
        client.invalidateQueries({ queryKey: tripKeys.schedules() }),
        client.invalidateQueries({ queryKey: tripKeys.assignments(change.tripId) }),
      ]),
  });
}
