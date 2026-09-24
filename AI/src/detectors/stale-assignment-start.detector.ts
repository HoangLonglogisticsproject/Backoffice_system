import { Injectable } from '@nestjs/common';
import { DetectorSettings } from '../config/detector-settings';
import { toSeconds } from '../config/duration';
import { EVIDENCE_VERSION, type AlertSeverity, type AlertSignal } from '../core/alert/domain/alert';
import type { CandidateWindow, Detector } from '../core/detector/detector.contract';
import type { AssignmentFacts } from '../infrastructure/backend-client/read-model.types';

/**
 * D2 — a lorry was dispatched, the pickup time has come, and nobody has
 * reported anything.
 *
 * ★ DISABLED UNTIL A GRACE IS APPROVED, AND THAT IS THE POINT. The rule is
 * "how long after pickup is too long", and nobody has decided. Running it
 * with a zero grace would alert on every assignment the instant its pickup
 * passed — a business decision taken by default, which is the one thing this
 * codebase refuses to do. `staleStartGraceMs === null` therefore means the
 * detector reports nothing and resolves nothing; it does not mean zero.
 *
 * ★ `pickup_at` IS THE ANCHOR, NOT `assigned_at` (CEO). Dispatch often
 * assigns days ahead; time since assignment says nothing about whether a
 * driver is late.
 *
 * ★ "STARTED" IS ONE LIVE EXECUTION EVENT, and it is the BACKEND's own
 * predicate arriving as `hasLiveEvents` (ADR-0004). This side never
 * re-derives it.
 *
 * ★ COMPLETION EXCLUSION: `pending` or `approved` means the turn is being
 * reviewed or is done — not stale. `rejected` does NOT exclude: a rejected
 * completion leaves the work outstanding, and that is exactly when somebody
 * should be looking.
 */
export const STALE_ASSIGNMENT_DETECTOR_CODE = 'STALE_ASSIGNMENT_START';

@Injectable()
export class StaleAssignmentStartDetector implements Detector<AssignmentFacts> {
  readonly code = STALE_ASSIGNMENT_DETECTOR_CODE;
  readonly version = 1;
  readonly subjectType = 'assignment' as const;

  constructor(private readonly settings: DetectorSettings) {}

  get enabled(): boolean {
    return this.settings.staleStartGraceMs !== null;
  }

  get disabledReason(): string | null {
    return this.enabled
      ? null
      : 'DETECTOR_STALE_START_GRACE is not set. How long after pickup an unstarted assignment is a problem ' +
          'has not been decided, and this detector will not guess one (a zero grace is not a default).';
  }

  /**
   * One band: everything whose pickup is at or before `now - grace`. There is
   * nothing to prioritise — every candidate here is already past its grace,
   * and ascending order means the longest-overdue is looked at first.
   *
   * A disabled detector is never asked for a window, but the shape is total
   * anyway: a zero-length window is the honest answer to "no configuration".
   */
  candidateWindows(now: Date): CandidateWindow[] {
    const graceMs = this.settings.staleStartGraceMs ?? 0;
    return [{ label: 'overdue', before: new Date(now.getTime() - graceMs) }];
  }

  subjectIdOf(facts: AssignmentFacts): string {
    return facts.assignmentId;
  }

  evaluate(facts: AssignmentFacts, now: Date): AlertSignal | null {
    const graceMs = this.settings.staleStartGraceMs;
    if (graceMs === null) return null;

    if (facts.state !== 'active') return null;
    if (facts.trip.archived) return null;
    if (facts.trip.status === 'finished') return null;
    if (facts.trip.pickupAt === null) return null;
    if (facts.hasLiveEvents) return null;
    if (facts.latestCompletionState === 'pending' || facts.latestCompletionState === 'approved') return null;

    const elapsedMs = now.getTime() - facts.trip.pickupAt.getTime();
    if (elapsedMs < graceMs) return null;

    const highMs = this.settings.staleStartHighMs;
    const severity: AlertSeverity = highMs !== null && elapsedMs >= highMs ? 'high' : 'warning';

    return {
      detectorCode: this.code,
      detectorVersion: this.version,
      sourceType: 'rule',
      subjectType: this.subjectType,
      subjectId: facts.assignmentId,
      tripId: facts.tripId,
      severity,
      title: 'Xe đã điều nhưng chưa khởi hành',
      summary: summaryFor(elapsedMs, facts),
      evidence: {
        evidenceVersion: EVIDENCE_VERSION,
        assignmentId: facts.assignmentId,
        tripId: facts.tripId,
        driverUserId: facts.driverUserId,
        vehicleId: facts.vehicleId,
        pickupAt: facts.trip.pickupAt.toISOString(),
        assignedAt: facts.assignedAt.toISOString(),
        hasLiveExecutionEvent: facts.hasLiveEvents,
        latestCompletionState: facts.latestCompletionState,
        elapsedSincePickupSeconds: toSeconds(elapsedMs),
        configuredGraceSeconds: toSeconds(graceMs),
        highAfterSeconds: highMs === null ? null : toSeconds(highMs),
        observedAt: now.toISOString(),
      },
    };
  }
}

function summaryFor(elapsedMs: number, facts: AssignmentFacts): string {
  const minutes = Math.round(elapsedMs / 60_000);
  const plate = facts.vehiclePlate ? ` (${facts.vehiclePlate})` : '';
  const rejected = facts.latestCompletionState === 'rejected' ? ' Lần báo hoàn tất gần nhất đã bị từ chối.' : '';
  return `Đã qua giờ lấy hàng ${minutes} phút mà xe${plate} chưa báo mốc thực hiện nào.${rejected}`;
}
