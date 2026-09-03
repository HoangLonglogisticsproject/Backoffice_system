import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignDriver,
  endDriverAssignment,
  fetchEligibleDrivers,
  replaceDriver,
} from '@/api/tripAssignment';
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
    onSettled: () => client.invalidateQueries({ queryKey: tripKeys.schedules() }),
  });
}
