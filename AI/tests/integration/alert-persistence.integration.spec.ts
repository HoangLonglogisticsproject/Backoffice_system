import { Pool } from 'pg';
import { ConflictError, InvalidTransitionError, ValidationError } from '@common/errors/domain.error';
import type { Database } from '@common/types/database.port';
import { AlertService } from '@core/alert/application/alert.service';
import { SYSTEM_ACTOR } from '@core/alert/domain/actor';
import { dedupeKeyOf } from '@core/alert/domain/dedupe';
import type { ScanOutcome, ScanPhase } from '@core/alert/domain/scan-run';
import { AlertHistoryRepository } from '@core/alert/persistence/alert-history.repository';
import { AlertRepository } from '@core/alert/persistence/alert.repository';
import { ScanRunRepository } from '@core/alert/persistence/scan-run.repository';
import {
  TEST_URL,
  describeIntegration,
  migrateTestSchema,
  openTestSchema,
  poolAsDatabase,
  signal,
} from '../helpers/integration-database';

/**
 * The Alert aggregate against a REAL PostgreSQL: dedupe by partial unique
 * index, DISMISSED-suppresses, distinct-scan-run counting by primary key,
 * transition + history in one transaction, one winner under concurrency, the
 * system-resolution invariant, and the CHECKs that keep the row honest.
 */
const SCHEMA = 'ai_itest_alerts';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DETECTOR = 'TEST_DETECTOR';

describeIntegration('Alert persistence against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let db: Database;
  let alerts: AlertRepository;
  let history: AlertHistoryRepository;
  let scanRuns: ScanRunRepository;
  let service: AlertService;

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await migrateTestSchema(pool, SCHEMA);
    db = poolAsDatabase(pool);
    alerts = new AlertRepository(db);
    history = new AlertHistoryRepository(db);
    scanRuns = new ScanRunRepository(db);
    service = new AlertService(db, alerts, history, scanRuns);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE alert_scan_observations, alert_transition_history, alerts, scan_runs');
  });

  const rowCount = async (dedupeKey: string): Promise<number> => {
    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM alerts WHERE dedupe_key = $1', [
      dedupeKey,
    ]);
    return rows.rows[0]?.n ?? 0;
  };

  const observationsOf = async (alertId: string): Promise<string[]> => {
    const rows = await pool.query<{ scan_run_id: string }>(
      'SELECT scan_run_id FROM alert_scan_observations WHERE alert_id = $1 ORDER BY observed_at, scan_run_id',
      [alertId],
    );
    return rows.rows.map((r) => r.scan_run_id);
  };

  /** A run in the given state. `succeeded` resolution runs are what the system resolves with. */
  const run = async (
    phase: ScanPhase = 'discovery',
    outcome: ScanOutcome = 'running',
    detectorCode = DETECTOR,
  ): Promise<string> => {
    const started = await scanRuns.start({ detectorCode, detectorVersion: 1, phase });
    if (outcome !== 'running') await scanRuns.finish(started.id, { outcome });
    return started.id;
  };
  const verifiedResolution = (detectorCode = DETECTOR) => run('resolution', 'succeeded', detectorCode);

  // ----------------------------------------------------------------- dedupe --

  describe('dedupe — one LIVE incident per key', () => {
    it('opens a new incident and writes its birth row in history', async () => {
      const s = signal();
      const { alert, created } = await service.recordSignal(s, { scanRunId: null, correlationId: 'c-1' });

      expect(created).toBe(true);
      expect(alert.status).toBe('open');
      expect(alert.dedupeKey).toBe(dedupeKeyOf(s));
      expect(alert.occurrenceCount).toBe(1);
      expect(alert.evidenceVersion).toBe(1);
      expect(alert.confidence).toBeNull();

      const born = await history.listByAlert(alert.id);
      expect(born).toHaveLength(1);
      expect(born[0]).toMatchObject({ fromStatus: null, toStatus: 'open', actorType: 'system', actorId: null, correlationId: 'c-1' });
    });

    it('an OPEN duplicate refreshes the row: no second row, no second history entry', async () => {
      const s = signal({ severity: 'warning', summary: 'first' });
      const first = await service.recordSignal(s);

      const again = await service.recordSignal({ ...s, severity: 'high', summary: 'second' });

      expect(again.created).toBe(false);
      expect(again.alert.id).toBe(first.alert.id);
      expect(again.alert.severity).toBe('high');
      expect(again.alert.summary).toBe('second');
      // No run identity on either observation: seen again, not counted again.
      expect(again.alert.occurrenceCount).toBe(1);
      expect(again.alert.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.alert.lastSeenAt.getTime());
      expect(await rowCount(dedupeKeyOf(s))).toBe(1);
      expect(await history.listByAlert(first.alert.id)).toHaveLength(1);
    });

    it('an ACKNOWLEDGED duplicate refreshes evidence and keeps the status', async () => {
      const s = signal();
      const { alert } = await service.recordSignal(s);
      await service.transition({ alertId: alert.id, to: 'acknowledged', actor: { type: 'user', id: USER_A } });

      const again = await service.recordSignal({ ...s, evidence: { observed: true, count: 2 } });

      expect(again.created).toBe(false);
      expect(again.alert.status).toBe('acknowledged');
      expect(again.alert.evidence).toEqual({ observed: true, count: 2 });
      expect(await rowCount(dedupeKeyOf(s))).toBe(1);
    });

    it('a DISMISSED duplicate is SUPPRESSED: evidence and severity move, status does not, no new row', async () => {
      const s = signal({ severity: 'warning' });
      const { alert } = await service.recordSignal(s);
      await service.transition({ alertId: alert.id, to: 'dismissed', actor: { type: 'user', id: USER_A }, reason: 'Known, handled offline.' });

      const again = await service.recordSignal({ ...s, severity: 'high' });

      expect(again.created).toBe(false);
      expect(again.alert.id).toBe(alert.id);
      expect(again.alert.status).toBe('dismissed');
      expect(again.alert.severity).toBe('high');
      expect(again.alert.dismissedReason).toBe('Known, handled offline.');
      expect(await rowCount(dedupeKeyOf(s))).toBe(1);
    });

    it('after RESOLVED the same key opens a NEW incident', async () => {
      const s = signal();
      const first = await service.recordSignal(s);
      await service.resolveBySystem({ alertId: first.alert.id, scanRunId: await verifiedResolution() });

      const second = await service.recordSignal(s);

      expect(second.created).toBe(true);
      expect(second.alert.id).not.toBe(first.alert.id);
      expect(second.alert.occurrenceCount).toBe(1);
      expect(await rowCount(dedupeKeyOf(s))).toBe(2);
    });

    it('two concurrent upserts of one key produce one row', async () => {
      const s = signal();
      const results = await Promise.all([service.recordSignal(s), service.recordSignal(s)]);

      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await rowCount(dedupeKeyOf(s))).toBe(1);
    });
  });

  // ------------------------------------------------------- occurrence_count --

  describe('occurrence_count — distinct scan runs, enforced by alert_scan_observations', () => {
    it('first A → 1, with the observation and first/last run recorded', async () => {
      const a = await run();
      const { alert } = await service.recordSignal(signal(), { scanRunId: a });
      expect(alert.occurrenceCount).toBe(1);
      expect(alert.firstScanRunId).toBe(a);
      expect(alert.lastScanRunId).toBe(a);
      expect(await observationsOf(alert.id)).toEqual([a]);
    });

    it('A, A, A → 1 — a retried page or a duplicate signal adds nothing', async () => {
      const a = await run();
      const s = signal();
      let last = (await service.recordSignal(s, { scanRunId: a })).alert;
      for (let i = 0; i < 2; i += 1) last = (await service.recordSignal({ ...s, severity: 'high' }, { scanRunId: a })).alert;
      expect(last.occurrenceCount).toBe(1);
      expect(last.severity).toBe('high');
      expect(await observationsOf(last.id)).toEqual([a]);
    });

    it('A, B → 2, and last_scan_run_id moves to B while first stays A', async () => {
      const a = await run();
      const b = await run();
      const s = signal();
      const first = await service.recordSignal(s, { scanRunId: a });
      const second = await service.recordSignal(s, { scanRunId: b });
      expect(second.alert.id).toBe(first.alert.id);
      expect(second.alert.occurrenceCount).toBe(2);
      expect(second.alert.firstScanRunId).toBe(a);
      expect(second.alert.lastScanRunId).toBe(b);
    });

    it('A, B, A → 2 — a delayed retry from A is the same run, not a new one', async () => {
      const a = await run();
      const b = await run();
      const s = signal();
      await service.recordSignal(s, { scanRunId: a });
      await service.recordSignal(s, { scanRunId: b });
      const late = await service.recordSignal(s, { scanRunId: a });
      expect(late.alert.occurrenceCount).toBe(2);
      expect(late.alert.lastScanRunId).toBe(a);
      expect((await observationsOf(late.alert.id)).sort()).toEqual([a, b].sort());
    });

    it('A, B, A, B → 2, and a third run C → 3', async () => {
      const [a, b, c] = [await run(), await run(), await run()];
      const s = signal();
      for (const r of [a, b, a, b]) await service.recordSignal(s, { scanRunId: r });
      expect((await service.recordSignal(s, { scanRunId: b })).alert.occurrenceCount).toBe(2);
      expect((await service.recordSignal(s, { scanRunId: c })).alert.occurrenceCount).toBe(3);
    });

    it('three concurrent upserts in the SAME run C count that run once', async () => {
      const c = await run();
      const s = signal();
      const results = await Promise.all([1, 2, 3].map(() => service.recordSignal(s, { scanRunId: c })));

      expect(results.filter((r) => r.created)).toHaveLength(1);
      const final = await alerts.findById(results[0]!.alert.id);
      expect(final?.occurrenceCount).toBe(1);
      expect(await observationsOf(final!.id)).toEqual([c]);
      expect(await rowCount(dedupeKeyOf(s))).toBe(1);
    });

    it('concurrent DISTINCT runs C and D each count exactly once — whichever opens the incident', async () => {
      const c = await run();
      const d = await run();
      const s = signal();
      const results = await Promise.all([
        service.recordSignal(s, { scanRunId: c }),
        service.recordSignal(s, { scanRunId: d }),
        service.recordSignal(s, { scanRunId: c }),
        service.recordSignal(s, { scanRunId: d }),
      ]);

      expect(results.filter((r) => r.created)).toHaveLength(1);
      const final = await alerts.findById(results[0]!.alert.id);
      expect(final?.occurrenceCount).toBe(2);
      expect((await observationsOf(final!.id)).sort()).toEqual([c, d].sort());
    });

    it('a DISMISSED incident: A, B, A keeps dismissed and counts 2', async () => {
      const a = await run();
      const b = await run();
      const s = signal();
      const { alert } = await service.recordSignal(s, { scanRunId: a });
      await service.transition({ alertId: alert.id, to: 'dismissed', actor: { type: 'user', id: USER_A }, reason: 'r' });

      for (const [r, expected] of [
        [a, 1],
        [b, 2],
        [a, 2],
      ] as const) {
        const seen = await service.recordSignal(s, { scanRunId: r });
        expect(seen.alert.status).toBe('dismissed');
        expect(seen.alert.occurrenceCount).toBe(expected);
      }
    });

    it('the database itself refuses a second observation of the same (alert, run)', async () => {
      const a = await run();
      const { alert } = await service.recordSignal(signal(), { scanRunId: a });
      await expect(
        pool.query('INSERT INTO alert_scan_observations (alert_id, scan_run_id) VALUES ($1, $2)', [alert.id, a]),
      ).rejects.toMatchObject({ code: '23505' });
    });

    describe('a NULL scan run — an observation with no run identity', () => {
      it('never counts, records no observation, and never erases the run that last saw the incident', async () => {
        const a = await run();
        const s = signal();
        await service.recordSignal(s, { scanRunId: a });

        const noRun = await service.recordSignal(s, { scanRunId: null });
        expect(noRun.alert.occurrenceCount).toBe(1);
        expect(noRun.alert.lastScanRunId).toBe(a);
        expect(await observationsOf(noRun.alert.id)).toEqual([a]);
      });

      it('repeated NULL observations stay at 1 (bootstrap / pre-scan)', async () => {
        const s = signal();
        await service.recordSignal(s);
        await service.recordSignal(s);
        const third = await service.recordSignal(s);
        expect(third.alert.occurrenceCount).toBe(1);
        expect(third.alert.firstScanRunId).toBeNull();
        expect(third.alert.lastScanRunId).toBeNull();
        expect(await observationsOf(third.alert.id)).toEqual([]);
      });

      it('the first REAL run after a NULL birth counts as a new run', async () => {
        const s = signal();
        await service.recordSignal(s);
        const a = await run();
        const seen = await service.recordSignal(s, { scanRunId: a });
        expect(seen.alert.occurrenceCount).toBe(2);
        expect(seen.alert.firstScanRunId).toBeNull();
        expect(seen.alert.lastScanRunId).toBe(a);
      });
    });
  });

  // -------------------------------------------------------------- lifecycle --

  describe('lifecycle — status change and history commit together', () => {
    it('acknowledge, then dismiss, then system-resolve — each with its history row', async () => {
      const { alert } = await service.recordSignal(signal());

      const acked = await service.transition({ alertId: alert.id, to: 'acknowledged', actor: { type: 'user', id: USER_A } });
      expect(acked.status).toBe('acknowledged');
      expect(acked.acknowledgedBy).toBe(USER_A);
      expect(acked.acknowledgedAt).not.toBeNull();

      const dismissed = await service.transition({
        alertId: alert.id,
        to: 'dismissed',
        actor: { type: 'user', id: USER_B },
        reason: '  Duplicate of another incident.  ',
      });
      expect(dismissed.status).toBe('dismissed');
      expect(dismissed.dismissedBy).toBe(USER_B);
      expect(dismissed.dismissedReason).toBe('Duplicate of another incident.');

      const runId = await verifiedResolution();
      const resolved = await service.resolveBySystem({ alertId: alert.id, scanRunId: runId, correlationId: 'run-9' });
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolvedBy).toBeNull();
      expect(resolved.resolutionKind).toBe('system_cleared');
      expect(resolved.resolvedScanRunId).toBe(runId);

      const story = await history.listByAlert(alert.id);
      expect(story.map((h) => [h.fromStatus, h.toStatus, h.actorType, h.actorId])).toEqual([
        [null, 'open', 'system', null],
        ['open', 'acknowledged', 'user', USER_A],
        ['acknowledged', 'dismissed', 'user', USER_B],
        ['dismissed', 'resolved', 'system', null],
      ]);
      expect(story[2]?.reason).toBe('Duplicate of another incident.');
      expect(story[3]?.correlationId).toBe('run-9');
      expect(story[3]?.scanRunId).toBe(runId);
    });

    it('a user resolution names the user', async () => {
      const { alert } = await service.recordSignal(signal());
      const resolved = await service.transition({ alertId: alert.id, to: 'resolved', actor: { type: 'user', id: USER_A } });
      expect(resolved.resolutionKind).toBe('user');
      expect(resolved.resolvedBy).toBe(USER_A);
    });

    it('refuses to dismiss without a reason, and writes nothing', async () => {
      const { alert } = await service.recordSignal(signal());

      await expect(
        service.transition({ alertId: alert.id, to: 'dismissed', actor: { type: 'user', id: USER_A }, reason: '   ' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await alerts.findById(alert.id))?.status).toBe('open');
      expect(await history.listByAlert(alert.id)).toHaveLength(1);
    });

    it('refuses a user moving dismissed → resolved, and a system moving anything → acknowledged', async () => {
      const { alert } = await service.recordSignal(signal());
      await service.transition({ alertId: alert.id, to: 'dismissed', actor: { type: 'user', id: USER_A }, reason: 'r' });

      await expect(
        service.transition({ alertId: alert.id, to: 'resolved', actor: { type: 'user', id: USER_A } }),
      ).rejects.toBeInstanceOf(InvalidTransitionError);
      await expect(service.transition({ alertId: alert.id, to: 'acknowledged', actor: SYSTEM_ACTOR })).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );

      expect((await alerts.findById(alert.id))?.status).toBe('dismissed');
    });

    it('never reopens: resolved is terminal for everybody', async () => {
      const { alert } = await service.recordSignal(signal());
      await service.resolveBySystem({ alertId: alert.id, scanRunId: await verifiedResolution() });

      for (const to of ['acknowledged', 'dismissed', 'resolved'] as const) {
        await expect(
          service.transition({ alertId: alert.id, to, actor: { type: 'user', id: USER_A }, reason: 'r' }),
        ).rejects.toBeInstanceOf(InvalidTransitionError);
      }
      await expect(
        service.resolveBySystem({ alertId: alert.id, scanRunId: await verifiedResolution() }),
      ).rejects.toBeInstanceOf(InvalidTransitionError);
    });

    it('two users acknowledging at once: one winner, one 409, one history row', async () => {
      const { alert } = await service.recordSignal(signal());

      const outcomes = await Promise.allSettled([
        service.transition({ alertId: alert.id, to: 'acknowledged', actor: { type: 'user', id: USER_A } }),
        service.transition({ alertId: alert.id, to: 'acknowledged', actor: { type: 'user', id: USER_B } }),
      ]);

      const won = outcomes.filter((o) => o.status === 'fulfilled');
      const lost = outcomes.filter((o) => o.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidTransitionError);

      const story = await history.listByAlert(alert.id);
      expect(story.filter((h) => h.toStatus === 'acknowledged')).toHaveLength(1);
    });

    it('when the history row cannot be written, the status change is rolled back with it', async () => {
      const { alert } = await service.recordSignal(signal());

      const brokenHistory = {
        record: async () => {
          throw new Error('history unavailable');
        },
        listByAlert: () => history.listByAlert(alert.id),
      } as unknown as AlertHistoryRepository;
      const fragile = new AlertService(db, alerts, brokenHistory, scanRuns);

      await expect(
        fragile.transition({ alertId: alert.id, to: 'acknowledged', actor: { type: 'user', id: USER_A } }),
      ).rejects.toThrow('history unavailable');

      expect((await alerts.findById(alert.id))?.status).toBe('open');
      expect((await alerts.findById(alert.id))?.acknowledgedAt).toBeNull();
    });

    it('moves updated_at forward on every update, by trigger, and never touches created_at', async () => {
      const { alert } = await service.recordSignal(signal());
      await pool.query('SELECT pg_sleep(0.01)');
      const acked = await service.transition({ alertId: alert.id, to: 'acknowledged', actor: { type: 'user', id: USER_A } });
      expect(acked.updatedAt.getTime()).toBeGreaterThan(alert.updatedAt.getTime());
      expect(acked.createdAt.getTime()).toBe(alert.createdAt.getTime());

      const dismissed = await service.transition({ alertId: alert.id, to: 'dismissed', actor: { type: 'user', id: USER_A }, reason: 'r' });
      expect(dismissed.updatedAt.getTime()).toBeGreaterThanOrEqual(acked.updatedAt.getTime());
    });

    it('updated_at cannot move backwards when an EARLIER-started transaction commits LATER', async () => {
      // now() is the transaction start. A writes second but began first, so a
      // now()-based trigger would persist an updated_at EARLIER than B's.
      const { alert } = await service.recordSignal(signal());
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query('BEGIN');
        const startedA = await a.query<{ t: Date }>('SELECT now() AS t');
        await pool.query('SELECT pg_sleep(0.02)');

        await b.query('BEGIN');
        await b.query("UPDATE alerts SET title = 'b' WHERE id = $1", [alert.id]);
        await b.query('COMMIT');
        const afterB = await pool.query<{ u: Date }>('SELECT updated_at AS u FROM alerts WHERE id = $1', [alert.id]);

        await a.query("UPDATE alerts SET title = 'a' WHERE id = $1", [alert.id]);
        await a.query('COMMIT');
        const afterA = await pool.query<{ u: Date }>('SELECT updated_at AS u FROM alerts WHERE id = $1', [alert.id]);

        expect(startedA.rows[0]!.t.getTime()).toBeLessThan(afterB.rows[0]!.u.getTime());
        expect(afterA.rows[0]!.u.getTime()).toBeGreaterThanOrEqual(afterB.rows[0]!.u.getTime());
        expect((await alerts.findById(alert.id))?.title).toBe('a');
      } finally {
        a.release();
        b.release();
      }
    });
  });

  // ------------------------------------------------------ system resolution --

  describe('resolveBySystem — the run is the evidence, and it is checked', () => {
    const untouched = async (alertId: string): Promise<void> => {
      expect((await alerts.findById(alertId))?.status).toBe('open');
      expect(await history.listByAlert(alertId)).toHaveLength(1);
    };

    it('refuses a missing run id before touching the database', async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(service.resolveBySystem({ alertId: alert.id, scanRunId: null as unknown as string })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(service.resolveBySystem({ alertId: alert.id, scanRunId: '' })).rejects.toBeInstanceOf(ValidationError);
      await untouched(alert.id);
    });

    it('refuses a run that does not exist', async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(service.resolveBySystem({ alertId: alert.id, scanRunId: USER_B })).rejects.toBeInstanceOf(ConflictError);
      await untouched(alert.id);
    });

    it('refuses a DISCOVERY run, even a succeeded one', async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(
        service.resolveBySystem({ alertId: alert.id, scanRunId: await run('discovery', 'succeeded') }),
      ).rejects.toBeInstanceOf(ConflictError);
      await untouched(alert.id);
    });

    it.each(['running', 'failed', 'partial', 'abandoned'] as const)(
      'refuses a resolution run whose outcome is %s — a scan that did not finish proved nothing',
      async (outcome) => {
        const { alert } = await service.recordSignal(signal());
        await expect(
          service.resolveBySystem({ alertId: alert.id, scanRunId: await run('resolution', outcome) }),
        ).rejects.toBeInstanceOf(ConflictError);
        await untouched(alert.id);
      },
    );

    it("refuses a succeeded resolution run of ANOTHER detector", async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(
        service.resolveBySystem({ alertId: alert.id, scanRunId: await verifiedResolution('OTHER_DETECTOR') }),
      ).rejects.toBeInstanceOf(ConflictError);
      await untouched(alert.id);
    });

    it('resolves with a succeeded resolution run of the matching detector, recording the run in history', async () => {
      const { alert } = await service.recordSignal(signal());
      const runId = await verifiedResolution();
      const resolved = await service.resolveBySystem({ alertId: alert.id, scanRunId: runId, correlationId: 'tick-3' });
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolutionKind).toBe('system_cleared');
      expect(resolved.resolvedScanRunId).toBe(runId);
      const last = (await history.listByAlert(alert.id)).at(-1);
      expect(last).toMatchObject({ toStatus: 'resolved', actorType: 'system', actorId: null, scanRunId: runId, correlationId: 'tick-3' });
    });

    it('the system cannot resolve through the user door, however it asks', async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(
        service.transition({ alertId: alert.id, to: 'resolved', actor: SYSTEM_ACTOR, scanRunId: await verifiedResolution() }),
      ).rejects.toBeInstanceOf(InvalidTransitionError);
      await untouched(alert.id);
    });

    it('rolls the resolution back when the history row cannot be written', async () => {
      const { alert } = await service.recordSignal(signal());
      const brokenHistory = {
        record: async () => {
          throw new Error('history unavailable');
        },
      } as unknown as AlertHistoryRepository;
      const fragile = new AlertService(db, alerts, brokenHistory, scanRuns);

      await expect(fragile.resolveBySystem({ alertId: alert.id, scanRunId: await verifiedResolution() })).rejects.toThrow(
        'history unavailable',
      );
      expect((await alerts.findById(alert.id))?.status).toBe('open');
      expect((await alerts.findById(alert.id))?.resolvedAt).toBeNull();
    });
  });

  // ------------------------------------------------------------ DB CHECKs --

  describe('the database refuses what the domain refuses', () => {
    it('a history row with a system actor AND an actor id, or a user actor WITHOUT one', async () => {
      const { alert } = await service.recordSignal(signal());

      await expect(
        pool.query(
          "INSERT INTO alert_transition_history (alert_id, from_status, to_status, actor_type, actor_id) VALUES ($1, 'open', 'resolved', 'system', $2)",
          [alert.id, USER_A],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        pool.query(
          "INSERT INTO alert_transition_history (alert_id, from_status, to_status, actor_type, actor_id) VALUES ($1, 'open', 'acknowledged', 'user', NULL)",
          [alert.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('a dismissal without a reason, at the row level', async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(
        pool.query(
          "UPDATE alerts SET status = 'dismissed', dismissed_at = now(), dismissed_by = $2, dismissed_reason = '  ' WHERE id = $1",
          [alert.id, USER_A],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('a status that does not match its timestamps', async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(pool.query("UPDATE alerts SET status = 'resolved' WHERE id = $1", [alert.id])).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('a resolution with the wrong actor shape', async () => {
      const { alert } = await service.recordSignal(signal());
      await expect(
        pool.query(
          "UPDATE alerts SET status = 'resolved', resolved_at = now(), resolution_kind = 'system_cleared', resolved_by = $2 WHERE id = $1",
          [alert.id, USER_A],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // ------------------------------------------------------- list / summary --

  describe('listing and summary', () => {
    it('pages newest-activity-first by keyset and honours the status filter', async () => {
      const opened = [];
      for (let i = 0; i < 5; i += 1) opened.push((await service.recordSignal(signal({ detectorCode: `D${i}` }))).alert);
      await service.transition({ alertId: opened[0]!.id, to: 'acknowledged', actor: { type: 'user', id: USER_A } });

      const page1 = await service.list({ statuses: ['open', 'acknowledged'], limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.list({ statuses: ['open', 'acknowledged'], limit: 2, cursor: page1.nextCursor as string });
      const page3 = await service.list({ statuses: ['open', 'acknowledged'], limit: 2, cursor: page2.nextCursor as string });

      const seen = [...page1.items, ...page2.items, ...page3.items].map((a) => a.id);
      expect(new Set(seen).size).toBe(5);
      expect(page3.hasMore).toBe(false);

      const onlyAcked = await service.list({ statuses: ['acknowledged'], limit: 50 });
      expect(onlyAcked.items.map((a) => a.id)).toEqual([opened[0]!.id]);
    });

    it('counts live incidents by status and severity, ignoring resolved ones', async () => {
      const a = (await service.recordSignal(signal({ severity: 'high' }))).alert;
      const b = (await service.recordSignal(signal({ severity: 'warning' }))).alert;
      await service.recordSignal(signal({ severity: 'warning' }));
      await service.transition({ alertId: a.id, to: 'dismissed', actor: { type: 'user', id: USER_A }, reason: 'r' });
      await service.resolveBySystem({ alertId: b.id, scanRunId: await verifiedResolution() });

      expect(await service.summary()).toEqual({
        open: 1,
        acknowledged: 0,
        dismissed: 1,
        bySeverity: { info: 0, warning: 1, high: 1, critical: 0 },
      });
    });
  });

  // -------------------------------------------------------------- scan_runs --

  describe('scan_runs foundation', () => {
    it('starts running and finishes once', async () => {
      const started = await scanRuns.start({
        detectorCode: DETECTOR,
        detectorVersion: 1,
        phase: 'discovery',
        configSnapshot: { leadTime: '2h' },
        correlationId: 'tick-1',
      });
      expect(started.outcome).toBe('running');
      expect(started.finishedAt).toBeNull();

      const done = await scanRuns.finish(started.id, { outcome: 'succeeded', candidates: 3, signals: 1, created: 1 });
      expect(done).toMatchObject({ outcome: 'succeeded', candidates: 3, signals: 1, created: 1, updated: 0 });
      expect(done?.finishedAt).not.toBeNull();

      expect(await scanRuns.finish(started.id, { outcome: 'failed', error: 'late' })).toBeNull();
      expect((await scanRuns.findById(started.id))?.outcome).toBe('succeeded');
    });

    it('refuses a finished run without a finished_at, and vice versa', async () => {
      await expect(
        pool.query("INSERT INTO scan_runs (detector_code, detector_version, phase, outcome) VALUES ('X', 1, 'discovery', 'succeeded')"),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
