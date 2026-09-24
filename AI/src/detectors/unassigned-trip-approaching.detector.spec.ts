import { DetectorSettings } from '../config/detector-settings';
import type { AppConfig } from '../config/app.config';
import type { TripFacts } from '../infrastructure/backend-client/read-model.types';
import { UnassignedTripApproachingDetector } from './unassigned-trip-approaching.detector';

/**
 * D1's boundaries, to the second. The rule is a comparison against `now`, so
 * `now` is a value here and never a wall clock.
 */
describe('UNASSIGNED_TRIP_APPROACHING_EXECUTION', () => {
  const NOW = new Date('2026-09-24T08:00:00.000Z');
  const HOUR = 3_600_000;
  const TRIP = '11111111-1111-4111-8111-111111111111';

  const detectorWith = (over: Partial<AppConfig> = {}) =>
    new UnassignedTripApproachingDetector(
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
    scheduledOn: '2026-09-24',
    pickupAt: new Date(NOW.getTime() + HOUR),
    deliveryAt: null,
    status: 'confirmed',
    archived: false,
    activeAssignmentCount: 0,
    customer: { id: '22222222-2222-4222-8222-222222222222', name: 'A Customer' },
    ...over,
  });

  /** `pickupAt` set so that exactly `ms` remain at NOW. */
  const remaining = (ms: number): TripFacts => trip({ pickupAt: new Date(NOW.getTime() + ms) });

  it('is always enabled — its only threshold is approved', () => {
    const detector = detectorWith();
    expect(detector.enabled).toBe(true);
    expect(detector.disabledReason).toBeNull();
    expect(detector.code).toBe('UNASSIGNED_TRIP_APPROACHING_EXECUTION');
    expect(detector.version).toBe(1);
    expect(detector.subjectType).toBe('trip');
  });

  describe('the two-hour boundary', () => {
    it('two hours and one millisecond out: no alert', () => {
      expect(detectorWith().evaluate(remaining(2 * HOUR + 1), NOW)).toBeNull();
    });

    it('EXACTLY two hours out: warning', () => {
      const signal = detectorWith().evaluate(remaining(2 * HOUR), NOW);
      expect(signal?.severity).toBe('warning');
    });

    it('one millisecond inside two hours: warning', () => {
      expect(detectorWith().evaluate(remaining(2 * HOUR - 1), NOW)?.severity).toBe('warning');
    });

    it('well inside the window: warning', () => {
      expect(detectorWith().evaluate(remaining(30 * 60_000), NOW)?.severity).toBe('warning');
    });

    it('a much longer configured lead moves the boundary with it', () => {
      const detector = detectorWith({ unassignedTripWarningLeadMs: 6 * HOUR } as Partial<AppConfig>);
      expect(detector.evaluate(remaining(5 * HOUR), NOW)?.severity).toBe('warning');
      expect(detector.evaluate(remaining(6 * HOUR + 1), NOW)).toBeNull();
    });
  });

  describe('past pickup', () => {
    it('still alerts, and stays WARNING because no high band is approved', () => {
      const signal = detectorWith().evaluate(remaining(-5 * HOUR), NOW);
      expect(signal?.severity).toBe('warning');
      expect(signal?.evidence['remainingSeconds']).toBe(-5 * 3600);
    });

    it('raises HIGH only when a high lead has been configured', () => {
      const detector = detectorWith({ unassignedTripHighLeadMs: 0 } as Partial<AppConfig>);
      expect(detector.evaluate(remaining(-1), NOW)?.severity).toBe('high');
      expect(detector.evaluate(remaining(0), NOW)?.severity).toBe('high');
      expect(detector.evaluate(remaining(60_000), NOW)?.severity).toBe('warning');
    });
  });

  describe('exclusions', () => {
    it('a trip with an active assignment is not a subject', () => {
      expect(detectorWith().evaluate(trip({ activeAssignmentCount: 1 }), NOW)).toBeNull();
    });

    it('an archived trip is not a subject', () => {
      expect(detectorWith().evaluate(trip({ archived: true }), NOW)).toBeNull();
    });

    it('a finished trip is not a subject', () => {
      expect(detectorWith().evaluate(trip({ status: 'finished' }), NOW)).toBeNull();
    });

    it.each(['pending', 'confirmed', 'executing'] as const)('a %s trip IS a subject', (status) => {
      expect(detectorWith().evaluate(trip({ status }), NOW)).not.toBeNull();
    });

    it('★ a trip with no pickup instant is never a subject — no scheduled_on fallback', () => {
      expect(detectorWith().evaluate(trip({ pickupAt: null }), NOW)).toBeNull();
      // Even with a scheduled day that is long past.
      expect(detectorWith().evaluate(trip({ pickupAt: null, scheduledOn: '2020-01-01' }), NOW)).toBeNull();
    });
  });

  describe('the signal', () => {
    it('names the trip as both subject and trip, at rule source, with no confidence', () => {
      const signal = detectorWith().evaluate(remaining(HOUR), NOW);
      expect(signal).toMatchObject({
        detectorCode: 'UNASSIGNED_TRIP_APPROACHING_EXECUTION',
        detectorVersion: 1,
        sourceType: 'rule',
        subjectType: 'trip',
        subjectId: TRIP,
        tripId: TRIP,
      });
      expect(signal?.confidence).toBeUndefined();
    });

    it('carries the facts that explain it, and the configuration in force', () => {
      const signal = detectorWith().evaluate(remaining(90 * 60_000), NOW);
      expect(signal?.evidence).toEqual({
        evidenceVersion: 1,
        tripId: TRIP,
        scheduledOn: '2026-09-24',
        pickupAt: new Date(NOW.getTime() + 90 * 60_000).toISOString(),
        tripStatus: 'confirmed',
        activeAssignmentCount: 0,
        remainingSeconds: 5400,
        warningLeadSeconds: 7200,
        highLeadSeconds: null,
        observedAt: NOW.toISOString(),
      });
    });

    it('carries no customer name in evidence — the summary is where a person reads', () => {
      const signal = detectorWith().evaluate(remaining(HOUR), NOW);
      expect(JSON.stringify(signal?.evidence)).not.toContain('A Customer');
      expect(signal?.summary).toContain('A Customer');
    });
  });

  describe('★ the candidate bands — approaching first, so it cannot be starved', () => {
    const windows = () => detectorWith().candidateWindows(NOW);

    it('asks for two bands, the approaching one FIRST', () => {
      expect(windows().map((w) => w.label)).toEqual(['approaching', 'overdue']);
    });

    it('the approaching band is (now, now + lead]', () => {
      const [approaching] = windows();
      expect(approaching!.after?.toISOString()).toBe(NOW.toISOString());
      expect(approaching!.before.toISOString()).toBe(new Date(NOW.getTime() + 2 * HOUR).toISOString());
    });

    it('the overdue band is everything at or before now, unbounded below', () => {
      const overdue = windows()[1];
      expect(overdue!.before.toISOString()).toBe(NOW.toISOString());
      expect(overdue!.after).toBeUndefined();
    });

    it('★ the bands are adjacent and half-open: `pickup_at = now` belongs to exactly one', () => {
      const [approaching, overdue] = windows();
      // (now, now+lead] and (-inf, now] meet at `now` and do not overlap:
      // `now` is excluded from the first and included in the second.
      expect(approaching!.after!.getTime()).toBe(overdue!.before.getTime());
    });

    it('together they still cover every candidate the predicate admits', () => {
      const [approaching, overdue] = windows();
      // Nothing between the two bands, and nothing above the lead that the
      // rule would have alerted on anyway.
      expect(overdue!.before.getTime()).toBe(approaching!.after!.getTime());
      expect(approaching!.before.getTime()).toBe(NOW.getTime() + 2 * HOUR);
    });
  });

  it('reads the subject id off the facts', () => {
    expect(detectorWith().subjectIdOf(trip())).toBe(TRIP);
  });
});
