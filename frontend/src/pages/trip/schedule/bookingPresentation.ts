import type { PermissionKey } from '@/types/auth';
import type { TripScheduleWithRefs } from '@/types/trip';
import type { TranslationKey } from '@/types/translate';

/**
 * How one booking reads on Lịch xe, and what may be done to it — pure
 * functions of the row the server sent, the viewer's permission hints and the
 * clock.
 *
 * ★ NOTHING HERE IS A STATUS. The trip's status is the server's three words
 * (`pending` · `executing` · `finished`, plus the retired `confirmed` on rows
 * not yet normalized) and `TripStatusBadge` says them. "Chưa phân công", "Sắp
 * đến giờ" and the rest are READINGS of the row, recomputed on every render;
 * none is stored, sent, or filtered on — the board's filters stay the server's
 * (`useTripSchedules`).
 *
 * ★ AND NOTHING HERE IS AUTHORIZATION. `can` is a render hint; every action
 * below reaches a route that re-decides it.
 */

type Can = (permission: PermissionKey) => boolean;

/** Is anybody on the run yet — the same line `?assignment=` draws on the server. */
export type CrewSignal = 'unassigned' | 'legacyVehicle' | 'assigned';

/**
 * ★ `legacyVehicle` IS STILL UNASSIGNED — the server lists it under "chờ phân
 * công" — but it names a lorry booked before dispatch became a pair, so the
 * reading says "re-dispatch this one" rather than a flat "nobody". See
 * `TripSchedule.legacyVehicleId`.
 */
export const crewSignal = (trip: TripScheduleWithRefs): CrewSignal => {
  if (trip.assignments.length > 0) return 'assigned';
  return trip.legacyVehicleId ? 'legacyVehicle' : 'unassigned';
};

export const CREW_LABELS: Record<CrewSignal, TranslationKey> = {
  unassigned: 'driverUnassigned',
  legacyVehicle: 'dispatchLegacyBadge',
  assigned: 'assignmentAssigned',
};

/** One end, in a list line: the place's name when there is one, else the first line of the address. */
export const placeLine = (place: { name: string } | null, address: string | null): string | null =>
  place?.name ?? address?.split('\n')[0]?.trim() ?? null;

/** Has a driver reported anything on any lorry of this trip? */
export const hasDriverProgress = (trip: TripScheduleWithRefs): boolean =>
  trip.assignments.some((turn) => turn.started);

/**
 * How the planned pickup hour stands against the clock, for a trip nobody has
 * started.
 *
 *   pastPlanned  "Quá giờ dự kiến" — the booked hour has passed
 *   dueSoon      "Sắp đến giờ" — it falls within `DUE_SOON_MS`
 *   null         not yet near, no hour booked, or a driver is already on it
 *
 * ★ A READING OF THE LIST ROW AND THE CLOCK, NOTHING MORE. No execution event
 * is fetched for it — `started` rides on every row of the list already — and
 * it is deliberately NOT the server's PICKUP_DELAYED, which judges arrivals
 * event by event; that state belongs to the selected trip's progress, read
 * from its own events. Hence a different name.
 *
 * ★ NO HOUR, NO URGENCY. `pickupAt` is optional; inventing one from the date
 * would raise "sắp đến giờ" over a time nobody booked.
 */
export type Urgency = 'pastPlanned' | 'dueSoon' | null;

// ponytail: one fixed window; make it a setting if dispatch asks for another.
export const DUE_SOON_MS = 2 * 60 * 60 * 1000;

export const URGENCY_LABELS: Record<NonNullable<Urgency>, TranslationKey> = {
  pastPlanned: 'bookingPastPlanned',
  dueSoon: 'bookingDueSoon',
};

export const urgencyOf = (trip: TripScheduleWithRefs, now: number): Urgency => {
  if (!trip.pickupAt || hasDriverProgress(trip)) return null;
  const untilPickup = Date.parse(trip.pickupAt) - now;
  if (untilPickup < 0) return 'pastPlanned';
  return untilPickup <= DUE_SOON_MS ? 'dueSoon' : null;
};

/**
 * What the OFFICE may do to a booking — crew it, correct it, cost it, archive
 * it. Never "change status", and never drive the run.
 *
 *   assign / reassign   dispatch.write             the dispatch panel (0..N pairs)
 *   edit                trip.write | price.write   the trip form
 *   costs               cost.read                  the cost dialog
 *   archive             trip.write                 POST …/archive
 *
 * ★ THE LIFECYCLE IS NOT THE OFFICE'S. The driver starts execution — the
 * first live milestone moves the trip `pending → executing` on the server —
 * and asks to close it; the SuperAdmin's approval closes it into Lịch sử
 * chuyến. So no action here starts, rewinds or completes a trip: the status is
 * a read-only projection of what the server recorded.
 *
 * ★ A FINISHED TRIP IS OFFERED NOTHING HERE. The server never lists one on
 * Lịch xe; a row that is momentarily `finished` in the cache is one that is
 * about to leave, and every write would be refused with a 409.
 *
 * In the order the detail panel shows them: the crew first, archive last.
 */
export type BookingAction = 'assign' | 'reassign' | 'edit' | 'costs' | 'archive';

export const ACTION_LABELS: Record<BookingAction, TranslationKey> = {
  assign: 'bookingAssign',
  reassign: 'bookingReassign',
  edit: 'edit',
  costs: 'tripCost',
  archive: 'archive',
};

export const bookingActions = (trip: TripScheduleWithRefs, can: Can): BookingAction[] => {
  if (trip.status === 'finished') return [];
  const offered: [BookingAction, boolean][] = [
    ['assign', can('dispatch.write') && trip.assignments.length === 0],
    ['reassign', can('dispatch.write') && trip.assignments.length > 0],
    ['edit', can('trip.write') || can('trip.price.write')],
    ['costs', can('cost.read')],
    ['archive', can('trip.write')],
  ];
  return offered.filter(([, allowed]) => allowed).map(([action]) => action);
};
