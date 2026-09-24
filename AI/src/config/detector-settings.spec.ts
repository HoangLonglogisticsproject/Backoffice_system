import type { AppConfig } from './app.config';
import { DetectorSettings } from './detector-settings';

/**
 * What the settings expose, and — the part that matters for security — what
 * their snapshot does NOT carry into `scan_runs.config_snapshot`, which is a
 * row an operator reads and a support export could carry off the box.
 */
describe('DetectorSettings', () => {
  const HOUR = 3_600_000;

  const SECRETS = {
    databaseUrl: 'postgres://ai_app:SUPER-SECRET-PASSWORD@db:5432/backoffice',
    serviceTokenBackendToAi: 'backend-to-ai-SECRET-token-000000000000',
    serviceTokenAiToBackend: 'ai-to-backend-SECRET-token-000000000000',
    trustedContextSecret: 'trusted-context-SECRET-key-000000000000',
    backendInternalUrl: 'http://backend:3000',
  };

  const settingsWith = (over: Partial<AppConfig> = {}) =>
    new DetectorSettings({
      ...SECRETS,
      unassignedTripWarningLeadMs: 2 * HOUR,
      unassignedTripHighLeadMs: null,
      staleStartGraceMs: null,
      staleStartHighMs: null,
      completionReviewWarningAfterMs: 12 * HOUR,
      completionReviewHighAfterMs: null,
      readModelPageSize: 100,
      resolutionBatchSize: 100,
      ...over,
    } as unknown as AppConfig);

  describe('approved and unapproved values', () => {
    it('carries the two approved thresholds through', () => {
      const settings = settingsWith();
      expect(settings.unassignedTripWarningLeadMs).toBe(2 * HOUR);
      expect(settings.completionReviewWarningAfterMs).toBe(12 * HOUR);
    });

    it('★ reports an unapproved threshold as null, never as a number', () => {
      const settings = settingsWith();
      expect(settings.unassignedTripHighLeadMs).toBeNull();
      expect(settings.staleStartGraceMs).toBeNull();
      expect(settings.staleStartHighMs).toBeNull();
      expect(settings.completionReviewHighAfterMs).toBeNull();
    });
  });

  describe('★ the snapshot is secret-free', () => {
    const snapshot = () => settingsWith({ staleStartGraceMs: 30 * 60_000 } as Partial<AppConfig>).snapshot();

    it.each(Object.entries(SECRETS))('contains no trace of %s', (_name, value) => {
      expect(JSON.stringify(snapshot())).not.toContain(value);
    });

    it('contains no credential-shaped key at all', () => {
      const keys = Object.keys(snapshot()).join(' ').toLowerCase();
      for (const forbidden of ['token', 'secret', 'password', 'url', 'database', 'credential', 'authorization']) {
        expect(keys).not.toContain(forbidden);
      }
    });

    it('carries exactly the six detector policy values, and nothing else', () => {
      expect(Object.keys(snapshot()).sort()).toEqual([
        'completionReviewHighAfterSeconds',
        'completionReviewWarningAfterSeconds',
        'staleStartGraceSeconds',
        'staleStartHighSeconds',
        'unassignedTripHighLeadSeconds',
        'unassignedTripWarningLeadSeconds',
      ]);
    });

    it('reports durations in seconds, and an undecided one as null', () => {
      expect(snapshot()).toEqual({
        unassignedTripWarningLeadSeconds: 7200,
        unassignedTripHighLeadSeconds: null,
        staleStartGraceSeconds: 1800,
        staleStartHighSeconds: null,
        completionReviewWarningAfterSeconds: 43200,
        completionReviewHighAfterSeconds: null,
      });
    });

    it('is JSON-serialisable, because it is stored as jsonb', () => {
      expect(() => JSON.parse(JSON.stringify(snapshot()))).not.toThrow();
    });
  });

  describe('technical sizes', () => {
    it('are passed through and stay within the backend lookup ceiling', () => {
      const settings = settingsWith();
      expect(settings.readModelPageSize).toBe(100);
      expect(settings.resolutionBatchSize).toBe(100);
      expect(settings.resolutionBatchSize).toBeLessThanOrEqual(200);
    });
  });
});
