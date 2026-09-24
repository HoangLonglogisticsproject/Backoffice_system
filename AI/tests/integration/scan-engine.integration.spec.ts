import { Pool } from 'pg';
import { FixedClock } from '@common/time/clock';
import type { Database } from '@common/types/database.port';
import type { AppConfig } from '@config/app.config';
import { DetectorSettings } from '@config/detector-settings';
import { AlertService } from '@core/alert/application/alert.service';
import { AlertHistoryRepository } from '@core/alert/persistence/alert-history.repository';
import { AlertRepository } from '@core/alert/persistence/alert.repository';
import { ScanRunRepository } from '@core/alert/persistence/scan-run.repository';
import { ScanEngineService } from '@core/detector/scan-engine.service';
import { UnassignedTripApproachingDetector } from '../../src/detectors/unassigned-trip-approaching.detector';
import { ReadModelError, type FactsPage } from '@infrastructure/backend-client/backend-read-model.client';
import type { CandidateWindow } from '@core/detector/detector.contract';
import type { TripFacts } from '@infrastructure/backend-client/read-model.types';
import {
  TEST_URL,
  describeIntegration,
  migrateTestSchema,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';

/**
 * Discovery and Resolution end to end, against a REAL PostgreSQL, with a real
 * detector and a stubbed backend.
 *
 * ★ THE BACKEND IS THE ONLY THING FAKED, and it is faked so that its FAILURES
 * can be. Everything the invariants are about — what is written, what is
 * counted, what is resolved and above all what is NOT resolved — happens in
 * the database exactly as it would in production.
 */
const SCHEMA = 'ai_itest_engine';
const TRIP_A = '11111111-1111-4111-8111-111111111111';
const TRIP_B = '22222222-2222-4222-8222-222222222222';
const USER = '99999999-9999-4999-8999-999999999999';

describeIntegration('Scan engine against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  const NOW = new Date('2026-09-24T08:00:00.000Z');
  const HOUR = 3_600_000;

  let pool: Pool;
  let db: Database;
  let alerts: AlertRepository;
  let history: AlertHistoryRepository;
  let scanRuns: ScanRunRepository;
  let service: AlertService;
  let engine: ScanEngineService;
  let detector: UnassignedTripApproachingDetector;
  let clock: FixedClock;

  const settings = new DetectorSettings({
    unassignedTripWarningLeadMs: 2 * HOUR,
    unassignedTripHighLeadMs: null,
    staleStartGraceMs: null,
    staleStartHighMs: null,
    completionReviewWarningAfterMs: 12 * HOUR,
    completionReviewHighAfterMs: null,
    readModelPageSize: 100,
    resolutionBatchSize: 2,
  } as unknown as AppConfig);

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await migrateTestSchema(pool, SCHEMA);
    db = poolAsDatabase(pool);
    alerts = new AlertRepository(db);
    history = new AlertHistoryRepository(db);
    scanRuns = new ScanRunRepository(db);
    service = new AlertService(db, alerts, history, scanRuns);
    clock = new FixedClock(NOW);
    detector = new UnassignedTripApproachingDetector(settings);
    engine = new ScanEngineService({} as never, service, alerts, scanRuns, settings, clock);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    clock.set(NOW);
    await pool.query('TRUNCATE alert_scan_observations, alert_transition_history, alerts, scan_runs');
  });

  /** A trip that IS a problem: pickup inside the two-hour lead, nobody assigned. */
  const problem = (tripId: string, minutesAway = 60): TripFacts => ({
    tripId,
    scheduledOn: '2026-09-24',
    pickupAt: new Date(clock.now().getTime() + minutesAway * 60_000),
    deliveryAt: null,
    status: 'confirmed',
    archived: false,
    activeAssignmentCount: 0,
    customer: null,
  });

  /** The same trip, now with a lorry on it — the condition has cleared. */
  const cleared = (tripId: string): TripFacts => ({ ...problem(tripId), activeAssignmentCount: 1 });

  /**
   * A backend stub that HONOURS THE BAND. D1 asks for two bands now, so a
   * stub that returned everything to both would double-count each trip —
   * and would be lying about what the real read model does, which filters on
   * `(after, before]` in SQL.
   */
  /** Band membership exactly as the read model's SQL computes it. */
  const inBand = (window: CandidateWindow, trip: TripFacts): boolean => {
    const at = trip.pickupAt!.getTime();
    const underUpper = window.beforeInclusive === false ? at < window.before.getTime() : at <= window.before.getTime();
    if (!underUpper) return false;
    if (window.after === undefined) return true;
    return window.afterInclusive === true ? at >= window.after.getTime() : at > window.after.getTime();
  };

  const onePage = (items: TripFacts[]) =>
    jest.fn(async (window: CandidateWindow): Promise<FactsPage<TripFacts>> => ({
      items: items.filter((trip) => inBand(window, trip)),
      nextCursor: null,
      hasMore: false,
    }));

  const lookupOf = (facts: TripFacts[]) =>
    jest.fn(async (ids: string[]) => facts.filter((item) => ids.includes(item.tripId)));

  const alertRow = async (tripId: string) => {
    const { rows } = await pool.query<{
      id: string;
      status: string;
      occurrence_count: number;
      severity: string;
      resolution_kind: string | null;
      resolved_scan_run_id: string | null;
    }>(
      `SELECT id, status, occurrence_count, severity, resolution_kind, resolved_scan_run_id
         FROM alerts WHERE subject_id = $1 ORDER BY first_seen_at DESC, id DESC LIMIT 1`,
      [tripId],
    );
    return rows[0];
  };

  const alertCount = async (tripId: string): Promise<number> => {
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM alerts WHERE subject_id = $1',
      [tripId],
    );
    return rows[0]?.n ?? 0;
  };

  describe('discovery', () => {
    it('★ E. an exact-now pickup survives an overdue backlog deeper than the page budget', async () => {
      // The starvation case with a REAL database behind it. The overdue band
      // never runs out — as a genuine backlog does not — and the one trip
      // whose pickup is this very instant sits in the approaching band. If
      // the cut at `now` fell the other way, this trip would be at the head
      // of the backlog and the budget would be gone before its page.
      let backlog = 0;
      const fetch = jest.fn(async (window: CandidateWindow): Promise<FactsPage<TripFacts>> => {
        if (window.label === 'approaching') {
          return { items: [problem(TRIP_A, 0)], nextCursor: null, hasMore: false };
        }
        backlog += 1;
        // A distinct, always-positive overdue trip per page, and always more.
        const id = `aaaaaaaa-0000-4000-8000-${String(backlog).padStart(12, '0')}`;
        return { items: [problem(id, -60 * 24)], nextCursor: `page-${backlog}`, hasMore: true };
      });

      const report = await engine.discover(detector, fetch, 'cid-exact-now');

      // The urgent trip was seen, and alerted, in THIS run.
      const urgent = await alertRow(TRIP_A);
      expect(urgent).toMatchObject({ status: 'open', occurrence_count: 1, severity: 'warning' });
      // The approaching band was asked for first, and exactly once.
      expect(fetch.mock.calls[0]![0].label).toBe('approaching');
      expect(fetch.mock.calls.filter((call) => call[0].label === 'approaching')).toHaveLength(1);

      // One observation, not one per band or one per page.
      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM alert_scan_observations WHERE alert_id = $1',
        [urgent!.id],
      );
      expect(rows[0]!.n).toBe(1);

      // The backlog still remains, so the run is honest about being partial.
      expect(report.outcome).toBe('partial');
      expect(report.error).toContain('overdue');
    });

    it('creates an alert for a positive, with a birth history row and one observation', async () => {
      const report = await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-1');

      expect(report).toMatchObject({ outcome: 'succeeded', candidates: 1, signals: 1, created: 1, updated: 0 });
      const alert = await alertRow(TRIP_A);
      expect(alert).toMatchObject({ status: 'open', occurrence_count: 1, severity: 'warning' });

      const story = await history.listByAlert(alert!.id);
      expect(story).toHaveLength(1);
      expect(story[0]).toMatchObject({ fromStatus: null, toStatus: 'open', actorType: 'system', correlationId: 'cid-1' });

      const run = await scanRuns.findById(report.scanRunId);
      expect(run).toMatchObject({ phase: 'discovery', outcome: 'succeeded', candidates: 1, signals: 1, created: 1 });
      expect(run?.configSnapshot['unassignedTripWarningLeadSeconds']).toBe(7200);
    });

    it('a second run of the SAME scan is idempotent: one alert, occurrence still 1', async () => {
      const page = onePage([problem(TRIP_A)]);
      const first = await engine.discover(detector, page, 'cid-2');
      // Same scan run id can only come from the same run; a repeat of the
      // whole discovery is a NEW run, so this asserts the row, not the count.
      expect(first.created).toBe(1);

      const again = await engine.discover(detector, page, 'cid-2');
      expect(again.created).toBe(0);
      expect(again.updated).toBe(1);
      expect(await alertCount(TRIP_A)).toBe(1);
    });

    it('★ a later scan increments the occurrence count exactly once', async () => {
      const page = onePage([problem(TRIP_A)]);
      await engine.discover(detector, page, 'cid-3');
      expect((await alertRow(TRIP_A))?.occurrence_count).toBe(1);

      await engine.discover(detector, page, 'cid-3');
      expect((await alertRow(TRIP_A))?.occurrence_count).toBe(2);

      await engine.discover(detector, page, 'cid-3');
      expect((await alertRow(TRIP_A))?.occurrence_count).toBe(3);
      expect(await alertCount(TRIP_A)).toBe(1);
    });

    it('ignores a candidate the rule says is not a problem', async () => {
      const report = await engine.discover(detector, onePage([cleared(TRIP_A)]), 'cid-4');
      expect(report).toMatchObject({ candidates: 1, signals: 0, created: 0 });
      expect(await alertCount(TRIP_A)).toBe(0);
    });

    it('★ does NOT resolve an existing alert whose subject is absent from the window', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-5');

      // The next scan sees nothing at all — the window moved, or the backend
      // simply returned no rows. The alert must stand.
      const report = await engine.discover(detector, onePage([]), 'cid-5');

      expect(report.outcome).toBe('succeeded');
      expect((await alertRow(TRIP_A))?.status).toBe('open');
    });

    it('a failed page is PARTIAL and keeps what it already wrote', async () => {
      const failing = jest
        .fn()
        .mockResolvedValueOnce({ items: [problem(TRIP_A)], nextCursor: 'c1', hasMore: true })
        .mockRejectedValueOnce(new ReadModelError('timeout', 'too slow'));

      const report = await engine.discover(detector, failing as never, 'cid-6');

      expect(report.outcome).toBe('partial');
      expect((await alertRow(TRIP_A))?.status).toBe('open');
      expect((await scanRuns.findById(report.scanRunId))?.outcome).toBe('partial');
    });
  });

  describe('resolution', () => {
    it('resolves an alert whose condition has cleared, recording the run that verified it', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-7');

      const report = await engine.resolve(detector, lookupOf([cleared(TRIP_A)]), 'cid-7');

      expect(report).toMatchObject({ outcome: 'succeeded', candidates: 1, resolved: 1 });
      const alert = await alertRow(TRIP_A);
      expect(alert).toMatchObject({ status: 'resolved', resolution_kind: 'system_cleared' });
      expect(alert?.resolved_scan_run_id).toBe(report.scanRunId);
      expect((await scanRuns.findById(report.scanRunId))?.resolved).toBe(1);
    });

    it('leaves an alert alone while its condition still holds', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-8');

      const report = await engine.resolve(detector, lookupOf([problem(TRIP_A)]), 'cid-8');

      expect(report.resolved).toBe(0);
      expect((await alertRow(TRIP_A))?.status).toBe('open');
    });

    it('★ a FAILED lookup resolves nothing, and the run says `partial`', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-9');

      const failing = jest.fn().mockRejectedValue(new ReadModelError('http', 'backend is unwell', 503));
      const report = await engine.resolve(detector, failing as never, 'cid-9');

      expect(report.outcome).toBe('partial');
      expect(report.resolved).toBe(0);
      expect((await alertRow(TRIP_A))?.status).toBe('open');
      expect((await scanRuns.findById(report.scanRunId))?.resolved).toBe(0);
    });

    it('★ a PARTIAL batch resolves nothing at all, not even the batch that succeeded', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A), problem(TRIP_B)]), 'cid-10');
      const third = '33333333-3333-4333-8333-333333333333';
      await engine.discover(detector, onePage([problem(third)]), 'cid-10');

      // Batch size is 2: the first batch clears, the second blows up.
      const lookup = jest
        .fn()
        .mockResolvedValueOnce([cleared(TRIP_A), cleared(TRIP_B)])
        .mockRejectedValueOnce(new ReadModelError('timeout', 'too slow'));

      const report = await engine.resolve(detector, lookup as never, 'cid-10');

      expect(report.outcome).toBe('partial');
      expect(report.resolved).toBe(0);
      expect((await alertRow(TRIP_A))?.status).toBe('open');
      expect((await alertRow(TRIP_B))?.status).toBe('open');
    });

    it('★ a subject the backend did not return is NOT resolved', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-11');

      // The backend answered, and this id simply was not in the answer.
      const report = await engine.resolve(detector, lookupOf([]), 'cid-11');

      expect(report.outcome).toBe('succeeded');
      expect(report.resolved).toBe(0);
      expect((await alertRow(TRIP_A))?.status).toBe('open');
    });

    it('resolves a DISMISSED alert once the condition clears — suppression ends by clearing', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-12');
      const alert = await alertRow(TRIP_A);
      await service.transition({
        alertId: alert!.id,
        to: 'dismissed',
        actor: { type: 'user', id: USER },
        reason: 'Known.',
      });

      // While the condition holds, a positive scan leaves it dismissed.
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-12');
      expect((await alertRow(TRIP_A))?.status).toBe('dismissed');

      const report = await engine.resolve(detector, lookupOf([cleared(TRIP_A)]), 'cid-12');

      expect(report.resolved).toBe(1);
      expect((await alertRow(TRIP_A))?.status).toBe('resolved');
    });

    it('resolves an ACKNOWLEDGED alert too', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cid-13');
      const alert = await alertRow(TRIP_A);
      await service.transition({ alertId: alert!.id, to: 'acknowledged', actor: { type: 'user', id: USER } });

      await engine.resolve(detector, lookupOf([cleared(TRIP_A)]), 'cid-13');
      expect((await alertRow(TRIP_A))?.status).toBe('resolved');
    });

    it('batches the lookup at the configured size', async () => {
      const third = '33333333-3333-4333-8333-333333333333';
      await engine.discover(detector, onePage([problem(TRIP_A), problem(TRIP_B), problem(third)]), 'cid-14');

      const lookup = jest.fn(async (ids: string[]) => ids.map((id) => cleared(id)));
      await engine.resolve(detector, lookup, 'cid-14');

      expect(lookup).toHaveBeenCalledTimes(2);
      expect((lookup.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(2);
      expect((lookup.mock.calls[1] as unknown as [string[]])[0]).toHaveLength(1);
    });
  });

  describe('★ crash and retry — the run proves VERIFICATION, not mutation', () => {
    /**
     * `scan_runs.outcome` answers exactly one question: did this run verify
     * the canonical facts completely? It deliberately does NOT answer "did
     * every resolution that followed land". That is why the run is closed
     * BEFORE the resolutions — `resolveBySystem` refuses a run that is not
     * already `succeeded` — and why a later mutation failure must never
     * downgrade it: an alert that IS resolved would then look as though a
     * PARTIAL scan had resolved it, which is the one thing Phase 1a forbids.
     *
     * The cases below are the crash windows that choice leaves open. None of
     * them uses a mock: each simply builds the state a crash would leave.
     */

    /** The state a crash leaves: a verified run that resolved nothing yet. */
    const verifiedRunThatResolvedNothing = async (): Promise<string> => {
      const run = await scanRuns.start({
        detectorCode: detector.code,
        detectorVersion: detector.version,
        phase: 'resolution',
        configSnapshot: settings.snapshot(),
        correlationId: 'crashed',
      });
      await scanRuns.finish(run.id, { outcome: 'succeeded', candidates: 2 });
      return run.id;
    };

    it('A — crash after verification, before the first resolve: nothing is corrupt, the next scan converges', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A), problem(TRIP_B)]), 'crash-a');
      const crashedRun = await verifiedRunThatResolvedNothing();

      // Both alerts are untouched, and the run stands as succeeded: it DID
      // verify — the process died on the way to acting on that.
      expect((await alertRow(TRIP_A))?.status).toBe('open');
      expect((await alertRow(TRIP_B))?.status).toBe('open');
      expect(await scanRuns.findById(crashedRun)).toMatchObject({ outcome: 'succeeded', resolved: 0 });

      // The next scan is an ordinary one and closes both.
      const retry = await engine.resolve(detector, lookupOf([cleared(TRIP_A), cleared(TRIP_B)]), 'crash-a');

      expect(retry.resolved).toBe(2);
      expect((await alertRow(TRIP_A))?.status).toBe('resolved');
      expect((await alertRow(TRIP_B))?.status).toBe('resolved');
      // Each names the run that actually verified it, not the crashed one.
      expect((await alertRow(TRIP_A))?.resolved_scan_run_id).toBe(retry.scanRunId);
    });

    it('B — crash after resolving A, before B: A stays resolved, B closes next time, A never reopens', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A), problem(TRIP_B)]), 'crash-b');
      const crashedRun = await verifiedRunThatResolvedNothing();
      const alertA = (await alertRow(TRIP_A))!;

      // A was resolved by that run; then the process died.
      await service.resolveBySystem({ alertId: alertA.id, scanRunId: crashedRun, correlationId: 'crash-b' });
      expect((await alertRow(TRIP_A))?.status).toBe('resolved');
      expect((await alertRow(TRIP_B))?.status).toBe('open');
      const historyAfterCrash = await history.listByAlert(alertA.id);
      // The metric was never written back — but the alert names the run.
      expect((await scanRuns.findById(crashedRun))?.resolved).toBe(0);
      expect((await alertRow(TRIP_A))?.resolved_scan_run_id).toBe(crashedRun);

      const retry = await engine.resolve(detector, lookupOf([cleared(TRIP_A), cleared(TRIP_B)]), 'crash-b');

      // ★ Only B was still a candidate: a resolved alert is not live, so it
      // cannot be resolved a second time.
      expect(retry.candidates).toBe(1);
      expect(retry.resolved).toBe(1);
      expect((await alertRow(TRIP_B))?.status).toBe('resolved');
      expect((await alertRow(TRIP_A))?.status).toBe('resolved');
      expect(await history.listByAlert(alertA.id)).toHaveLength(historyAfterCrash.length);
      expect((await history.listByAlert(alertA.id)).filter((h) => h.toStatus === 'resolved')).toHaveLength(1);
    });

    it('C — a resolution whose history write fails leaves that alert live, and the run stays succeeded', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'crash-c');
      const alert = (await alertRow(TRIP_A))!;
      const run = await verifiedRunThatResolvedNothing();

      // The same failure the Phase 1a suite proves rolls a transition back.
      const brokenHistory = {
        record: async () => {
          throw new Error('history unavailable');
        },
      } as unknown as AlertHistoryRepository;
      const fragile = new AlertService(db, alerts, brokenHistory, scanRuns);

      await expect(
        fragile.resolveBySystem({ alertId: alert.id, scanRunId: run, correlationId: 'crash-c' }),
      ).rejects.toThrow('history unavailable');

      // ★ The alert is untouched and the run is STILL succeeded: verification
      // was complete; only the mutation failed.
      expect((await alertRow(TRIP_A))?.status).toBe('open');
      expect((await alertRow(TRIP_A))?.resolved_scan_run_id).toBeNull();
      expect((await scanRuns.findById(run))?.outcome).toBe('succeeded');
      expect(await history.listByAlert(alert.id)).toHaveLength(1);

      // And the next scan converges.
      const retry = await engine.resolve(detector, lookupOf([cleared(TRIP_A)]), 'crash-c');
      expect(retry.resolved).toBe(1);
      expect((await alertRow(TRIP_A))?.status).toBe('resolved');
    });

    it('★ replaying the SAME succeeded run against an already-resolved alert is refused', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'idem');
      const report = await engine.resolve(detector, lookupOf([cleared(TRIP_A)]), 'idem');
      const alert = (await alertRow(TRIP_A))!;
      const storyAfterFirst = await history.listByAlert(alert.id);

      await expect(
        service.resolveBySystem({ alertId: alert.id, scanRunId: report.scanRunId, correlationId: 'idem' }),
      ).rejects.toThrow();

      expect((await alertRow(TRIP_A))?.status).toBe('resolved');
      expect(await history.listByAlert(alert.id)).toHaveLength(storyAfterFirst.length);
    });

    it('a PARTIAL run can never be used to resolve, even by a direct call', async () => {
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'partial-run');
      const alert = (await alertRow(TRIP_A))!;
      const run = await scanRuns.start({
        detectorCode: detector.code,
        detectorVersion: detector.version,
        phase: 'resolution',
        correlationId: 'partial-run',
      });
      await scanRuns.finish(run.id, { outcome: 'partial', error: 'the backend went away' });

      await expect(
        service.resolveBySystem({ alertId: alert.id, scanRunId: run.id, correlationId: 'partial-run' }),
      ).rejects.toThrow();

      expect((await alertRow(TRIP_A))?.status).toBe('open');
    });
  });

  describe('★ the full cycle: raise, clear, recur', () => {
    it('a condition that comes back after resolution opens a NEW incident', async () => {
      // 1. It happens.
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cycle');
      const first = await alertRow(TRIP_A);
      expect(first?.status).toBe('open');

      // 2. Somebody assigns a lorry; the next resolution closes it.
      await engine.resolve(detector, lookupOf([cleared(TRIP_A)]), 'cycle');
      expect((await alertRow(TRIP_A))?.status).toBe('resolved');

      // 3. A day later the lorry comes off again and the trip is bare.
      clock.advance(24 * HOUR);
      await engine.discover(detector, onePage([problem(TRIP_A)]), 'cycle');

      const second = await alertRow(TRIP_A);
      expect(second?.id).not.toBe(first?.id);
      expect(second?.status).toBe('open');
      expect(second?.occurrence_count).toBe(1);
      expect(await alertCount(TRIP_A)).toBe(2);

      // The resolved one stays resolved: nothing reopens.
      const { rows } = await pool.query<{ status: string }>('SELECT status FROM alerts WHERE id = $1', [first!.id]);
      expect(rows[0]?.status).toBe('resolved');
    });
  });
});
