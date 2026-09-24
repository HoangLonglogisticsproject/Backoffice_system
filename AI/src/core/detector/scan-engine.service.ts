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

/** What one discovery has seen so far, across every band it has walked. */
interface DiscoveryTally {
  candidates: number;
  signals: number;
  created: number;
  updated: number;
}

/** The run a helper is working for, and the instant it is evaluating against. */
interface ScanContext {
  runId: string;
  correlationId: string;
  now: Date;
}

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

    let outcome: ScanOutcome = 'succeeded';
    let error: string | null = null;
    const tally: DiscoveryTally = { candidates: 0, signals: 0, created: 0, updated: 0 };

    try {
      // ★ THE BANDS ARE WALKED IN THE ORDER THE DETECTOR GAVE THEM, AND THE
      // PAGE BUDGET IS SHARED. The first band therefore spends the budget
      // first — which is the whole point of there being more than one: a
      // detector puts the band that must not be starved at the front. A band
      // left unwalked because the budget ran out is a PARTIAL scan, never a
      // successful one.
      let spent = 0;

      for (const window of detector.candidateWindows(now)) {
        if (spent >= MAX_PAGES) {
          outcome = 'partial';
          error = `Stopped after ${MAX_PAGES} pages; the "${window.label}" band was not reached.`;
          break;
        }

        const walk = await this.walkBand(detector, window, fetchPage, tally, {
          runId: run.id,
          correlationId,
          now,
          budget: MAX_PAGES - spent,
        });
        spent += walk.pagesRead;

        if (walk.unfinished) {
          // Not a failure of the backend, but not a complete scan either:
          // the rest of this band was never looked at, and saying
          // `succeeded` would be a claim this run cannot support.
          outcome = 'partial';
          error = `Stopped after ${MAX_PAGES} pages with more to read in the "${window.label}" band.`;
          break;
        }
      }
    } catch (error_) {
      outcome = error_ instanceof ReadModelError ? 'partial' : 'failed';
      error = describe(error_);
      this.logger.error(
        `discovery ${detector.code} run=${run.id} cid=${correlationId} outcome=${outcome} — ${error}`,
      );
    }

    const { candidates, signals, created, updated } = tally;
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
    let clear: string[] = [];

    try {
      const verification = await this.verifySubjects(detector, lookup, { runId: run.id, correlationId, now });
      candidates = verification.candidates;
      clear = verification.clear;

      if (verification.missing > 0) {
        // ★ AN INCOMPLETE VERIFICATION RESOLVES NOTHING — NOT EVEN THE PART
        // IT DID VERIFY. The backend answered, and some requested id was not
        // in the answer: the row is gone from a table nothing deletes from,
        // or the contract changed, or the lookup was silently truncated. The
        // last of those is the dangerous one, because it makes a subject that
        // EXISTS look absent — and if this run were allowed to close the
        // alerts it happened to verify, a truncated answer would resolve real
        // alerts one batch at a time. So the whole run is partial and the
        // second pass below does not run at all. Every alert stays live,
        // including the ones whose condition really had cleared; the next
        // complete run closes them.
        outcome = 'partial';
        error =
          `${verification.missing} of ${verification.candidates} subject(s) were not returned by the backend; ` +
          'nothing was resolved.';
      }
    } catch (error_) {
      outcome = error_ instanceof ReadModelError ? 'partial' : 'failed';
      error = describe(error_);
      this.logger.error(
        `resolution ${detector.code} run=${run.id} cid=${correlationId} outcome=${outcome} — ${error}`,
      );
    }

    await this.scanRuns.finish(run.id, { outcome, candidates, resolved: 0, error });

    // ★ ONLY NOW, AND ONLY IF THE RUN SUCCEEDED. `resolveBySystem` re-reads
    // this run inside its own transaction and refuses anything that is not a
    // succeeded resolution run of this detector.
    if (outcome === 'succeeded') {
      resolved = await this.closeCleared(detector, clear, { runId: run.id, correlationId });
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

  /**
   * Walk ONE band to its end, or until the shared page budget runs out.
   *
   * Everything a page produces — candidates counted, signals evaluated,
   * alerts upserted — happens here, because "read a band" and "spend the
   * budget across bands" are two different jobs and only the second one has
   * to know there is more than one band.
   */
  private async walkBand<Facts>(
    detector: Detector<Facts>,
    window: CandidateWindow,
    fetchPage: (window: CandidateWindow, cursor: string | null, correlationId: string) => Promise<FactsPage<Facts>>,
    tally: DiscoveryTally,
    context: ScanContext & { budget: number },
  ): Promise<{ pagesRead: number; unfinished: boolean }> {
    let cursor: string | null = null;
    let pagesRead = 0;

    do {
      const page: FactsPage<Facts> = await fetchPage(window, cursor, context.correlationId);
      tally.candidates += page.items.length;
      await this.recordPositives(detector, page.items, tally, context);

      cursor = page.hasMore ? page.nextCursor : null;
      pagesRead += 1;

      if (pagesRead >= context.budget && cursor) return { pagesRead, unfinished: true };
    } while (cursor);

    return { pagesRead, unfinished: false };
  }

  /** Evaluate one page of facts and upsert whatever the rule calls a problem. */
  private async recordPositives<Facts>(
    detector: Detector<Facts>,
    items: readonly Facts[],
    tally: DiscoveryTally,
    context: ScanContext,
  ): Promise<void> {
    for (const facts of items) {
      const signal = detector.evaluate(facts, context.now);
      if (!signal) continue;

      tally.signals += 1;
      const result = await this.alerts.recordSignal(signal, {
        scanRunId: context.runId,
        correlationId: context.correlationId,
      });
      if (result.created) tally.created += 1;
      else tally.updated += 1;
    }
  }

  /**
   * Ask the backend for every live subject BY ID and re-run the predicate on
   * what came back.
   *
   * Reports what it verified and what it could not: an id that was requested
   * and not returned is `missing`, never "clear". Deciding what a missing
   * subject means to the run is the caller's job, and the answer is that it
   * poisons the whole run.
   */
  private async verifySubjects<Facts>(
    detector: Detector<Facts>,
    lookup: (subjectIds: string[], correlationId: string) => Promise<Facts[]>,
    context: ScanContext,
  ): Promise<{ candidates: number; clear: string[]; missing: number }> {
    const live = await this.alertRows.liveSubjects(detector.code);
    const clear: string[] = [];
    let missing = 0;

    for (const batch of chunk(live, this.settings.resolutionBatchSize)) {
      const facts = await lookup(
        batch.map((row) => row.subjectId),
        context.correlationId,
      );
      const bySubject = new Map(facts.map((item) => [detector.subjectIdOf(item), item]));

      for (const row of batch) {
        const current = bySubject.get(row.subjectId);
        if (current === undefined) {
          missing += 1;
          this.logger.warn(
            `resolution ${detector.code} run=${context.runId} cid=${context.correlationId} ` +
              `alert=${row.alertId} subject=${row.subjectId} was not returned by the backend — keeping the alert`,
          );
          continue;
        }
        if (detector.evaluate(current, context.now) === null) clear.push(row.alertId);
      }
    }

    return { candidates: live.length, clear, missing };
  }

  /** Close the verified-clear alerts, and count only the ones that moved. */
  private async closeCleared<Facts>(
    detector: Detector<Facts>,
    clear: readonly string[],
    context: Omit<ScanContext, 'now'>,
  ): Promise<number> {
    let resolved = 0;

    for (const alertId of clear) {
      try {
        await this.alerts.resolveBySystem({
          alertId,
          scanRunId: context.runId,
          correlationId: context.correlationId,
        });
        resolved += 1;
      } catch (error_) {
        // A person acknowledged, dismissed or resolved it while the scan
        // ran: their move wins, and this is not a scan failure.
        this.logger.warn(
          `resolution ${detector.code} run=${context.runId} alert=${alertId} was not resolved: ${describe(error_)}`,
        );
      }
    }

    return resolved;
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
    const status = caught.status === undefined ? '' : ` (${caught.status})`;
    return `${caught.kind}${status}: ${caught.message}`;
  }
  return (caught as Error)?.message ?? String(caught);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
