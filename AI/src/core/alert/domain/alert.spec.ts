import {
  ALERT_SEVERITIES,
  ALERT_SOURCE_TYPES,
  ALERT_STATUSES,
  ALERT_SUBJECT_TYPES,
  EVIDENCE_VERSION,
  LIVE_STATUSES,
  RESOLUTION_KINDS,
} from './alert';

/**
 * The closed vocabularies, pinned. Each of these is also a CHECK constraint in
 * 0001_alerts.sql; a change on one side without the other is a runtime error
 * on the first write, so the spelling is asserted here where review looks.
 */
describe('alert vocabularies', () => {
  it('statuses', () => {
    expect(ALERT_STATUSES).toEqual(['open', 'acknowledged', 'dismissed', 'resolved']);
  });

  it('live statuses include dismissed (suppress-until-clear) and exclude resolved', () => {
    expect(LIVE_STATUSES).toEqual(['open', 'acknowledged', 'dismissed']);
    expect(LIVE_STATUSES).not.toContain('resolved');
  });

  it('severities admit the full scale even though Phase 1 emits two', () => {
    expect(ALERT_SEVERITIES).toEqual(['info', 'warning', 'high', 'critical']);
  });

  it('source types admit anomaly and ai without a migration', () => {
    expect(ALERT_SOURCE_TYPES).toEqual(['rule', 'anomaly', 'ai']);
  });

  it('subject types', () => {
    expect(ALERT_SUBJECT_TYPES).toEqual(['trip', 'assignment', 'completion_request']);
  });

  it('resolution kinds', () => {
    expect(RESOLUTION_KINDS).toEqual(['system_cleared', 'user']);
  });

  it('evidence version starts at 1', () => {
    expect(EVIDENCE_VERSION).toBe(1);
  });
});
