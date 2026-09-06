import type { UserSummary } from '../../../common/types/user-summary';
import type { LegacyTripStatus, TripStatus } from './trip-schedule';

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
