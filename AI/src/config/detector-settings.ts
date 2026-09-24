import { Injectable } from '@nestjs/common';
import { AppConfig } from './app.config';
import { toSeconds } from './duration';

/**
 * What the detectors are allowed to believe about time.
 *
 * ★ TWO KINDS OF NUMBER LIVE HERE, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   APPROVED BUSINESS POLICY — the CEO has decided it, so it is the default
 *   and an environment may override it: D1's two-hour warning lead, D3's
 *   twelve-hour review window.
 *
 *   NOT YET DECIDED — nobody has chosen it, so there is NO default and this
 *   file will not invent one. An absent value is absent, and the code says
 *   what it does about that, loudly:
 *
 *     a missing HIGH band      the detector emits `warning` and never `high`.
 *                              Severity is a judgement; without one, the
 *                              honest answer is the lower one, not a guess.
 *     a missing D2 grace       the detector is DISABLED. Its rule is "how long
 *                              after pickup is too long", and there is no such
 *                              thing as "zero by default" — running it with a
 *                              zero grace would alert on every assignment the
 *                              moment its pickup passed, which is a business
 *                              decision nobody took.
 *     a missing scan interval  the scheduler does not arm at all.
 *
 * ★ `info` AND `critical` ARE NOT EMITTED IN v1. The column admits them so
 * Phase 2/3 need no migration; no rule here produces them.
 */

/** A detector's timing, resolved. `null` means "nobody has decided". */
export interface DetectorTiming {
  /** Milliseconds. Present for D1 and D3 (CEO-approved); required for D2. */
  readonly warningMs: number | null;
  /** Milliseconds. `null` everywhere in v1: no HIGH band has been approved. */
  readonly highMs: number | null;
}

export interface DetectorSettingsSnapshot {
  readonly [key: string]: string | number | boolean | null;
}

@Injectable()
export class DetectorSettings {
  constructor(private readonly config: AppConfig) {}

  /**
   * D1 — how long before `pickup_at` an unassigned trip becomes a warning.
   * CEO, 2026-09-19: two hours.
   */
  get unassignedTripWarningLeadMs(): number {
    return this.config.unassignedTripWarningLeadMs;
  }

  /** D1's HIGH band. TBD — `null` until a threshold is approved. */
  get unassignedTripHighLeadMs(): number | null {
    return this.config.unassignedTripHighLeadMs;
  }

  /**
   * D2 — how long after `pickup_at` an unstarted assignment becomes a
   * warning. NOT APPROVED. `null` disables the detector; it does not mean
   * zero.
   */
  get staleStartGraceMs(): number | null {
    return this.config.staleStartGraceMs;
  }

  /** D2's HIGH band. TBD. */
  get staleStartHighMs(): number | null {
    return this.config.staleStartHighMs;
  }

  /**
   * D3 — how long a completion may sit pending before it is a warning.
   * CEO, 2026-09-19: twelve hours.
   */
  get completionReviewWarningAfterMs(): number {
    return this.config.completionReviewWarningAfterMs;
  }

  /** D3's HIGH band. TBD. */
  get completionReviewHighAfterMs(): number | null {
    return this.config.completionReviewHighAfterMs;
  }

  /** How many facts one read-model page asks for. Technical, not policy. */
  get readModelPageSize(): number {
    return this.config.readModelPageSize;
  }

  /** How many subject ids one resolution lookup carries. Technical, not policy. */
  get resolutionBatchSize(): number {
    return this.config.resolutionBatchSize;
  }

  /**
   * What is in force, for `scan_runs.config_snapshot` and for an alert's
   * evidence: an alert should be able to say which numbers produced it,
   * without those numbers having to live in a table.
   */
  snapshot(): DetectorSettingsSnapshot {
    const seconds = (value: number | null): number | null => (value === null ? null : toSeconds(value));
    return {
      unassignedTripWarningLeadSeconds: seconds(this.unassignedTripWarningLeadMs),
      unassignedTripHighLeadSeconds: seconds(this.unassignedTripHighLeadMs),
      staleStartGraceSeconds: seconds(this.staleStartGraceMs),
      staleStartHighSeconds: seconds(this.staleStartHighMs),
      completionReviewWarningAfterSeconds: seconds(this.completionReviewWarningAfterMs),
      completionReviewHighAfterSeconds: seconds(this.completionReviewHighAfterMs),
    };
  }
}
