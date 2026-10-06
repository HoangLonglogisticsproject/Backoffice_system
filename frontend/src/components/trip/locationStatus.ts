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
 * ★ "LOCATED" ANSWERS "DOES THIS ROW HAVE COORDINATES", AND NOTHING MORE.
 *
 * ⚠ IT NO LONGER IMPLIES A DRIVER CAN BE CHECKED HERE (DL-118): the geofence is
 * off, so an unlocated place blocks no confirmation. The pill still earns its
 * place — a place the office means to locate and has not is worth seeing, and the
 * check is deferred rather than abandoned — but it is a data-completeness marker
 * now, not a readiness gate.
 */
export const statusOf = (
  location: TripLocation,
): { label: TranslationKey; tone: StatusTone } => {
  if (location.status !== 'active') return { label: 'statusArchived', tone: 'gray' };
  if (isLocated(location)) return { label: 'locationLocated', tone: 'green' };
  return { label: 'locationUnlocated', tone: 'amber' };
};
