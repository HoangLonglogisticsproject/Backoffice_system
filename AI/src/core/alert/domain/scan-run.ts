import type { JsonValue } from './alert';

/**
 * One run of one detector in one phase. Foundation only in Phase 1a: the
 * engine that writes these is Phase 1b. The shape exists now so the failure
 * invariant — nothing resolves unless the run that checked it SUCCEEDED — has
 * a column to rest on from the first migration.
 */
export const SCAN_PHASES = ['discovery', 'resolution'] as const;
export type ScanPhase = (typeof SCAN_PHASES)[number];

export const SCAN_OUTCOMES = ['running', 'succeeded', 'partial', 'failed', 'abandoned'] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

/**
 * The run that may resolve an alert on the system's behalf: a RESOLUTION run
 * that SUCCEEDED, for the alert's own detector. A discovery run knows nothing
 * about clearing; a failed or partial run proved nothing (invariant M); another
 * detector's run verified another condition. `null` — no such run — verifies
 * nothing, whatever the caller believes.
 */
export const verifiesResolutionOf = (run: ScanRun | null, alert: { detectorCode: string }): boolean =>
  run !== null &&
  run.phase === 'resolution' &&
  run.outcome === 'succeeded' &&
  run.detectorCode === alert.detectorCode;

export interface ScanRun {
  id: string;
  detectorCode: string;
  detectorVersion: number;
  phase: ScanPhase;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: ScanOutcome;
  candidates: number;
  signals: number;
  created: number;
  updated: number;
  resolved: number;
  configSnapshot: { [key: string]: JsonValue };
  error: string | null;
  correlationId: string | null;
}
