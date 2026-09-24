import type { AlertSignal } from '../alert/domain/alert';

/**
 * What a detector is, and what the engine may ask of it.
 *
 * ★ ONE PREDICATE, TWO PHASES. `evaluate` answers "is this subject a problem
 * right now, given these facts" and returns the signal, or `null`. Discovery
 * calls it over a candidate window; Resolution calls it over the subjects of
 * alerts that are already live. There is deliberately no second, separate
 * "is it clear" predicate: two predicates drift, and the day they disagree an
 * alert is either raised forever or resolved while its condition holds.
 *
 * ★ FACTS IN, SIGNAL OUT, NOTHING ELSE. A detector reads no database, makes
 * no HTTP call and holds no clock of its own. It is a pure function of
 * (facts, config, now), which is why its boundaries can be tested to the
 * second.
 */

/** The window Discovery should ask the backend for, in the backend's terms. */
export interface CandidateWindow {
  /** Upper bound for the read model's anchor — `pickupBefore` or `submittedBefore`. */
  before: Date;
}

export interface Detector<Facts> {
  readonly code: string;
  /** Moves when the LOGIC changes, never when a threshold is reconfigured. */
  readonly version: number;
  readonly subjectType: 'trip' | 'assignment' | 'completion_request';

  /**
   * `false` when the detector has no approved configuration to run on. A
   * disabled detector is skipped by both phases — it neither raises nor
   * resolves, because a rule nobody has defined cannot say anything about a
   * condition either way.
   */
  readonly enabled: boolean;

  /** Why it is disabled, for the boot log. `null` when it is enabled. */
  readonly disabledReason: string | null;

  /** The window Discovery asks for, computed from `now` and this detector's config. */
  candidateWindow(now: Date): CandidateWindow;

  /** The subject id these facts describe — what an alert's `subjectId` becomes. */
  subjectIdOf(facts: Facts): string;

  /** The signal these facts justify right now, or `null` for "no problem here". */
  evaluate(facts: Facts, now: Date): AlertSignal | null;
}
