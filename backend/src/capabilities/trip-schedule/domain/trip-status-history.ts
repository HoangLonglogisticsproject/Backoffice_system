import type { UserSummary } from '../../../common/types/user-summary';
import type { TripStatus } from './trip-schedule';

/**
 * One move along the dispatch board.
 *
 * ★ BOTH ENDS OF THE TRANSITION, NOT JUST THE NEW ONE. A log saying "set to
 * awaiting_vehicle" cannot be read on its own: whether that was a step forward
 * or somebody undoing a mistake depends entirely on what it was before. Storing
 * `from` costs one column and removes the need to reconstruct it by walking the
 * whole history in order.
 *
 * ★ THERE IS NO WAY TO EDIT ONE. The repository offers `record` and two reads,
 * and 0017 denies `DELETE` at the database. A history somebody can tidy up is
 * not evidence of anything.
 */
export interface TripStatusChange {
  id: string;
  /** `null` only on the row written when the trip was created. */
  from: TripStatus | null;
  to: TripStatus;
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
 * The only transition the business has actually settled is that DONE is the
 * end: a completed trip is closed permanently, because invoicing and
 * reconciliation both treat it as the point after which figures stop moving.
 * 0017 enforces that with a trigger as well, so it holds against a hand-typed
 * UPDATE too.
 *
 * Every other pairing among the five dispatch values is allowed, because
 * nobody has specified an order for them and inventing one here would turn a
 * guess into a rule operators cannot get around. When the real ordering is
 * decided it belongs here, as data, with the decision recorded beside it.
 */
export const canTransition = (from: TripStatus, to: TripStatus): boolean =>
  from !== 'done' || to === 'done';

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
export const isCompletionOnlyStatus = (status: TripStatus): boolean => status === 'done';
