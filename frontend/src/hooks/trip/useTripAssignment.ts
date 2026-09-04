import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignDriver,
  endDriverAssignment,
  fetchEligibleDrivers,
  replaceDriver,
} from '@/api/tripAssignment';
import { isApiError } from '@/utils/errors';
import { notifyApiError, notifyError, notifySuccess } from '@/utils/toast';
import type { TranslationKey } from '@/types/translate';
import { tripKeys } from './keys';

/** The drivers a dispatcher may choose from. Read when the dialog opens. */
export function useEligibleDrivers(enabled: boolean) {
  return useQuery({
    queryKey: tripKeys.drivers(),
    queryFn: () => fetchEligibleDrivers(),
    enabled,
    staleTime: 60_000,
  });
}

export type AssignmentChange =
  | { kind: 'assign'; tripId: string; driverUserId: string }
  | { kind: 'replace'; tripId: string; driverUserId: string; reason: string }
  | { kind: 'end'; tripId: string; reason: string };

/**
 * One mutation for the three assignment writes.
 *
 * ★ NOT OPTIMISTIC, UNLIKE A STATUS MOVE. Who is driving is decided under a
 * lock on the server and can be refused for reasons the client cannot see —
 * the account is not a driver, was disabled a minute ago, the trip just
 * closed, a colleague assigned somebody first. The board is re-read on
 * settle either way, so a refusal shows the truth rather than a guess.
 */
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

export function useChangeDriverAssignment() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (change: AssignmentChange) => {
      switch (change.kind) {
        case 'assign':
          return assignDriver(change.tripId, change.driverUserId);
        case 'replace':
          return replaceDriver(change.tripId, {
            driverUserId: change.driverUserId,
            reason: change.reason,
          });
        case 'end':
          return endDriverAssignment(change.tripId, change.reason);
      }
    },
    onSuccess: (_data, change) => notifySuccess(ASSIGNMENT_RECEIPT[change.kind]),

    // ★ THE 409 GETS ITS OWN SENTENCE. Every other refusal is the server
    // explaining something this client could not have known, and its wording is
    // the honest one. A 409 is the ONE case where the raw message ("assignment
    // conflict") says less than we can: somebody else moved this trip while the
    // dialog was open, and `onSettled` below has already re-read the board — so
    // the useful instruction is "look again", not the server's noun phrase.
    onError: (error) => {
      if (isApiError(error) && error.status === 409) notifyError('assignConflict');
      else notifyApiError(error, 'saveFailed');
    },

    onSettled: () => client.invalidateQueries({ queryKey: tripKeys.schedules() }),
  });
}
