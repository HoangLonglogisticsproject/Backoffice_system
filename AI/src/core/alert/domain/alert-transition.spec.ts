import { ValidationError } from '../../../common/errors/domain.error';
import { ALERT_STATUSES, type AlertStatus } from './alert';
import { canTransition, normaliseReason, TRANSITION_TARGETS } from './alert-transition';

/**
 * The whole matrix, both actors, every pair. What is admitted is listed; what
 * is not listed is refused — including everything out of `resolved`.
 */
describe('alert lifecycle', () => {
  const admitted = {
    user: [
      ['open', 'acknowledged'],
      ['open', 'dismissed'],
      ['acknowledged', 'dismissed'],
      ['open', 'resolved'],
      ['acknowledged', 'resolved'],
    ],
    system: [
      ['open', 'resolved'],
      ['acknowledged', 'resolved'],
      ['dismissed', 'resolved'],
    ],
  } as const;

  for (const actor of ['user', 'system'] as const) {
    describe(`as ${actor}`, () => {
      for (const from of ALERT_STATUSES) {
        for (const to of ALERT_STATUSES) {
          const expected = admitted[actor].some(([f, t]) => f === from && t === to);
          it(`${from} → ${to}: ${expected ? 'admitted' : 'refused'}`, () => {
            expect(canTransition(from, to, actor)).toBe(expected);
          });
        }
      }
    });
  }

  it('dismissed → resolved is the system\'s alone', () => {
    expect(canTransition('dismissed', 'resolved', 'system')).toBe(true);
    expect(canTransition('dismissed', 'resolved', 'user')).toBe(false);
  });

  it('the system never acknowledges or dismisses', () => {
    for (const from of ALERT_STATUSES) {
      expect(canTransition(from, 'acknowledged', 'system')).toBe(false);
      expect(canTransition(from, 'dismissed', 'system')).toBe(false);
    }
  });

  it('resolved is terminal for everybody, and nothing is ever reopened', () => {
    for (const actor of ['user', 'system'] as const) {
      for (const to of ALERT_STATUSES) expect(canTransition('resolved', to, actor)).toBe(false);
      for (const from of ALERT_STATUSES) expect(canTransition(from, 'open', actor)).toBe(false);
    }
    expect(TRANSITION_TARGETS).not.toContain('open' as AlertStatus);
    expect([...TRANSITION_TARGETS].sort()).toEqual(['acknowledged', 'dismissed', 'resolved']);
  });

  describe('reasons', () => {
    it('are mandatory for a dismissal', () => {
      expect(() => normaliseReason('dismissed', undefined)).toThrow(ValidationError);
      expect(() => normaliseReason('dismissed', null)).toThrow(ValidationError);
      expect(() => normaliseReason('dismissed', '   ')).toThrow(ValidationError);
      expect(normaliseReason('dismissed', '  handled ')).toBe('handled');
    });

    it('are optional otherwise, and blank means none', () => {
      expect(normaliseReason('acknowledged', undefined)).toBeNull();
      expect(normaliseReason('resolved', '  ')).toBeNull();
      expect(normaliseReason('resolved', ' fixed ')).toBe('fixed');
    });
  });
});
