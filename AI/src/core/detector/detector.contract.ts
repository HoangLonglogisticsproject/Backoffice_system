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

/**
 * A band of the read model's anchor for Discovery to walk: an interval whose
 * two bounds each carry their own inclusivity.
 *
 * ★ A DETECTOR MAY ASK FOR SEVERAL, IN PRIORITY ORDER, AND THAT IS SCAN
 * ORDERING RATHER THAN POLICY. The rule that decides whether a subject is a
 * problem does not change; what changes is which candidates a bounded scan
 * looks at FIRST. Without it, one band can consume the whole page budget
 * every run and another is never reached — a liveness bug, not a slow one.
 *
 * ★ THE DETECTOR DECIDES WHICH SIDE OF THE CUT THE BOUNDARY INSTANT IS ON,
 * because that is a statement about urgency and urgency is the detector's
 * subject. Adjacent bands must still partition exactly — no gap, no overlap
 * — and the flags are what make both halves of that expressible. The
 * alternative, moving a bound by a millisecond, encodes the decision as an
 * epsilon nobody can read and the database does not necessarily share.
 */
export interface CandidateWindow {
  /** A short name for the log line: `approaching`, `overdue`, `all`. */
  label: string;
  /** Upper bound of the anchor. */
  before: Date;
  /** Is `before` itself in the band? Default `true`. */
  beforeInclusive?: boolean;
  /** Lower bound of the anchor. Absent means unbounded below. */
  after?: Date;
  /** Is `after` itself in the band? Default `false`. */
  afterInclusive?: boolean;
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

  /**
   * The bands Discovery walks, MOST URGENT FIRST. One for most detectors;
   * more when a detector has a band that must not be starved by another.
   */
  candidateWindows(now: Date): CandidateWindow[];

  /** The subject id these facts describe — what an alert's `subjectId` becomes. */
  subjectIdOf(facts: Facts): string;

  /** The signal these facts justify right now, or `null` for "no problem here". */
  evaluate(facts: Facts, now: Date): AlertSignal | null;
}
