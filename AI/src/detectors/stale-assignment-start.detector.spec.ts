import type { AppConfig } from '../config/app.config';
import { DetectorSettings } from '../config/detector-settings';
import type { AssignmentFacts, CompletionState, TripFacts } from '../infrastructure/backend-client/read-model.types';
import { StaleAssignmentStartDetector } from './stale-assignment-start.detector';

/**
 * D2's predicates and exclusions — and, above all, what it does when nobody
 * has decided its grace period.
 */
describe('STALE_ASSIGNMENT_START', () => {
  const NOW = new Date('2026-09-24T08:00:00.000Z');
  const HOUR = 3_600_000;
  const ASSIGNMENT = '33333333-3333-4333-8333-333333333333';
  const TRIP = '11111111-1111-4111-8111-111111111111';

  const detectorWith = (over: Partial<AppConfig> = {}) =>
    new StaleAssignmentStartDetector(
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

  /** A detector with a 30-minute grace, which is a TEST value, not an approved one. */
  const withGrace = (graceMs = 30 * 60_000, over: Partial<AppConfig> = {}) =>
    detectorWith({ staleStartGraceMs: graceMs, ...over } as Partial<AppConfig>);

  const tripFacts = (over: Partial<TripFacts> = {}): TripFacts => ({
    tripId: TRIP,
    scheduledOn: '2026-09-24',
    pickupAt: new Date(NOW.getTime() - HOUR),
    deliveryAt: null,
    status: 'executing',
    archived: false,
    activeAssignmentCount: 1,
    customer: null,
    ...over,
  });

  const assignment = (over: Partial<AssignmentFacts> = {}, tripOver: Partial<TripFacts> = {}): AssignmentFacts => ({
    assignmentId: ASSIGNMENT,
    tripId: TRIP,
    driverUserId: '44444444-4444-4444-8444-444444444444',
    vehicleId: '55555555-5555-4555-8555-555555555555',
    vehiclePlate: '51C-000.01',
    state: 'active',
    assignedAt: new Date(NOW.getTime() - 48 * HOUR),
    endedAt: null,
    hasLiveEvents: false,
    latestCompletionState: 'none',
    trip: tripFacts(tripOver),
    ...over,
  });

  /** Facts where exactly `ms` have elapsed since pickup at NOW. */
  const elapsed = (ms: number, over: Partial<AssignmentFacts> = {}): AssignmentFacts =>
    assignment(over, { pickupAt: new Date(NOW.getTime() - ms) });

  describe('★ with no approved grace', () => {
    it('is DISABLED, and says why', () => {
      const detector = detectorWith();
      expect(detector.enabled).toBe(false);
      expect(detector.disabledReason).toMatch(/DETECTOR_STALE_START_GRACE is not set/);
      expect(detector.disabledReason).toMatch(/zero grace is not a default/);
    });

    it('reports NOTHING, however stale the assignment looks', () => {
      const detector = detectorWith();
      expect(detector.evaluate(elapsed(0), NOW)).toBeNull();
      expect(detector.evaluate(elapsed(HOUR), NOW)).toBeNull();
      expect(detector.evaluate(elapsed(30 * 24 * HOUR), NOW)).toBeNull();
    });
  });

  describe('with a configured grace', () => {
    it('is enabled', () => {
      expect(withGrace().enabled).toBe(true);
      expect(withGrace().disabledReason).toBeNull();
    });

    it('one millisecond before the grace: no alert', () => {
      expect(withGrace(30 * 60_000).evaluate(elapsed(30 * 60_000 - 1), NOW)).toBeNull();
    });

    it('EXACTLY at the grace: warning', () => {
      expect(withGrace(30 * 60_000).evaluate(elapsed(30 * 60_000), NOW)?.severity).toBe('warning');
    });

    it('past the grace: warning', () => {
      expect(withGrace(30 * 60_000).evaluate(elapsed(5 * HOUR), NOW)?.severity).toBe('warning');
    });

    it('before pickup at all: no alert', () => {
      expect(withGrace().evaluate(elapsed(-HOUR), NOW)).toBeNull();
    });

    it('raises HIGH only when a high threshold is configured', () => {
      const detector = withGrace(30 * 60_000, { staleStartHighMs: 2 * HOUR } as Partial<AppConfig>);
      expect(detector.evaluate(elapsed(2 * HOUR - 1), NOW)?.severity).toBe('warning');
      expect(detector.evaluate(elapsed(2 * HOUR), NOW)?.severity).toBe('high');
      expect(withGrace(30 * 60_000).evaluate(elapsed(100 * HOUR), NOW)?.severity).toBe('warning');
    });
  });

  describe('exclusions', () => {
    it('an ended assignment is not a subject', () => {
      expect(withGrace().evaluate(elapsed(HOUR, { state: 'ended' }), NOW)).toBeNull();
    });

    it('★ an assignment that HAS a live execution event has started, so it is not stale', () => {
      expect(withGrace().evaluate(elapsed(HOUR, { hasLiveEvents: true }), NOW)).toBeNull();
    });

    it.each(['pending', 'approved'] as const)('a %s completion excludes the assignment', (state) => {
      expect(withGrace().evaluate(elapsed(HOUR, { latestCompletionState: state }), NOW)).toBeNull();
    });

    it('★ a REJECTED completion does NOT exclude — the work is still outstanding', () => {
      const signal = withGrace().evaluate(elapsed(HOUR, { latestCompletionState: 'rejected' }), NOW);
      expect(signal).not.toBeNull();
      expect(signal?.evidence['latestCompletionState']).toBe('rejected');
      expect(signal?.summary).toContain('từ chối');
    });

    it.each(['none', 'rejected'] as CompletionState[])('a %s completion leaves it a subject', (state) => {
      expect(withGrace().evaluate(elapsed(HOUR, { latestCompletionState: state }), NOW)).not.toBeNull();
    });

    it('an archived or finished trip excludes the assignment', () => {
      const archived = assignment({}, { archived: true, pickupAt: new Date(NOW.getTime() - HOUR) });
      const finished = assignment({}, { status: 'finished', pickupAt: new Date(NOW.getTime() - HOUR) });
      expect(withGrace().evaluate(archived, NOW)).toBeNull();
      expect(withGrace().evaluate(finished, NOW)).toBeNull();
    });

    it('a trip with no pickup instant excludes the assignment — pickup is the anchor', () => {
      expect(withGrace().evaluate(assignment({}, { pickupAt: null }), NOW)).toBeNull();
    });

    it('★ `assigned_at` is not the anchor: assigned days ago but pickup not yet due is not stale', () => {
      const notYetDue = assignment(
        { assignedAt: new Date(NOW.getTime() - 30 * 24 * HOUR) },
        { pickupAt: new Date(NOW.getTime() + HOUR) },
      );
      expect(withGrace().evaluate(notYetDue, NOW)).toBeNull();
    });
  });

  describe('the signal', () => {
    it('names the assignment as subject and carries the trip', () => {
      const signal = withGrace().evaluate(elapsed(HOUR), NOW);
      expect(signal).toMatchObject({
        detectorCode: 'STALE_ASSIGNMENT_START',
        detectorVersion: 1,
        sourceType: 'rule',
        subjectType: 'assignment',
        subjectId: ASSIGNMENT,
        tripId: TRIP,
      });
      expect(signal?.confidence).toBeUndefined();
    });

    it('carries the facts that explain it, and the grace in force', () => {
      const signal = withGrace(30 * 60_000).evaluate(elapsed(HOUR), NOW);
      expect(signal?.evidence).toMatchObject({
        evidenceVersion: 1,
        assignmentId: ASSIGNMENT,
        tripId: TRIP,
        hasLiveExecutionEvent: false,
        latestCompletionState: 'none',
        elapsedSincePickupSeconds: 3600,
        configuredGraceSeconds: 1800,
        highAfterSeconds: null,
        observedAt: NOW.toISOString(),
      });
    });
  });

  describe('the candidate window', () => {
    it('asks for pickups at or before now minus the grace', () => {
      const windows = withGrace(30 * 60_000).candidateWindows(NOW);
      expect(windows).toHaveLength(1);
      expect(windows[0]!.before.toISOString()).toBe(new Date(NOW.getTime() - 30 * 60_000).toISOString());
    });

    it('is total even when disabled, so the shape never depends on configuration', () => {
      expect(detectorWith().candidateWindows(NOW)[0]!.before.toISOString()).toBe(NOW.toISOString());
    });
  });

  it('reads the subject id off the facts', () => {
    expect(withGrace().subjectIdOf(assignment())).toBe(ASSIGNMENT);
  });
});
