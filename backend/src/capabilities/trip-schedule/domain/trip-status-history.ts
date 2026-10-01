import type { UserSummary } from '../../../common/types/user-summary';
import { isRetiredStatus, type LegacyTripStatus, type TripStatus } from './trip-schedule';
import type { TripEntryMode } from './trip-timeline';

/**
 * One move along the dispatch board.
 *
 * ★ BOTH ENDS OF THE TRANSITION, NOT JUST THE NEW ONE. A log saying "set to
 * confirmed" cannot be read on its own: whether that was a step forward or
 * somebody undoing a mistake depends entirely on what it was before. Storing
 * `from` costs one column and removes the need to reconstruct it by walking the
 * whole history in order.
 *
 * ★ THERE IS NO WAY TO EDIT ONE. The repository offers `record` and two reads,
 * and 0017 denies `DELETE` at the database. A history somebody can tidy up is
 * not evidence of anything.
 */
export interface TripStatusChange {
  id: string;
  /**
   * ★ A LEGACY VALUE IS POSSIBLE HERE AND NOWHERE ELSE. Rows written before
   * 0025 name one of the five workbook colours, and 0025 leaves them alone on
   * purpose — see `LEGACY_TRIP_STATUSES`. A reader that narrows this to
   * `TripStatus` is a reader that will meet `'awaiting_vehicle'` and have no
   * label for it.
   */
  from: TripStatus | LegacyTripStatus | null;
  to: TripStatus | LegacyTripStatus;
  /** Why, when the mover said. Optional — most board moves are routine. */
  reason: string | null;

  changedBy: string;
  /** The mover, spelled out: a UUID cannot be shown to anybody. */
  changedByUser: UserSummary;
  changedAt: Date;
}

/**
 * Whether the board may move from one status to another.
 *
 * ★ THIS ENCODES EXACTLY ONE RULE, AND DELIBERATELY NOT A FULL GRAPH.
 *
 * The only transition the business has actually settled is that FINISHED is the
 * end: a completed trip is closed permanently, because invoicing and
 * reconciliation both treat it as the point after which figures stop moving.
 * 0025's trigger enforces that at the database as well, so it holds against a
 * hand-typed UPDATE too.
 *
 * ⚠ AND `TRIP_STATUSES` BEING IN LIFECYCLE ORDER DOES NOT MAKE THE ORDER A
 * RULE. Every other pairing stays allowed, because nobody has specified whether
 * a trip may go back from `executing` to `pending` — and the first thing a
 * guessed rule would break is a dispatcher correcting a mis-click. When the
 * real ordering is decided it belongs here, as data, with the decision recorded
 * beside it.
 */
export const canTransition = (from: TripStatus, to: TripStatus): boolean =>
  from !== 'finished' || to === 'finished';

/**
 * Whether a status may only be reached by completing the trip.
 *
 * ★ `done` HAS EXACTLY ONE WRITE PATH, AND THE BOARD IS NOT IT.
 *
 * Completing a trip is not a board move that happens to be last. It is a
 * decision that freezes the trip's money, stamps who closed it, and cannot be
 * undone — 0017's trigger sees to the last part. Reaching that state by editing
 * a status field would skip the freeze and the stamp, and leave a trip that is
 * permanently closed with nothing recording why.
 *
 * So the ordinary status routes refuse it, and `TripCompletionService.approve`
 * is the only caller allowed through — which it is by writing the status
 * through the repository directly, inside the transaction that does the rest.
 */
export const isCompletionOnlyStatus = (status: TripStatus): boolean => status === 'finished';

/**
 * ★ THE MARK OF A TRIP RECORDED AFTER IT RAN, rather than run through the board.
 *
 * Written as the `reason` of the one history row a historical entry has
 * (`null → finished`) and as the `end_reason` of the crew it was recorded
 * with. A reason, not a status: the trip is `finished` like any other, and
 * this only says how it got there. System-written, so a fixed token.
 */
export const HISTORICAL_ENTRY_REASON = 'historical_entry';

/** The history reason of a trip closed by approving its last open turn — the text it has always carried. */
export const COMPLETION_APPROVED_REASON = 'All assignments approved.';

/**
 * ★ THE TEMPORARY MANUAL COMPLETION: a SuperAdmin choosing "Đã xác nhận" on the
 * board while the Driver flow is not yet the only way. The same closure as
 * approval (`closeTrip`); only this mark says which door it came through.
 */
export const MANUAL_COMPLETION_REASON = 'manual_completion';

/**
 * ★ A LEGACY `confirmed` ROW MOVED TO `finished` by the one-time normalization.
 * Says exactly what happened: nobody approved it at this instant — the record
 * was corrected to what the business says it always meant.
 */
export const LEGACY_NORMALIZATION_REASON = 'legacy_status_normalization';

/** How a new trip starts its life, or why the request cannot start it. */
export type InitialLifecycle =
  | { ok: true; status: TripStatus; closed: false; reason: null }
  /** Born closed — and then the reason the history and the crew carry. */
  | { ok: true; status: 'finished'; closed: true; reason: string }
  | { ok: false; refusal: 'COMPLETION_ONLY' | 'STATUS_SET_BY_ENTRY' | 'CREW_AFTER_BOOKING' | 'RETIRED_STATUS' };

/**
 * ★ THE CLIENT SAYS WHY A TRIP IS ENTERED; THE SERVER DECIDES HOW IT STARTS.
 *
 *   operational   a booking: `pending`, or another status the board may set —
 *                 never `finished`, which only approval reaches. Its crew is
 *                 dispatched afterwards, through the dispatch routes, which
 *                 tell the driver — so none is taken with the booking.
 *   historical    a run that already happened and ended: `finished`, closed,
 *                 its one history row marked `historical_entry`. The status
 *                 is not the caller's to name; its crew rides with it, since
 *                 a closed trip takes no dispatch afterwards.
 *
 * `undefined` — an in-process caller (fixtures, scripts) — books.
 */
export const initialLifecycle = (
  mode: TripEntryMode | undefined,
  requested: { status?: TripStatus; crewSupplied: boolean },
): InitialLifecycle => {
  if (mode === 'historical') {
    return requested.status === undefined
      ? { ok: true, status: 'finished', closed: true, reason: HISTORICAL_ENTRY_REASON }
      : { ok: false, refusal: 'STATUS_SET_BY_ENTRY' };
  }
  const status = requested.status ?? 'pending';
  if (isCompletionOnlyStatus(status)) return { ok: false, refusal: 'COMPLETION_ONLY' };
  if (isRetiredStatus(status)) return { ok: false, refusal: 'RETIRED_STATUS' };
  if (requested.crewSupplied) return { ok: false, refusal: 'CREW_AFTER_BOOKING' };
  return { ok: true, status, closed: false, reason: null };
};
