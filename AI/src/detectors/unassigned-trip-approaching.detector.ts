import { Injectable } from '@nestjs/common';
import { DetectorSettings } from '../config/detector-settings';
import { toSeconds } from '../config/duration';
import { EVIDENCE_VERSION, type AlertSignal, type AlertSeverity } from '../core/alert/domain/alert';
import type { CandidateWindow, Detector } from '../core/detector/detector.contract';
import type { TripFacts } from '../infrastructure/backend-client/read-model.types';

/**
 * D1 — a trip is about to need a lorry and has none.
 *
 * ★ `pickup_at` AND NOTHING ELSE (CEO, 2026-09-19). A trip that names no
 * pickup instant is not in this detector's scope at all: `scheduled_on` is a
 * calendar day, and turning a day into an instant would invent a deadline
 * nobody set. The backend's read model already omits those rows; this rule
 * refuses them again, because a detector that depends on its caller having
 * filtered correctly is a detector with an implicit precondition.
 *
 * ★ "UNASSIGNED" IS `activeAssignmentCount === 0`, which is the backend's
 * canonical fact from `trip_driver_assignments (state = 'active')`. The
 * legacy `trip_schedules.vehicle_id` is not dispatch ownership and is not
 * consulted (ADR-0004).
 *
 * ★ SEVERITY. The warning band is the approved two hours. There is NO
 * approved HIGH band, so a trip whose pickup has already passed and still has
 * no lorry stays `warning` — louder than the facts justify is as wrong as
 * quieter. When a HIGH lead is configured, it applies the same way: remaining
 * time at or below it is `high`.
 */
export const UNASSIGNED_TRIP_DETECTOR_CODE = 'UNASSIGNED_TRIP_APPROACHING_EXECUTION';

@Injectable()
export class UnassignedTripApproachingDetector implements Detector<TripFacts> {
  readonly code = UNASSIGNED_TRIP_DETECTOR_CODE;
  readonly version = 1;
  readonly subjectType = 'trip' as const;

  constructor(private readonly settings: DetectorSettings) {}

  /** Always enabled: its only threshold is approved. */
  get enabled(): boolean {
    return true;
  }

  get disabledReason(): string | null {
    return null;
  }

  /**
   * TWO BANDS, APPROACHING FIRST — and this is the fix for a liveness bug,
   * not a change of rule.
   *
   * Every pickup already past stays a candidate: a trip that went unassigned
   * yesterday is still unassigned today, and nobody has approved a cutoff.
   * But those accumulate at the HEAD of an ascending walk, so a large enough
   * overdue backlog would consume the whole page budget every single run and
   * a trip leaving in ninety minutes would never be looked at. The alert that
   * matters most would be the one that never fires.
   *
   * So the scan walks `[now, now + lead]` first — the trips somebody can
   * still do something about — and only then `(-inf, now)`. The predicate is
   * untouched; what changed is the order a bounded scan spends its budget in.
   *
   * ★ `pickup_at == now` IS IN THE FIRST BAND. A trip due this very instant
   * is the most urgent thing this detector can see, and putting it at the
   * head of the overdue band would let a large backlog starve exactly the
   * candidate the ordering exists to protect. So the cut at `now` is closed
   * on the approaching side and open on the overdue one: the two bands
   * partition the line exactly, every pickup is in one of them, none is in
   * both, and no instant had to be nudged to say so.
   */
  candidateWindows(now: Date): CandidateWindow[] {
    return [
      {
        label: 'approaching',
        after: now,
        afterInclusive: true,
        before: new Date(now.getTime() + this.settings.unassignedTripWarningLeadMs),
      },
      { label: 'overdue', before: now, beforeInclusive: false },
    ];
  }

  subjectIdOf(facts: TripFacts): string {
    return facts.tripId;
  }

  evaluate(facts: TripFacts, now: Date): AlertSignal | null {
    if (facts.archived) return null;
    if (facts.status === 'finished') return null;
    if (facts.pickupAt === null) return null;
    if (facts.activeAssignmentCount > 0) return null;

    const remainingMs = facts.pickupAt.getTime() - now.getTime();
    const warningLeadMs = this.settings.unassignedTripWarningLeadMs;
    // `<=` so exactly two hours out is already a warning: the boundary
    // belongs to the alert, not to the silence before it.
    if (remainingMs > warningLeadMs) return null;

    const highLeadMs = this.settings.unassignedTripHighLeadMs;
    const severity: AlertSeverity = highLeadMs !== null && remainingMs <= highLeadMs ? 'high' : 'warning';

    return {
      detectorCode: this.code,
      detectorVersion: this.version,
      sourceType: 'rule',
      subjectType: this.subjectType,
      subjectId: facts.tripId,
      tripId: facts.tripId,
      severity,
      title: 'Chuyến chưa có xe',
      summary: summaryFor(remainingMs, facts),
      evidence: {
        evidenceVersion: EVIDENCE_VERSION,
        tripId: facts.tripId,
        scheduledOn: facts.scheduledOn,
        pickupAt: facts.pickupAt.toISOString(),
        tripStatus: facts.status,
        activeAssignmentCount: facts.activeAssignmentCount,
        remainingSeconds: toSeconds(remainingMs),
        warningLeadSeconds: toSeconds(warningLeadMs),
        highLeadSeconds: highLeadMs === null ? null : toSeconds(highLeadMs),
        observedAt: now.toISOString(),
      },
    };
  }
}

/** Vietnamese, because a dispatcher reads it. Facts only — no advice. */
function summaryFor(remainingMs: number, facts: TripFacts): string {
  const customer = facts.customer ? ` · ${facts.customer.name}` : '';
  if (remainingMs < 0) {
    const late = Math.round(-remainingMs / 60_000);
    return `Đã qua giờ lấy hàng ${late} phút mà chưa có xe nào được điều${customer}.`;
  }
  const minutes = Math.round(remainingMs / 60_000);
  return `Còn ${minutes} phút tới giờ lấy hàng và chưa có xe nào được điều${customer}.`;
}
