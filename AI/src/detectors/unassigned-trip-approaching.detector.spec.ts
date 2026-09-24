import { DetectorSettings } from '../config/detector-settings';
import type { AppConfig } from '../config/app.config';
import type { TripFacts } from '../infrastructure/backend-client/read-model.types';
import type { CandidateWindow } from '../core/detector/detector.contract';
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
    const LEAD = 2 * HOUR;

    /**
     * Band membership as the READ MODEL computes it, from the same four
     * fields the request carries. The detector declares an interval; this is
     * what that interval means to the side that runs the query, so a
     * boundary test here asserts the partition rather than the wording.
     */
    const contains = (band: CandidateWindow, pickupAt: Date): boolean => {
      const at = pickupAt.getTime();
      const underUpper = band.beforeInclusive === false ? at < band.before.getTime() : at <= band.before.getTime();
      if (!underUpper) return false;
      if (band.after === undefined) return true;
      return band.afterInclusive === true ? at >= band.after.getTime() : at > band.after.getTime();
    };

    const bandsFor = (pickupAt: Date): string[] => windows().filter((band) => contains(band, pickupAt)).map((b) => b.label);

    it('asks for two bands, the approaching one FIRST', () => {
      expect(windows().map((w) => w.label)).toEqual(['approaching', 'overdue']);
    });

    it('the approaching band is [now, now + lead] — both ends closed', () => {
      const [approaching] = windows();
      expect(approaching!.after?.toISOString()).toBe(NOW.toISOString());
      expect(approaching!.afterInclusive).toBe(true);
      expect(approaching!.before.toISOString()).toBe(new Date(NOW.getTime() + LEAD).toISOString());
      expect(approaching!.beforeInclusive).toBeUndefined(); // the default, which is inclusive
    });

    it('the overdue band is everything strictly before now, unbounded below', () => {
      const overdue = windows()[1];
      expect(overdue!.before.toISOString()).toBe(NOW.toISOString());
      expect(overdue!.beforeInclusive).toBe(false);
      expect(overdue!.after).toBeUndefined();
    });

    it('★ A. `pickup_at = now` is APPROACHING, and is not overdue', () => {
      // The whole point of the correction: a trip due this instant is the
      // most urgent candidate there is, and it must not sit behind a backlog.
      expect(bandsFor(NOW)).toEqual(['approaching']);
    });

    it('★ B. one millisecond before now is OVERDUE, and only overdue', () => {
      expect(bandsFor(new Date(NOW.getTime() - 1))).toEqual(['overdue']);
    });

    it('★ C. `pickup_at = now + lead` is APPROACHING — the far end is closed too', () => {
      expect(bandsFor(new Date(NOW.getTime() + LEAD))).toEqual(['approaching']);
      // and the rule agrees with the band: exactly two hours out already alerts.
      expect(detectorWith().evaluate(trip({ pickupAt: new Date(NOW.getTime() + LEAD) }), NOW)).not.toBeNull();
    });

    it('★ D. beyond the lead is in NEITHER band', () => {
      expect(bandsFor(new Date(NOW.getTime() + LEAD + 1))).toEqual([]);
      // and would not have alerted anyway, so discovery loses nothing.
      expect(detectorWith().evaluate(trip({ pickupAt: new Date(NOW.getTime() + LEAD + 1) }), NOW)).toBeNull();
    });

    it('the two bands partition the line: no gap, no overlap, at any offset', () => {
      const offsets = [-30 * HOUR, -HOUR, -1000, -1, 0, 1, 1000, HOUR, LEAD - 1, LEAD];
      for (const offset of offsets) {
        expect(bandsFor(new Date(NOW.getTime() + offset))).toHaveLength(1);
      }
    });
  });

  it('reads the subject id off the facts', () => {
    expect(detectorWith().subjectIdOf(trip())).toBe(TRIP);
  });
});
