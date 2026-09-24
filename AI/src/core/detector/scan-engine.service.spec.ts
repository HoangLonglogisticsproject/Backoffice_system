import { FixedClock } from '../../common/time/clock';
import { DetectorSettings } from '../../config/detector-settings';
import type { AppConfig } from '../../config/app.config';
import { ReadModelError, type FactsPage } from '../../infrastructure/backend-client/backend-read-model.client';
import type { AlertSignal } from '../alert/domain/alert';
import type { CandidateWindow, Detector } from './detector.contract';
import { ScanEngineService } from './scan-engine.service';

/**
 * The engine's two invariants, proven without a database:
 *
 *   1. Discovery never resolves anything, whatever it does or does not see.
 *   2. A run that did not SUCCEED resolves nothing.
 *
 * Both are also enforced in SQL by `resolveBySystem`; these cases prove the
 * engine does not even try, which is what keeps the log honest.
 */
describe('ScanEngineService', () => {
  const NOW = new Date('2026-09-24T08:00:00.000Z');

  interface Facts {
    id: string;
    problem: boolean;
  }

  const detector = (over: Partial<Detector<Facts>> = {}): Detector<Facts> => ({
    code: 'TEST_DETECTOR',
    version: 1,
    subjectType: 'trip',
    enabled: true,
    disabledReason: null,
    candidateWindows: () => [{ label: 'all', before: NOW }],
    subjectIdOf: (facts) => facts.id,
    evaluate: (facts) =>
      facts.problem
        ? ({
            detectorCode: 'TEST_DETECTOR',
            detectorVersion: 1,
            sourceType: 'rule',
            subjectType: 'trip',
            subjectId: facts.id,
            tripId: facts.id,
            severity: 'warning',
            title: 't',
            summary: 's',
            evidence: {},
          } satisfies AlertSignal)
        : null,
    ...over,
  });

  const build = () => {
    const alerts = {
      recordSignal: jest.fn().mockResolvedValue({ alert: { id: 'a' }, created: true }),
      resolveBySystem: jest.fn().mockResolvedValue({ id: 'a' }),
    };
    const alertRows = { liveSubjects: jest.fn().mockResolvedValue([]) };
    const scanRuns = {
      start: jest.fn(async (input: { phase: string }) => ({ id: `run-${input.phase}`, ...input })),
      finish: jest.fn().mockResolvedValue(null),
      recordResolved: jest.fn().mockResolvedValue(undefined),
    };
    const settings = new DetectorSettings({
      unassignedTripWarningLeadMs: 7_200_000,
      unassignedTripHighLeadMs: null,
      staleStartGraceMs: null,
      staleStartHighMs: null,
      completionReviewWarningAfterMs: 43_200_000,
      completionReviewHighAfterMs: null,
      readModelPageSize: 100,
      resolutionBatchSize: 2,
    } as unknown as AppConfig);

    const engine = new ScanEngineService(
      {} as never,
      alerts as never,
      alertRows as never,
      scanRuns as never,
      settings,
      new FixedClock(NOW),
    );
    return { engine, alerts, alertRows, scanRuns };
  };

  const page = (items: Facts[], nextCursor: string | null = null): FactsPage<Facts> => ({
    items,
    nextCursor,
    hasMore: nextCursor !== null,
  });

  describe('discovery', () => {
    it('records a signal for every positive and nothing for the rest', async () => {
      const { engine, alerts } = build();
      const fetch = jest.fn().mockResolvedValue(page([{ id: 't1', problem: true }, { id: 't2', problem: false }]));

      const report = await engine.discover(detector(), fetch, 'cid-1');

      expect(report.outcome).toBe('succeeded');
      expect(report.candidates).toBe(2);
      expect(report.signals).toBe(1);
      expect(report.created).toBe(1);
      expect(alerts.recordSignal).toHaveBeenCalledTimes(1);
      expect(alerts.recordSignal).toHaveBeenCalledWith(
        expect.objectContaining({ subjectId: 't1' }),
        { scanRunId: 'run-discovery', correlationId: 'cid-1' },
      );
    });

    it('★ NEVER resolves anything, even when the window comes back empty', async () => {
      const { engine, alerts } = build();
      const report = await engine.discover(detector(), jest.fn().mockResolvedValue(page([])), 'cid-2');

      expect(report.outcome).toBe('succeeded');
      expect(report.resolved).toBe(0);
      expect(alerts.resolveBySystem).not.toHaveBeenCalled();
    });

    it('walks every page the backend offers', async () => {
      const { engine } = build();
      const fetch = jest
        .fn()
        .mockResolvedValueOnce(page([{ id: 't1', problem: true }], 'c1'))
        .mockResolvedValueOnce(page([{ id: 't2', problem: true }]));

      const report = await engine.discover(detector(), fetch, 'cid-3');

      expect(report.candidates).toBe(2);
      expect(report.signals).toBe(2);
      expect(fetch).toHaveBeenNthCalledWith(1, { label: 'all', before: NOW }, null, 'cid-3');
      expect(fetch).toHaveBeenNthCalledWith(2, { label: 'all', before: NOW }, 'c1', 'cid-3');
    });

    it('a read failure mid-walk is PARTIAL, and keeps what it already recorded', async () => {
      const { engine, alerts, scanRuns } = build();
      const fetch = jest
        .fn()
        .mockResolvedValueOnce(page([{ id: 't1', problem: true }], 'c1'))
        .mockRejectedValueOnce(new ReadModelError('timeout', 'too slow'));

      const report = await engine.discover(detector(), fetch, 'cid-4');

      expect(report.outcome).toBe('partial');
      expect(report.error).toContain('timeout');
      expect(alerts.recordSignal).toHaveBeenCalledTimes(1);
      expect(scanRuns.finish).toHaveBeenCalledWith('run-discovery', expect.objectContaining({ outcome: 'partial' }));
    });

    it('an unexpected error is FAILED, not partial', async () => {
      const { engine } = build();
      const fetch = jest.fn().mockRejectedValue(new TypeError('programming mistake'));
      const report = await engine.discover(detector(), fetch, 'cid-5');
      expect(report.outcome).toBe('failed');
    });

    it('★ stops at the page cap and reports PARTIAL, never `succeeded`', async () => {
      const { engine, scanRuns } = build();
      // A backend that always says there is more: the walk must stop itself.
      const endless = jest.fn(async () => page([{ id: 't1', problem: false }], 'next'));

      const report = await engine.discover(detector(), endless, 'cid-cap');

      expect(report.outcome).toBe('partial');
      expect(report.error).toMatch(/Stopped after 100 pages/);
      expect(endless).toHaveBeenCalledTimes(100);
      expect(scanRuns.finish).toHaveBeenCalledWith('run-discovery', expect.objectContaining({ outcome: 'partial' }));
    });

    it('does not report partial when the last page happens to be the hundredth', async () => {
      const { engine } = build();
      let call = 0;
      const exactly100 = jest.fn(async () => {
        call += 1;
        return call < 100 ? page([], 'next') : page([]);
      });

      const report = await engine.discover(detector(), exactly100, 'cid-cap-exact');

      expect(exactly100).toHaveBeenCalledTimes(100);
      expect(report.outcome).toBe('succeeded');
    });

    describe('★ several bands, walked in the detector\'s order under one budget', () => {
      const twoBand = (): Detector<Facts> =>
        detector({
          candidateWindows: () => [
            { label: 'approaching', after: NOW, afterInclusive: true, before: new Date(NOW.getTime() + 7_200_000) },
            { label: 'overdue', before: NOW, beforeInclusive: false },
          ],
        });

      it('walks the first band to the end before it asks for the second', async () => {
        const { engine } = build();
        const seen: string[] = [];
        const fetch = jest.fn(async (window: CandidateWindow) => {
          seen.push(window.label);
          return page([]);
        });

        await engine.discover(twoBand(), fetch, 'cid-bands');

        expect(seen).toEqual(['approaching', 'overdue']);
      });

      it('passes each band\'s bounds through to the backend', async () => {
        const { engine } = build();
        const fetch = jest.fn(async () => page([]));

        await engine.discover(twoBand(), fetch, 'cid-bounds');

        expect(fetch).toHaveBeenNthCalledWith(
          1,
          { label: 'approaching', after: NOW, afterInclusive: true, before: new Date(NOW.getTime() + 7_200_000) },
          null,
          'cid-bounds',
        );
        // Including the inclusivity flags: the engine forwards the band the
        // detector declared, whole, and decides nothing about its edges.
        expect(fetch).toHaveBeenNthCalledWith(
          2,
          { label: 'overdue', before: NOW, beforeInclusive: false },
          null,
          'cid-bounds',
        );
      });

      it('★ THE STARVATION CASE: an endless overdue band cannot hide the approaching one', async () => {
        const { engine, alerts } = build();
        // The approaching band holds the one trip that matters; the overdue
        // band is an inexhaustible backlog. Before the fix the single
        // ascending walk spent the whole budget on the backlog and never
        // reached the urgent trip.
        const fetch = jest.fn(async (window: CandidateWindow) =>
          window.label === 'approaching'
            ? page([{ id: 'urgent', problem: true }])
            : page([{ id: 'ancient', problem: true }], 'more'),
        );

        const report = await engine.discover(twoBand(), fetch, 'cid-starve');

        // The urgent trip WAS evaluated and alerted, in this very scan.
        expect(alerts.recordSignal).toHaveBeenCalledWith(
          expect.objectContaining({ subjectId: 'urgent' }),
          expect.anything(),
        );
        // The backlog still costs the run its clean bill of health.
        expect(report.outcome).toBe('partial');
        expect(report.error).toContain('overdue');
      });

      it('★ an approaching band that exceeds the budget is PARTIAL, and the overdue band is reported unreached', async () => {
        const { engine } = build();
        const fetch = jest.fn(async (window: CandidateWindow) =>
          window.label === 'approaching' ? page([{ id: 'a', problem: false }], 'more') : page([]),
        );

        const report = await engine.discover(twoBand(), fetch, 'cid-first-band-cap');

        expect(report.outcome).toBe('partial');
        expect(report.error).toContain('approaching');
        // It never got to the second band, and says so rather than implying
        // the whole window was seen.
        expect(fetch).toHaveBeenCalledTimes(100);
      });

      it('reports `succeeded` when both bands finish inside the budget', async () => {
        const { engine } = build();
        const report = await engine.discover(twoBand(), jest.fn(async () => page([])), 'cid-both');
        expect(report.outcome).toBe('succeeded');
        expect(report.error).toBeNull();
      });
    });

    it('records the run with its phase and closes it exactly once', async () => {
      const { engine, scanRuns } = build();
      await engine.discover(detector(), jest.fn().mockResolvedValue(page([])), 'cid-6');
      expect(scanRuns.start).toHaveBeenCalledWith(expect.objectContaining({ phase: 'discovery', detectorCode: 'TEST_DETECTOR' }));
      expect(scanRuns.finish).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolution', () => {
    const live = [
      { alertId: 'a1', subjectId: 't1' },
      { alertId: 'a2', subjectId: 't2' },
      { alertId: 'a3', subjectId: 't3' },
    ];

    it('resolves exactly the alerts whose condition has cleared', async () => {
      const { engine, alerts, alertRows } = build();
      alertRows.liveSubjects.mockResolvedValue(live);
      const lookup = jest.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, problem: id === 't2' })),
      );

      const report = await engine.resolve(detector(), lookup, 'cid-7');

      expect(report.outcome).toBe('succeeded');
      expect(report.candidates).toBe(3);
      expect(report.resolved).toBe(2);
      expect(alerts.resolveBySystem).toHaveBeenCalledWith({ alertId: 'a1', scanRunId: 'run-resolution', correlationId: 'cid-7' });
      expect(alerts.resolveBySystem).toHaveBeenCalledWith({ alertId: 'a3', scanRunId: 'run-resolution', correlationId: 'cid-7' });
      expect(alerts.resolveBySystem).not.toHaveBeenCalledWith(expect.objectContaining({ alertId: 'a2' }));
    });

    it('batches the lookup at the configured size', async () => {
      const { engine, alertRows } = build();
      alertRows.liveSubjects.mockResolvedValue(live);
      const lookup = jest.fn(async (ids: string[]) => ids.map((id) => ({ id, problem: true })));

      await engine.resolve(detector(), lookup, 'cid-8');

      expect(lookup).toHaveBeenCalledTimes(2);
      expect(lookup).toHaveBeenNthCalledWith(1, ['t1', 't2'], 'cid-8');
      expect(lookup).toHaveBeenNthCalledWith(2, ['t3'], 'cid-8');
    });

    it('★ a failed lookup resolves NOTHING, even for the batch that succeeded', async () => {
      const { engine, alerts, alertRows, scanRuns } = build();
      alertRows.liveSubjects.mockResolvedValue(live);
      // The first batch came back clear; the second never came back at all.
      const lookup = jest
        .fn()
        .mockResolvedValueOnce([
          { id: 't1', problem: false },
          { id: 't2', problem: false },
        ])
        .mockRejectedValueOnce(new ReadModelError('http', 'backend is unwell', 503));

      const report = await engine.resolve(detector(), lookup, 'cid-9');

      expect(report.outcome).toBe('partial');
      expect(report.resolved).toBe(0);
      expect(alerts.resolveBySystem).not.toHaveBeenCalled();
      expect(scanRuns.recordResolved).not.toHaveBeenCalled();
    });

    it('★ a subject the backend did not return is NOT treated as cleared', async () => {
      const { engine, alerts, alertRows } = build();
      alertRows.liveSubjects.mockResolvedValue([{ alertId: 'a1', subjectId: 't1' }]);
      const lookup = jest.fn().mockResolvedValue([]);

      const report = await engine.resolve(detector(), lookup, 'cid-10');

      expect(report.outcome).toBe('succeeded');
      expect(report.resolved).toBe(0);
      expect(alerts.resolveBySystem).not.toHaveBeenCalled();
    });

    it('a refused resolution (somebody moved the alert) is not a scan failure', async () => {
      const { engine, alerts, alertRows } = build();
      alertRows.liveSubjects.mockResolvedValue([{ alertId: 'a1', subjectId: 't1' }]);
      alerts.resolveBySystem.mockRejectedValue(new Error('An alert that is resolved cannot be resolved'));

      const report = await engine.resolve(detector(), jest.fn().mockResolvedValue([{ id: 't1', problem: false }]), 'cid-11');

      expect(report.outcome).toBe('succeeded');
      expect(report.resolved).toBe(0);
    });

    it('records the run under the resolution phase and writes the count back after closing it', async () => {
      const { engine, alertRows, scanRuns } = build();
      alertRows.liveSubjects.mockResolvedValue([{ alertId: 'a1', subjectId: 't1' }]);

      await engine.resolve(detector(), jest.fn().mockResolvedValue([{ id: 't1', problem: false }]), 'cid-12');

      expect(scanRuns.start).toHaveBeenCalledWith(expect.objectContaining({ phase: 'resolution' }));
      // ★ The run is closed BEFORE any resolution is attempted, because
      // `resolveBySystem` refuses a run that is still `running`.
      const finishOrder = scanRuns.finish.mock.invocationCallOrder[0] as number;
      const resolvedOrder = scanRuns.recordResolved.mock.invocationCallOrder[0] as number;
      expect(finishOrder).toBeLessThan(resolvedOrder);
      expect(scanRuns.recordResolved).toHaveBeenCalledWith('run-resolution', 1);
    });

    it('asks only for the alerts of ITS OWN detector', async () => {
      const { engine, alertRows } = build();
      await engine.resolve(detector({ code: 'OTHER' }), jest.fn().mockResolvedValue([]), 'cid-13');
      expect(alertRows.liveSubjects).toHaveBeenCalledWith('OTHER');
    });
  });
});
