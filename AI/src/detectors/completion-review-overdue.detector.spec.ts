import type { AppConfig } from '../config/app.config';
import { DetectorSettings } from '../config/detector-settings';
import type { CompletionRequestFacts, TripFacts } from '../infrastructure/backend-client/read-model.types';
import { CompletionReviewOverdueDetector } from './completion-review-overdue.detector';

/** D3's twelve-hour boundary, to the millisecond. */
describe('COMPLETION_REVIEW_OVERDUE', () => {
  const NOW = new Date('2026-09-24T08:00:00.000Z');
  const HOUR = 3_600_000;
  const REQUEST = '66666666-6666-4666-8666-666666666666';
  const TRIP = '11111111-1111-4111-8111-111111111111';

  const detectorWith = (over: Partial<AppConfig> = {}) =>
    new CompletionReviewOverdueDetector(
      new DetectorSettings({
        unassignedTripWarningLeadMs: 2 * HOUR,
        unassignedTripHighLeadMs: null,
        staleStartGraceMs: null,
        staleStartHighMs: null,
        completionReviewWarningAfterMs: 12 * HOUR,
        completionReviewHighAfterMs: null,
        readModelPageSize: 100,
        resolutionBatchSize: 100,
        ...over,
      } as unknown as AppConfig),
    );

  const trip = (over: Partial<TripFacts> = {}): TripFacts => ({
    tripId: TRIP,
    scheduledOn: '2026-09-23',
    pickupAt: new Date(NOW.getTime() - 24 * HOUR),
    deliveryAt: null,
    status: 'executing',
    archived: false,
    activeAssignmentCount: 1,
    customer: null,
    ...over,
  });

  const request = (over: Partial<CompletionRequestFacts> = {}, tripOver: Partial<TripFacts> = {}): CompletionRequestFacts => ({
    requestId: REQUEST,
    assignmentId: '33333333-3333-4333-8333-333333333333',
    tripId: TRIP,
    attemptNo: 1,
    state: 'pending',
    submittedAt: new Date(NOW.getTime() - 13 * HOUR),
    decidedAt: null,
    trip: trip(tripOver),
    ...over,
  });

  /** Submitted so that exactly `ms` have elapsed at NOW. */
  const elapsed = (ms: number, over: Partial<CompletionRequestFacts> = {}): CompletionRequestFacts =>
    request({ submittedAt: new Date(NOW.getTime() - ms), ...over });

  it('is always enabled — its only threshold is approved', () => {
    expect(detectorWith().enabled).toBe(true);
    expect(detectorWith().disabledReason).toBeNull();
    expect(detectorWith().code).toBe('COMPLETION_REVIEW_OVERDUE');
    expect(detectorWith().subjectType).toBe('completion_request');
  });

  describe('the twelve-hour boundary', () => {
    it('11:59:59.999 elapsed: no alert', () => {
      expect(detectorWith().evaluate(elapsed(12 * HOUR - 1), NOW)).toBeNull();
    });

    it('EXACTLY twelve hours elapsed: warning', () => {
      expect(detectorWith().evaluate(elapsed(12 * HOUR), NOW)?.severity).toBe('warning');
    });

    it('beyond twelve hours: warning', () => {
      expect(detectorWith().evaluate(elapsed(40 * HOUR), NOW)?.severity).toBe('warning');
    });

    it('a shorter configured window moves the boundary with it', () => {
      const detector = detectorWith({ completionReviewWarningAfterMs: HOUR } as Partial<AppConfig>);
      expect(detector.evaluate(elapsed(HOUR), NOW)?.severity).toBe('warning');
      expect(detector.evaluate(elapsed(HOUR - 1), NOW)).toBeNull();
    });

    it('raises HIGH only when a high threshold is configured', () => {
      const detector = detectorWith({ completionReviewHighAfterMs: 24 * HOUR } as Partial<AppConfig>);
      expect(detector.evaluate(elapsed(24 * HOUR - 1), NOW)?.severity).toBe('warning');
      expect(detector.evaluate(elapsed(24 * HOUR), NOW)?.severity).toBe('high');
      // Without one, even a week stays warning.
      expect(detectorWith().evaluate(elapsed(7 * 24 * HOUR), NOW)?.severity).toBe('warning');
    });

    it('★ counts elapsed time, not working hours — a night counts', () => {
      const overnight = new Date('2026-09-24T02:00:00.000Z');
      const submitted = elapsed(12 * HOUR, {});
      expect(detectorWith().evaluate(submitted, NOW)).not.toBeNull();
      // Same facts, two hours earlier: not yet overdue.
      expect(detectorWith().evaluate(submitted, overnight)).toBeNull();
    });
  });

  describe('exclusions', () => {
    it.each(['approved', 'rejected'] as const)('a %s request is not a subject — somebody looked', (state) => {
      expect(detectorWith().evaluate(elapsed(40 * HOUR, { state, decidedAt: NOW }), NOW)).toBeNull();
    });

    it('a request on an archived trip is not a subject', () => {
      expect(detectorWith().evaluate(request({}, { archived: true }), NOW)).toBeNull();
    });

    it('a request on a FINISHED trip is still a subject — a pending review on a closed trip is exactly the problem', () => {
      expect(detectorWith().evaluate(request({}, { status: 'finished' }), NOW)).not.toBeNull();
    });
  });

  describe('the signal', () => {
    it('names the request as subject and carries the trip', () => {
      const signal = detectorWith().evaluate(elapsed(13 * HOUR), NOW);
      expect(signal).toMatchObject({
        detectorCode: 'COMPLETION_REVIEW_OVERDUE',
        detectorVersion: 1,
        sourceType: 'rule',
        subjectType: 'completion_request',
        subjectId: REQUEST,
        tripId: TRIP,
      });
      expect(signal?.confidence).toBeUndefined();
    });

    it('carries the facts that explain it, and the threshold in force', () => {
      const signal = detectorWith().evaluate(elapsed(13 * HOUR), NOW);
      expect(signal?.evidence).toEqual({
        evidenceVersion: 1,
        completionRequestId: REQUEST,
        assignmentId: '33333333-3333-4333-8333-333333333333',
        tripId: TRIP,
        attemptNo: 1,
        submittedAt: new Date(NOW.getTime() - 13 * HOUR).toISOString(),
        elapsedSeconds: 13 * 3600,
        warningThresholdSeconds: 12 * 3600,
        highThresholdSeconds: null,
        observedAt: NOW.toISOString(),
      });
    });

    it('mentions the attempt number when this is a resubmission', () => {
      const signal = detectorWith().evaluate(elapsed(13 * HOUR, { attemptNo: 3 }), NOW);
      expect(signal?.summary).toContain('lần gửi thứ 3');
    });
  });

  describe('the candidate window', () => {
    it('asks for submissions at or before now minus the warning window', () => {
      const windows = detectorWith().candidateWindows(NOW);
      expect(windows).toHaveLength(1);
      expect(windows[0]!.before.toISOString()).toBe(new Date(NOW.getTime() - 12 * HOUR).toISOString());
      expect(windows[0]!.after).toBeUndefined();
    });
  });

  it('reads the subject id off the facts', () => {
    expect(detectorWith().subjectIdOf(request())).toBe(REQUEST);
  });
});
