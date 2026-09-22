import { ValidationError } from '../../../common/errors/domain.error';
import type { ActorType } from './actor';
import type { AlertStatus } from './alert';

/**
 * The lifecycle, as data.
 *
 *   USER    open → acknowledged · open → dismissed · acknowledged → dismissed
 *           open → resolved · acknowledged → resolved
 *   SYSTEM  open → resolved · acknowledged → resolved · dismissed → resolved
 *
 * ★ `dismissed → resolved` IS THE SYSTEM'S ALONE. Dismissing means "suppress
 * until the condition clears", and only a verified Resolution run can say it
 * has. A person who wants an incident gone resolves it while it is open or
 * acknowledged; a person who has dismissed it has already said their piece.
 *
 * No reopen, no snooze (v1). `resolved` is terminal; a condition that comes
 * back is a new incident.
 */
type Move = readonly [from: AlertStatus, to: AlertStatus];

const USER_MOVES: readonly Move[] = [
  ['open', 'acknowledged'],
  ['open', 'dismissed'],
  ['acknowledged', 'dismissed'],
  ['open', 'resolved'],
  ['acknowledged', 'resolved'],
];

const SYSTEM_MOVES: readonly Move[] = [
  ['open', 'resolved'],
  ['acknowledged', 'resolved'],
  ['dismissed', 'resolved'],
];

const MOVES: Readonly<Record<ActorType, readonly Move[]>> = {
  user: USER_MOVES,
  system: SYSTEM_MOVES,
};

export const canTransition = (from: AlertStatus, to: AlertStatus, actor: ActorType): boolean =>
  MOVES[actor].some(([f, t]) => f === from && t === to);

/** The targets a transition may name. `open` is never a target: no reopen. */
export const TRANSITION_TARGETS = ['acknowledged', 'dismissed', 'resolved'] as const;
export type TransitionTarget = (typeof TRANSITION_TARGETS)[number];

/**
 * A reason is mandatory for a dismissal and optional otherwise. Returns the
 * trimmed reason, or `null` when none was given and none is required.
 */
export function normaliseReason(to: TransitionTarget, reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? '';

  if (to === 'dismissed' && trimmed.length === 0) {
    throw new ValidationError('Dismissing an alert requires a reason.', {
      reason: 'Required when dismissing.',
    });
  }

  return trimmed.length > 0 ? trimmed : null;
}
