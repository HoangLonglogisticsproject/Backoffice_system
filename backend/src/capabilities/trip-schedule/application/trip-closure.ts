import type { DatabaseQuery } from '../../../common/types/database.port';
import type { TripSchedule } from '../domain/trip-schedule';
import type { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import type { TripStatusHistoryRepository } from '../persistence/trip-status-history.repository';

/**
 * ★ THE ONE WAY A TRIP THAT EXISTS BECOMES `finished` — "Đã xác nhận", the trip
 * is done: status, one history row, the closing stamp, together, once.
 *
 * Its callers mean the same thing and differ only in the history `reason`:
 *
 *   approval of the last open turn    `TripCompletionService.approve` — the
 *                                     target workflow, driven by the drivers
 *   the SuperAdmin's manual completion `TripCompletionService.completeManually`
 *                                     — the board's temporary control
 *   legacy `confirmed` normalization  `LegacyConfirmedNormalization.apply`
 *
 * So when the manual control goes, nothing here changes. A trip BORN finished
 * ("Nhập chuyến cũ") never existed open, and is written finished in one
 * statement instead (`TripScheduleRepository.createFinished`).
 *
 * The caller holds the trip's row lock and has refused a closed trip.
 * `markClosed` is `WHERE closed_at IS NULL`, so a stamp the trip already
 * carries is kept, never overwritten.
 */
export async function closeTrip(
  repositories: { trips: TripScheduleRepository; history: TripStatusHistoryRepository },
  trip: TripSchedule,
  closing: { by: string; reason: string; at: Date },
  tx: DatabaseQuery,
): Promise<TripSchedule> {
  const closed = await repositories.trips.updateStatus(trip.id, 'finished', tx);
  if (!closed) throw new Error('Locked trip disappeared while closing.');

  await repositories.history.record(
    { tripId: trip.id, from: trip.status, to: 'finished', reason: closing.reason, changedBy: closing.by },
    tx,
  );
  await repositories.trips.markClosed(trip.id, closing.by, closing.at, tx);
  return closed;
}
