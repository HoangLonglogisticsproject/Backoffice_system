import type { AppConfig } from '../../config/app.config';
import { DetectorSettings } from '../../config/detector-settings';
import { CompletionReviewOverdueDetector } from '../../detectors/completion-review-overdue.detector';
import { StaleAssignmentStartDetector } from '../../detectors/stale-assignment-start.detector';
import { UnassignedTripApproachingDetector } from '../../detectors/unassigned-trip-approaching.detector';
import { ScanSchedulerService } from './scan-scheduler.service';

/**
 * What the scheduler does, and — more important — what it refuses to do
 * without a decision.
 */
describe('ScanSchedulerService', () => {
  const HOUR = 3_600_000;

  const configWith = (over: Partial<AppConfig> = {}): AppConfig =>
    ({
      scanIntervalMs: 300_000,
      scanInitialDelayMs: 0,
      unassignedTripWarningLeadMs: 2 * HOUR,
      unassignedTripHighLeadMs: null,
      staleStartGraceMs: null,
      staleStartHighMs: null,
      completionReviewWarningAfterMs: 12 * HOUR,
      completionReviewHighAfterMs: null,
      readModelPageSize: 100,
      resolutionBatchSize: 100,
      ...over,
    }) as unknown as AppConfig;

  const build = (over: Partial<AppConfig> = {}, backendConfigured = true) => {
    const config = configWith(over);
    const settings = new DetectorSettings(config);
    const engine = {
      discover: jest.fn().mockResolvedValue({ outcome: 'succeeded' }),
      resolve: jest.fn().mockResolvedValue({ outcome: 'succeeded' }),
    };
    const backend = {
      configured: backendConfigured,
      unassignedTrips: jest.fn(),
      unstartedAssignments: jest.fn(),
      pendingCompletions: jest.fn(),
      lookup: jest.fn(),
    };
    const release = jest.fn().mockResolvedValue(undefined);
    const lock = {
      acquire: jest.fn().mockResolvedValue({ release }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const scheduler = new ScanSchedulerService(
      config,
      settings,
      engine as never,
      backend as never,
      lock as never,
      new UnassignedTripApproachingDetector(settings),
      new StaleAssignmentStartDetector(settings),
      new CompletionReviewOverdueDetector(settings),
    );
    return { scheduler, engine, lock, release, backend };
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('arming', () => {
    it('★ does NOT arm without a scan interval — nobody has decided how often', () => {
      jest.useFakeTimers();
      const { scheduler, engine } = build({ scanIntervalMs: undefined } as Partial<AppConfig>);

      scheduler.onApplicationBootstrap();
      jest.advanceTimersByTime(10 * 60_000);

      expect(engine.discover).not.toHaveBeenCalled();
    });

    it('does not arm without a backend to read from', () => {
      jest.useFakeTimers();
      const { scheduler, engine } = build({}, false);

      scheduler.onApplicationBootstrap();
      jest.advanceTimersByTime(10 * 60_000);

      expect(engine.discover).not.toHaveBeenCalled();
    });

    it('arms when an interval and a backend are both configured, and ticks on the interval', async () => {
      jest.useFakeTimers();
      const { scheduler, engine } = build({ scanIntervalMs: 60_000, scanInitialDelayMs: 0 } as Partial<AppConfig>);

      scheduler.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
      const afterFirst = engine.discover.mock.calls.length;
      expect(afterFirst).toBeGreaterThan(0);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(engine.discover.mock.calls.length).toBeGreaterThan(afterFirst);

      await scheduler.onApplicationShutdown();
    });

    it('honours the initial delay before the first tick', async () => {
      jest.useFakeTimers();
      const { scheduler, engine } = build({ scanInitialDelayMs: 30_000 } as Partial<AppConfig>);

      scheduler.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(29_999);
      expect(engine.discover).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(engine.discover).toHaveBeenCalled();

      await scheduler.onApplicationShutdown();
    });
  });

  describe('a tick', () => {
    it('runs discovery then resolution for each ENABLED detector, under the lock', async () => {
      const { scheduler, engine, lock, release } = build();

      await scheduler.tick('cid-1');

      // D2 is disabled (no approved grace), so two detectors × two phases.
      expect(engine.discover).toHaveBeenCalledTimes(2);
      expect(engine.resolve).toHaveBeenCalledTimes(2);
      expect(lock.acquire).toHaveBeenCalledTimes(4);
      expect(release).toHaveBeenCalledTimes(4);

      expect(lock.acquire).toHaveBeenCalledWith('UNASSIGNED_TRIP_APPROACHING_EXECUTION', 'discovery');
      expect(lock.acquire).toHaveBeenCalledWith('UNASSIGNED_TRIP_APPROACHING_EXECUTION', 'resolution');
      expect(lock.acquire).toHaveBeenCalledWith('COMPLETION_REVIEW_OVERDUE', 'discovery');
      expect(lock.acquire).not.toHaveBeenCalledWith('STALE_ASSIGNMENT_START', expect.anything());
    });

    it('★ includes D2 once a grace is configured', async () => {
      const { scheduler, engine, lock } = build({ staleStartGraceMs: 30 * 60_000 } as Partial<AppConfig>);

      await scheduler.tick('cid-2');

      expect(engine.discover).toHaveBeenCalledTimes(3);
      expect(lock.acquire).toHaveBeenCalledWith('STALE_ASSIGNMENT_START', 'discovery');
      expect(lock.acquire).toHaveBeenCalledWith('STALE_ASSIGNMENT_START', 'resolution');
    });

    it('skips a phase another worker is already running', async () => {
      const { scheduler, engine, lock } = build();
      lock.acquire.mockResolvedValue(null);

      await scheduler.tick('cid-3');

      expect(engine.discover).not.toHaveBeenCalled();
      expect(engine.resolve).not.toHaveBeenCalled();
    });

    it('★ releases the lock even when the scan throws', async () => {
      const { scheduler, engine, release } = build();
      engine.discover.mockRejectedValue(new Error('the scan blew up'));

      await scheduler.tick('cid-4');

      expect(release).toHaveBeenCalled();
    });

    it('never throws out of a tick — an unhandled rejection would stop every future scan', async () => {
      const { scheduler, engine } = build();
      engine.discover.mockRejectedValue(new Error('boom'));
      await expect(scheduler.tick('cid-5')).resolves.toBeUndefined();
    });

    it('does not start a second tick while one is still running', async () => {
      const { scheduler, engine } = build();
      let releaseFirst!: () => void;
      // ONCE: only the first scan of the tick hangs. Later scans resolve from
      // the default mock, so releasing the first lets the whole tick finish.
      const started = new Promise<void>((resolveStarted) => {
        engine.discover.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirst = () => resolve({ outcome: 'succeeded' });
              resolveStarted();
            }),
        );
      });

      const first = scheduler.tick('cid-6');
      // Wait for the first tick to be genuinely mid-scan: it awaits the lock
      // before it reaches the engine, so one microtask is not enough.
      await started;

      await scheduler.tick('cid-7');
      expect(engine.discover).toHaveBeenCalledTimes(1);

      releaseFirst();
      await first;
    });

    it('passes the same correlation id to every scan of the tick', async () => {
      const { scheduler, engine } = build({ staleStartGraceMs: 60_000 } as Partial<AppConfig>);

      await scheduler.tick('one-correlation');

      for (const call of [...engine.discover.mock.calls, ...engine.resolve.mock.calls]) {
        expect(call[2]).toBe('one-correlation');
      }
    });
  });

  describe('shutdown', () => {
    it('stops the timer and closes the lock pool', async () => {
      jest.useFakeTimers();
      const { scheduler, engine, lock } = build({ scanIntervalMs: 60_000 } as Partial<AppConfig>);
      scheduler.onApplicationBootstrap();

      await scheduler.onApplicationShutdown();
      const before = engine.discover.mock.calls.length;
      await jest.advanceTimersByTimeAsync(5 * 60_000);

      expect(engine.discover.mock.calls.length).toBe(before);
      expect(lock.close).toHaveBeenCalled();
    });

    it('refuses to start a tick once shutting down', async () => {
      const { scheduler, engine } = build();
      await scheduler.onApplicationShutdown();
      await scheduler.tick('cid-8');
      expect(engine.discover).not.toHaveBeenCalled();
    });
  });
});
