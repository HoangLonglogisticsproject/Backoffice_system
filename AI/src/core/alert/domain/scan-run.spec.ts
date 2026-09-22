import { SCAN_OUTCOMES, SCAN_PHASES, verifiesResolutionOf, type ScanRun } from './scan-run';

describe('verifiesResolutionOf — the run that may resolve on the system\'s behalf', () => {
  const alert = { detectorCode: 'D1' };
  const run = (overrides: Partial<ScanRun> = {}): ScanRun => ({
    id: 'r',
    detectorCode: 'D1',
    detectorVersion: 1,
    phase: 'resolution',
    startedAt: new Date(),
    finishedAt: new Date(),
    outcome: 'succeeded',
    candidates: 0,
    signals: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    configSnapshot: {},
    error: null,
    correlationId: null,
    ...overrides,
  });

  it('admits a SUCCEEDED RESOLUTION run of the alert\'s own detector, and nothing else', () => {
    expect(verifiesResolutionOf(run(), alert)).toBe(true);
    expect(verifiesResolutionOf(null, alert)).toBe(false);
    expect(verifiesResolutionOf(run({ detectorCode: 'D2' }), alert)).toBe(false);
    expect(verifiesResolutionOf(run({ phase: 'discovery' }), alert)).toBe(false);
  });

  it.each(SCAN_OUTCOMES.filter((o) => o !== 'succeeded'))('refuses a resolution run whose outcome is %s', (outcome) => {
    expect(verifiesResolutionOf(run({ outcome }), alert)).toBe(false);
  });

  it('pins the vocabularies the CHECK constraints in 0001 spell out', () => {
    expect(SCAN_PHASES).toEqual(['discovery', 'resolution']);
    expect(SCAN_OUTCOMES).toEqual(['running', 'succeeded', 'partial', 'failed', 'abandoned']);
  });
});
