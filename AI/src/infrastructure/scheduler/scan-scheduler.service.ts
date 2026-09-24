import { Injectable, Logger, OnApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/app.config';
import { DetectorSettings } from '../../config/detector-settings';
import { ScanEngineService } from '../../core/detector/scan-engine.service';
import { BackendReadModelClient } from '../backend-client/backend-read-model.client';
import { CompletionReviewOverdueDetector } from '../../detectors/completion-review-overdue.detector';
import { StaleAssignmentStartDetector } from '../../detectors/stale-assignment-start.detector';
import { UnassignedTripApproachingDetector } from '../../detectors/unassigned-trip-approaching.detector';
import { ScanLock } from './scan-lock';

/**
 * What runs the detectors, and what stops two workers running the same one.
 *
 * ★ A TIMER, NOT A JOB RUNNER. There is one recurring task per detector and
 * nothing to enqueue, retry or route; a queue would add a broker, a schema
 * and a failure mode to replace `setInterval`. What a queue would have given
 * us — exactly-one-worker — comes from a PostgreSQL advisory lock instead,
 * which is true for N replicas without a new service to operate.
 *
 * ★ IT DOES NOT ARM WITHOUT A DECISION. No `SCAN_INTERVAL` means nobody has
 * chosen how often to scan, and a default would be a business decision taken
 * by a programmer. The service still boots and still serves the Alert API; it
 * says at boot, once, why it is not scanning.
 *
 * ★ TICKS DO NOT OVERLAP THEMSELVES. A tick that is still running when the
 * next one fires is skipped locally (`inFlight`) as well as globally (the
 * lock) — the local guard costs nothing and keeps the common case off the
 * database.
 */
@Injectable()
export class ScanSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScanSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private stopping = false;

  constructor(
    private readonly config: AppConfig,
    private readonly settings: DetectorSettings,
    private readonly engine: ScanEngineService,
    private readonly backend: BackendReadModelClient,
    private readonly lock: ScanLock,
    private readonly unassignedTrips: UnassignedTripApproachingDetector,
    private readonly staleStarts: StaleAssignmentStartDetector,
    private readonly completionReviews: CompletionReviewOverdueDetector,
  ) {}

  onApplicationBootstrap(): void {
    const reason = this.disarmedReason();
    if (reason) {
      this.logger.warn(`Scan scheduler is NOT armed: ${reason}`);
      this.reportDisabledDetectors();
      return;
    }

    for (const detector of [this.unassignedTrips, this.staleStarts, this.completionReviews]) {
      if (!detector.enabled) this.logger.warn(`Detector ${detector.code} is DISABLED: ${detector.disabledReason}`);
    }

    const intervalMs = this.config.scanIntervalMs as number;
    this.startTimer = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), intervalMs);
      this.timer.unref?.();
    }, this.config.scanInitialDelayMs);
    this.startTimer.unref?.();

    this.logger.log(
      `Scan scheduler armed: every ${intervalMs}ms, first run in ${this.config.scanInitialDelayMs}ms.`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.lock.close();
  }

  /**
   * One pass over every enabled detector: discovery, then resolution.
   *
   * Sequential on purpose — one small VPS, and a detector's resolution reads
   * the alerts its own discovery just wrote. Public so a test can drive it
   * without waiting for a timer.
   */
  async tick(correlationId: string = randomUUID()): Promise<void> {
    if (this.inFlight || this.stopping) return;
    this.inFlight = true;

    try {
      await this.runUnassignedTrips(correlationId);
      await this.runStaleStarts(correlationId);
      await this.runCompletionReviews(correlationId);
    } catch (error) {
      // A tick never throws into the timer: an unhandled rejection there
      // takes the process down and stops every future scan.
      this.logger.error(`Scan tick ${correlationId} failed: ${(error as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }

  private async runUnassignedTrips(correlationId: string): Promise<void> {
    const detector = this.unassignedTrips;
    if (!detector.enabled) return;

    await this.underLock(detector.code, 'discovery', () =>
      this.engine.discover(
        detector,
        (window, cursor, cid) =>
          this.backend.unassignedTrips(
            { before: window.before, after: window.after, limit: this.settings.readModelPageSize, cursor },
            cid,
          ),
        correlationId,
      ),
    );

    await this.underLock(detector.code, 'resolution', () =>
      this.engine.resolve(
        detector,
        async (ids, cid) => (await this.backend.lookup({ tripIds: ids }, cid)).trips,
        correlationId,
      ),
    );
  }

  private async runStaleStarts(correlationId: string): Promise<void> {
    const detector = this.staleStarts;
    if (!detector.enabled) return;

    await this.underLock(detector.code, 'discovery', () =>
      this.engine.discover(
        detector,
        (window, cursor, cid) =>
          this.backend.unstartedAssignments(
            { before: window.before, after: window.after, limit: this.settings.readModelPageSize, cursor },
            cid,
          ),
        correlationId,
      ),
    );

    await this.underLock(detector.code, 'resolution', () =>
      this.engine.resolve(
        detector,
        async (ids, cid) => (await this.backend.lookup({ assignmentIds: ids }, cid)).assignments,
        correlationId,
      ),
    );
  }

  private async runCompletionReviews(correlationId: string): Promise<void> {
    const detector = this.completionReviews;
    if (!detector.enabled) return;

    await this.underLock(detector.code, 'discovery', () =>
      this.engine.discover(
        detector,
        (window, cursor, cid) =>
          this.backend.pendingCompletions(
            { before: window.before, after: window.after, limit: this.settings.readModelPageSize, cursor },
            cid,
          ),
        correlationId,
      ),
    );

    await this.underLock(detector.code, 'resolution', () =>
      this.engine.resolve(
        detector,
        async (ids, cid) => (await this.backend.lookup({ completionRequestIds: ids }, cid)).completionRequests,
        correlationId,
      ),
    );
  }

  /** Runs `work` only if this worker holds the lock, and always releases it. */
  private async underLock(detectorCode: string, phase: string, work: () => Promise<unknown>): Promise<void> {
    const handle = await this.lock.acquire(detectorCode, phase);
    if (!handle) {
      this.logger.debug(`${detectorCode}/${phase} is already running on another worker — skipping this tick.`);
      return;
    }
    try {
      await work();
    } finally {
      await handle.release();
    }
  }

  /** Why the scheduler is not armed, or `null` when it is. */
  private disarmedReason(): string | null {
    if (this.config.scanIntervalMs === undefined) {
      return 'SCAN_INTERVAL is not set. How often to scan has not been decided, and this service will not pick a value.';
    }
    if (!this.backend.configured) {
      return 'BACKEND_INTERNAL_URL or SERVICE_TOKEN_AI_TO_BACKEND is not set, so there is nowhere to read canonical facts from.';
    }
    if (![this.unassignedTrips, this.staleStarts, this.completionReviews].some((d) => d.enabled)) {
      return 'every detector is disabled.';
    }
    return null;
  }

  private reportDisabledDetectors(): void {
    for (const detector of [this.unassignedTrips, this.staleStarts, this.completionReviews]) {
      if (!detector.enabled) this.logger.warn(`Detector ${detector.code} is DISABLED: ${detector.disabledReason}`);
    }
  }
}
