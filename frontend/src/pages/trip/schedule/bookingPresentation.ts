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
 * What may be done to a booking, as domain verbs — never "change status".
 *
 *   assign / reassign   dispatch.write             the dispatch panel (0..N pairs)
 *   start               trip.write, pending        PATCH …/status → executing
 *   returnToPending     trip.write, executing,     PATCH …/status → pending
 *                       no driver report yet
 *   edit                trip.write | price.write   the trip form
 *   costs               cost.read                  the cost dialog
 *   complete            trip.complete.review       POST …/complete (TEMPORARY)
 *   archive             trip.write                 POST …/archive
 *
 * ★ `start` AND `returnToPending` ARE THE BOARD MOVE, NAMED. Nothing on the
 * server moves a trip to `executing` — driver milestones leave the status
 * alone — so dropping the dropdown without these would leave no way onto the
 * road at all. Same route, same `trip.write`; only the generic picker is gone.
 *
 * ★ AND GOING BACK FOLLOWS THE SERVER'S RULE, IT DOES NOT MAKE ONE. The status
 * route refuses `pending` (409) while the trip has a live milestone OR a
 * completion request standing (`pending`/`approved`). The first half is
 * exactly `started` — a live event on an active turn, cleared when the last
 * one is withdrawn, and no other turn can hold one — so the button is hidden
 * only where the server would certainly refuse. The second half is not on the
 * list row; there the button stays, and the server's own sentence explains
 * the refusal. Nothing allowed is ever hidden.
 *
 * ★ `complete` IS NOT A MOVE. It is the canonical completion, the SuperAdmin's
 * key only (`trip.complete.review` is global-tier, no function grants it), and
 * it is offered on every open row — the legacy `confirmed` ones included,
 * which is exactly what they are waiting for.
 *
 * ★ A FINISHED TRIP IS OFFERED NOTHING HERE. The server never lists one on
 * Lịch xe; a row that is momentarily `finished` in the cache is one that is
 * about to leave, and every write would be refused with a 409.
 *
 * In the order the detail panel shows them: the next step first, the
 * irreversible ones last.
 */
export type BookingAction =
  | 'assign'
  | 'reassign'
  | 'start'
  | 'returnToPending'
  | 'edit'
  | 'costs'
  | 'complete'
  | 'archive';

export const ACTION_LABELS: Record<BookingAction, TranslationKey> = {
  assign: 'bookingAssign',
  reassign: 'bookingReassign',
  start: 'bookingStart',
  returnToPending: 'bookingReturnToPending',
  edit: 'edit',
  costs: 'tripCost',
  complete: 'bookingComplete',
  archive: 'archive',
};

export const bookingActions = (trip: TripScheduleWithRefs, can: Can): BookingAction[] => {
  if (trip.status === 'finished') return [];
  const offered: [BookingAction, boolean][] = [
    ['assign', can('dispatch.write') && trip.assignments.length === 0],
    ['reassign', can('dispatch.write') && trip.assignments.length > 0],
    ['start', can('trip.write') && trip.status === 'pending'],
    ['returnToPending', can('trip.write') && trip.status === 'executing' && !hasDriverProgress(trip)],
    ['edit', can('trip.write') || can('trip.price.write')],
    ['costs', can('cost.read')],
    ['complete', can('trip.complete.review')],
    ['archive', can('trip.write')],
  ];
  return offered.filter(([, allowed]) => allowed).map(([action]) => action);
};
