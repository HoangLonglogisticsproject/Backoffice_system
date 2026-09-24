import { Injectable } from '@nestjs/common';
import { DetectorSettings } from '../config/detector-settings';
import { toSeconds } from '../config/duration';
import { EVIDENCE_VERSION, type AlertSeverity, type AlertSignal } from '../core/alert/domain/alert';
import type { CandidateWindow, Detector } from '../core/detector/detector.contract';
import type { CompletionRequestFacts } from '../infrastructure/backend-client/read-model.types';

/**
 * D3 — a driver submitted a completion and nobody has looked at it.
 *
 * ★ `submitted_at` IS THE ANCHOR, and it is canonical: the column is NOT NULL
 * with `DEFAULT now()` and no statement ever updates it (backend 0017).
 *
 * ★ ELAPSED TIME, NOT WORKING HOURS (CEO). Twelve hours across a night is
 * twelve hours; a business-hours calendar is a second set of rules nobody has
 * agreed, and the difference would show up as alerts that arrive at
 * surprising times rather than as a better queue.
 *
 * ★ ONLY A PENDING REQUEST IS A SUBJECT. Approved or rejected means somebody
 * looked — the review happened, whatever its outcome — so the condition is
 * clear and Resolution closes the incident.
 */
export const COMPLETION_REVIEW_DETECTOR_CODE = 'COMPLETION_REVIEW_OVERDUE';

@Injectable()
export class CompletionReviewOverdueDetector implements Detector<CompletionRequestFacts> {
  readonly code = COMPLETION_REVIEW_DETECTOR_CODE;
  readonly version = 1;
  readonly subjectType = 'completion_request' as const;

  constructor(private readonly settings: DetectorSettings) {}

  /** Always enabled: its only threshold is approved. */
  get enabled(): boolean {
    return true;
  }

  get disabledReason(): string | null {
    return null;
  }

  /**
   * One band: everything submitted at or before `now - warningAfter`. Oldest
   * submission first, which is the order a review queue is worked in anyway.
   */
  candidateWindows(now: Date): CandidateWindow[] {
    return [{ label: 'overdue', before: new Date(now.getTime() - this.settings.completionReviewWarningAfterMs) }];
  }

  subjectIdOf(facts: CompletionRequestFacts): string {
    return facts.requestId;
  }

  evaluate(facts: CompletionRequestFacts, now: Date): AlertSignal | null {
    if (facts.state !== 'pending') return null;
    if (facts.trip.archived) return null;

    const elapsedMs = now.getTime() - facts.submittedAt.getTime();
    const warningMs = this.settings.completionReviewWarningAfterMs;
    // `>=`: at exactly twelve hours it is overdue. 11:59:59 is not.
    if (elapsedMs < warningMs) return null;

    const highMs = this.settings.completionReviewHighAfterMs;
    const severity: AlertSeverity = highMs !== null && elapsedMs >= highMs ? 'high' : 'warning';

    return {
      detectorCode: this.code,
      detectorVersion: this.version,
      sourceType: 'rule',
      subjectType: this.subjectType,
      subjectId: facts.requestId,
      tripId: facts.tripId,
      severity,
      title: 'Yêu cầu hoàn tất chờ duyệt quá lâu',
      summary: summaryFor(elapsedMs, facts),
      evidence: {
        evidenceVersion: EVIDENCE_VERSION,
        completionRequestId: facts.requestId,
        assignmentId: facts.assignmentId,
        tripId: facts.tripId,
        attemptNo: facts.attemptNo,
        submittedAt: facts.submittedAt.toISOString(),
        elapsedSeconds: toSeconds(elapsedMs),
        warningThresholdSeconds: toSeconds(warningMs),
        highThresholdSeconds: highMs === null ? null : toSeconds(highMs),
        observedAt: now.toISOString(),
      },
    };
  }
}

function summaryFor(elapsedMs: number, facts: CompletionRequestFacts): string {
  const hours = Math.floor(elapsedMs / 3_600_000);
  const attempt = facts.attemptNo > 1 ? ` (lần gửi thứ ${facts.attemptNo})` : '';
  return `Tài xế đã gửi yêu cầu hoàn tất${attempt} ${hours} giờ trước và chưa được duyệt hay từ chối.`;
}
