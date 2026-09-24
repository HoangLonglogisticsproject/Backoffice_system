import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/time/clock';
import { DetectorSettings } from '../../config/detector-settings';
import {
  BackendReadModelClient,
  ReadModelError,
  type FactsPage,
} from '../../infrastructure/backend-client/backend-read-model.client';
import { AlertService } from '../alert/application/alert.service';
import { AlertRepository } from '../alert/persistence/alert.repository';
import { ScanRunRepository } from '../alert/persistence/scan-run.repository';
import type { ScanOutcome, ScanPhase } from '../alert/domain/scan-run';
import type { CandidateWindow, Detector } from './detector.contract';

/**
 * Discovery and Resolution — the two halves of a scan, and the invariant
 * between them.
 *
 * ★ THEY ARE DIFFERENT OPERATIONS, AND THAT IS THE WHOLE DESIGN (ADR-0007
 * §2.10). Discovery reads a candidate WINDOW and raises what it sees. It
 * NEVER resolves: a subject absent from a window has not been shown to be
 * clear, it has merely not been looked at — the window moved, the page
 * failed, the row sorted elsewhere.
 *
 * Resolution goes the other way: it starts from the alerts that are already
 * live, asks the backend for those exact subjects BY ID, and closes only the
 * ones whose current facts say the condition has gone. Everything else —
 * a timeout, a 5xx, a malformed page, an id the backend did not return —
 * leaves the alert exactly where it was.
 *
 * ★ A RUN THAT DID NOT SUCCEED RESOLVES NOTHING, and the rule is enforced
 * twice: this service stops at the first failure and marks the run `partial`
 * or `failed`, and `AlertService.resolveBySystem` independently refuses any
 * run that is not a SUCCEEDED resolution run of the alert's own detector. The
 * second check is what makes the first one impossible to bypass by accident.
 */

export interface ScanReport {
  scanRunId: string;
  detectorCode: string;
  phase: ScanPhase;
  outcome: ScanOutcome;
  candidates: number;
  signals: number;
  created: number;
  updated: number;
  resolved: number;
  durationMs: number;
  error: string | null;
}

/** How many pages one discovery may walk before it stops asking. */
const MAX_PAGES = 100;

@Injectable()
export class ScanEngineService {
  private readonly logger = new Logger(ScanEngineService.name);

  constructor(
    private readonly backend: BackendReadModelClient,
    private readonly alerts: AlertService,
    private readonly alertRows: AlertRepository,
    private readonly scanRuns: ScanRunRepository,
    private readonly settings: DetectorSettings,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Walk the candidate window, evaluate every fact, record every positive.
   * Stops at the first failed page and reports `partial` — the alerts it
   * already recorded stand, because a positive observation is still true.
   */
  async discover<Facts>(
    detector: Detector<Facts>,
    fetchPage: (window: CandidateWindow, cursor: string | null, correlationId: string) => Promise<FactsPage<Facts>>,
    correlationId: string = randomUUID(),
  ): Promise<ScanReport> {
    const startedAt = Date.now();
    const now = this.clock.now();
    const run = await this.scanRuns.start({
      detectorCode: detector.code,
      detectorVersion: detector.version,
      phase: 'discovery',
      configSnapshot: this.settings.snapshot(),
      correlationId,
    });

    let candidates = 0;
    let signals = 0;
    let created = 0;
    let updated = 0;
    let outcome: ScanOutcome = 'succeeded';
    let error: string | null = null;

    try {
      // ★ THE BANDS ARE WALKED IN THE ORDER THE DETECTOR GAVE THEM, AND THE
      // PAGE BUDGET IS SHARED. The first band therefore spends the budget
      // first — which is the whole point of there being more than one: a
      // detector puts the band that must not be starved at the front. A band
      // left unwalked because the budget ran out is a PARTIAL scan, never a
      // successful one.
      let pages = 0;

      for (const window of detector.candidateWindows(now)) {
        if (pages >= MAX_PAGES) {
          outcome = 'partial';
          error = `Stopped after ${MAX_PAGES} pages; the "${window.label}" band was not reached.`;
          break;
        }

        let cursor: string | null = null;
        do {
          const page: FactsPage<Facts> = await fetchPage(window, cursor, correlationId);
          candidates += page.items.length;

          for (const facts of page.items) {
            const signal = detector.evaluate(facts, now);
            if (!signal) continue;

            signals += 1;
            const result = await this.alerts.recordSignal(signal, { scanRunId: run.id, correlationId });
            if (result.created) created += 1;
            else updated += 1;
          }

          cursor = page.hasMore ? page.nextCursor : null;
          pages += 1;
          if (pages >= MAX_PAGES && cursor) {
            // Not a failure of the backend, but not a complete scan either:
            // the rest of this band was never looked at, and saying
            // `succeeded` would be a claim this run cannot support.
            outcome = 'partial';
            error = `Stopped after ${MAX_PAGES} pages with more to read in the "${window.label}" band.`;
            break;
          }
        } while (cursor);

        if (outcome === 'partial') break;
      }
    } catch (caught) {
      outcome = caught instanceof ReadModelError ? 'partial' : 'failed';
      error = describe(caught);
      this.logger.error(
        `discovery ${detector.code} run=${run.id} cid=${correlationId} outcome=${outcome} — ${error}`,
      );
    }

    await this.scanRuns.finish(run.id, { outcome, candidates, signals, created, updated, error });

    const report: ScanReport = {
      scanRunId: run.id,
      detectorCode: detector.code,
      phase: 'discovery',
      outcome,
      candidates,
      signals,
      created,
      updated,
      resolved: 0,
      durationMs: Date.now() - startedAt,
      error,
    };
    this.log(report, correlationId);
    return report;
  }

  /**
   * Re-check every live alert of this detector against the backend's current
   * facts, and close the ones that have genuinely cleared.
   *
   * ★ THE RUN IS MARKED `succeeded` ONLY AFTER EVERY BATCH CAME BACK, and
   * `resolveBySystem` will not accept a run in any other state — so a
   * partially-fetched resolution cannot close anything, even by mistake. The
   * resolutions therefore happen in a SECOND pass, after the run is closed.
   */
  async resolve<Facts>(
    detector: Detector<Facts>,
    lookup: (subjectIds: string[], correlationId: string) => Promise<Facts[]>,
    correlationId: string = randomUUID(),
  ): Promise<ScanReport> {
    const startedAt = Date.now();
    const now = this.clock.now();
    const run = await this.scanRuns.start({
      detectorCode: detector.code,
      detectorVersion: detector.version,
      phase: 'resolution',
      configSnapshot: this.settings.snapshot(),
      correlationId,
    });

    let candidates = 0;
    let resolved = 0;
    let outcome: ScanOutcome = 'succeeded';
    let error: string | null = null;
    /** Alert ids whose subjects were fetched AND evaluated as clear. */
    const clear: string[] = [];

    try {
      const live = await this.alertRows.liveSubjects(detector.code);
      candidates = live.length;

      for (const batch of chunk(live, this.settings.resolutionBatchSize)) {
        const facts = await lookup(
          batch.map((row) => row.subjectId),
          correlationId,
        );
        const bySubject = new Map(facts.map((item) => [detector.subjectIdOf(item), item]));

        for (const row of batch) {
          const current = bySubject.get(row.subjectId);
          if (current === undefined) {
            // ★ NOT "RESOLVED". The backend answered, and this id was not in
            // the answer: the row is gone from a table nothing deletes from,
            // or the contract changed. Either way nobody has shown the
            // condition cleared, so the alert stays and says so.
            this.logger.warn(
              `resolution ${detector.code} run=${run.id} cid=${correlationId} ` +
                `alert=${row.alertId} subject=${row.subjectId} was not returned by the backend — keeping the alert`,
            );
            continue;
          }
          if (detector.evaluate(current, now) === null) clear.push(row.alertId);
        }
      }
    } catch (caught) {
      outcome = caught instanceof ReadModelError ? 'partial' : 'failed';
      error = describe(caught);
      this.logger.error(
        `resolution ${detector.code} run=${run.id} cid=${correlationId} outcome=${outcome} — ${error}`,
      );
    }

    await this.scanRuns.finish(run.id, { outcome, candidates, resolved: 0, error });

    // ★ ONLY NOW, AND ONLY IF THE RUN SUCCEEDED. `resolveBySystem` re-reads
    // this run inside its own transaction and refuses anything that is not a
    // succeeded resolution run of this detector.
    if (outcome === 'succeeded') {
      for (const alertId of clear) {
        try {
          await this.alerts.resolveBySystem({ alertId, scanRunId: run.id, correlationId });
          resolved += 1;
        } catch (caught) {
          // A person acknowledged, dismissed or resolved it while the scan
          // ran: their move wins, and this is not a scan failure.
          this.logger.warn(
            `resolution ${detector.code} run=${run.id} alert=${alertId} was not resolved: ${describe(caught)}`,
          );
        }
      }
      await this.scanRuns.recordResolved(run.id, resolved);
    }

    const report: ScanReport = {
      scanRunId: run.id,
      detectorCode: detector.code,
      phase: 'resolution',
      outcome,
      candidates,
      signals: 0,
      created: 0,
      updated: 0,
      resolved,
      durationMs: Date.now() - startedAt,
      error,
    };
    this.log(report, correlationId);
    return report;
  }

  /** One structured line per run. No token, no context, no operational payload. */
  private log(report: ScanReport, correlationId: string): void {
    const line = JSON.stringify({
      event: 'scan_run',
      detector: report.detectorCode,
      phase: report.phase,
      runId: report.scanRunId,
      outcome: report.outcome,
      durationMs: report.durationMs,
      candidates: report.candidates,
      signals: report.signals,
      created: report.created,
      updated: report.updated,
      resolved: report.resolved,
      correlationId,
      ...(report.error ? { error: report.error } : {}),
    });
    if (report.outcome === 'succeeded') this.logger.log(line);
    else this.logger.warn(line);
  }
}

/** The message, and for a read failure its classification — never a payload. */
function describe(caught: unknown): string {
  if (caught instanceof ReadModelError) {
    return `${caught.kind}${caught.status ? ` (${caught.status})` : ''}: ${caught.message}`;
  }
  return (caught as Error)?.message ?? String(caught);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
