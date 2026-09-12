import type { StatusTone } from '@/components/common/StatusPill';
import type { TranslationKey } from '@/types/translate';
import type { TripLocation } from '@/types/trip';

/**
 * What a place's pill says, for every screen that shows one.
 *
 * ★ ONE DEFINITION, BECAUSE TWO SCREENS SHOWING THE SAME ROW MUST NOT DISAGREE.
 * The customer's dialog and the locations catalogue both draw this pill over
 * the same table; a copy in each is a copy that drifts the first time somebody
 * adjusts one.
 */

/** Both halves present. The server stores them both or neither; this is the only readiness there is. */
export const isLocated = (location: TripLocation): boolean =>
  location.latitude !== null && location.longitude !== null;

/**
 * ★ "LOCATED" ANSWERS "CAN A DRIVER BE CHECKED HERE", AND NOTHING MORE. It is a
 * fact about the row's coordinates. Whether any driver's reading then passed at
 * this place is the server's verdict on an execution event, worded separately
 * in the completion review.
 */
export const statusOf = (
  location: TripLocation,
): { label: TranslationKey; tone: StatusTone } => {
  if (location.status !== 'active') return { label: 'statusArchived', tone: 'gray' };
  if (isLocated(location)) return { label: 'locationLocated', tone: 'green' };
  return { label: 'locationUnlocated', tone: 'amber' };
};
