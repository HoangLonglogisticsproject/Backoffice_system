import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/time/clock';
import { DetectorSettings } from '../../config/detector-settings';
import { AlertModule } from '../../core/alert/alert.module';
import { ScanEngineService } from '../../core/detector/scan-engine.service';
import { CompletionReviewOverdueDetector } from '../../detectors/completion-review-overdue.detector';
import { StaleAssignmentStartDetector } from '../../detectors/stale-assignment-start.detector';
import { UnassignedTripApproachingDetector } from '../../detectors/unassigned-trip-approaching.detector';
import { BackendReadModelClient } from '../backend-client/backend-read-model.client';
import { ScanLock } from './scan-lock';
import { ScanSchedulerService } from './scan-scheduler.service';

/**
 * The scan engine: detectors, the client that feeds them, the lock that keeps
 * two workers apart, and the timer that starts it all.
 *
 * Wired even when nothing is configured — the scheduler decides at boot
 * whether to arm, and says why when it does not. A module that disappeared
 * with its configuration would make "is scanning on?" unanswerable from the
 * logs.
 */
@Module({
  imports: [AlertModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    DetectorSettings,
    BackendReadModelClient,
    ScanEngineService,
    ScanLock,
    UnassignedTripApproachingDetector,
    StaleAssignmentStartDetector,
    CompletionReviewOverdueDetector,
    ScanSchedulerService,
  ],
  exports: [ScanEngineService, DetectorSettings],
})
export class SchedulerModule {}
