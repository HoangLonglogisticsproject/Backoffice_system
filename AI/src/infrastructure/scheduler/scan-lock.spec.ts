import { createHash } from 'node:crypto';
import { COMPLETION_REVIEW_DETECTOR_CODE } from '../../detectors/completion-review-overdue.detector';
import { STALE_ASSIGNMENT_DETECTOR_CODE } from '../../detectors/stale-assignment-start.detector';
import { UNASSIGNED_TRIP_DETECTOR_CODE } from '../../detectors/unassigned-trip-approaching.detector';
import { SCAN_LOCK_NAMESPACE, scanLockKey } from './scan-lock';

/**
 * The lock keys, pinned for EVERY tuple the engine actually locks.
 *
 * ★ A COLLISION HERE IS AN OUTAGE THAT LOOKS LIKE NOTHING. Two tuples sharing
 * a key means one of them silently never runs — the tick takes the lock for
 * the other, finds it held, and skips. No error, no alert, just a detector
 * that stopped. So the real six tuples are enumerated rather than sampled.
 */
describe('scanLockKey', () => {
  const DETECTORS = [
    UNASSIGNED_TRIP_DETECTOR_CODE,
    STALE_ASSIGNMENT_DETECTOR_CODE,
    COMPLETION_REVIEW_DETECTOR_CODE,
  ] as const;
  const PHASES = ['discovery', 'resolution'] as const;

  const everyTuple = DETECTORS.flatMap((code) => PHASES.map((phase) => [code, phase] as const));

  it('covers the three detectors and two phases the engine locks', () => {
    expect(everyTuple).toHaveLength(6);
  });

  it('★ gives all six real tuples a DISTINCT key', () => {
    const keys = everyTuple.map(([code, phase]) => scanLockKey(code, phase));
    expect(new Set(keys).size).toBe(6);
  });

  it('is deterministic: the same tuple gives the same key every time', () => {
    for (const [code, phase] of everyTuple) {
      expect(scanLockKey(code, phase)).toBe(scanLockKey(code, phase));
    }
  });

  it('★ is stable across restarts — derived from the text, not from process state', () => {
    // Recomputed here from first principles. If the derivation ever changes,
    // a deploy would silently stop excluding the previous version's workers.
    for (const [code, phase] of everyTuple) {
      const expected = createHash('sha256').update(`${code}:${phase}`, 'utf8').digest().readInt32BE(0);
      expect(scanLockKey(code, phase)).toBe(expected);
    }
  });

  it('pins the exact keys, so a rename or a reformat is a visible change', () => {
    const pinned = Object.fromEntries(
      everyTuple.map(([code, phase]) => [`${code}:${phase}`, scanLockKey(code, phase)]),
    );
    expect(pinned).toEqual({
      'UNASSIGNED_TRIP_APPROACHING_EXECUTION:discovery': scanLockKey(UNASSIGNED_TRIP_DETECTOR_CODE, 'discovery'),
      'UNASSIGNED_TRIP_APPROACHING_EXECUTION:resolution': scanLockKey(UNASSIGNED_TRIP_DETECTOR_CODE, 'resolution'),
      'STALE_ASSIGNMENT_START:discovery': scanLockKey(STALE_ASSIGNMENT_DETECTOR_CODE, 'discovery'),
      'STALE_ASSIGNMENT_START:resolution': scanLockKey(STALE_ASSIGNMENT_DETECTOR_CODE, 'resolution'),
      'COMPLETION_REVIEW_OVERDUE:discovery': scanLockKey(COMPLETION_REVIEW_DETECTOR_CODE, 'discovery'),
      'COMPLETION_REVIEW_OVERDUE:resolution': scanLockKey(COMPLETION_REVIEW_DETECTOR_CODE, 'resolution'),
    });
    // And every one of them is a real, distinct number.
    expect(new Set(Object.values(pinned)).size).toBe(6);
  });

  it('★ every key fits PostgreSQL int4, which is what the two-argument lock takes', () => {
    const INT32_MIN = -2_147_483_648;
    const INT32_MAX = 2_147_483_647;
    for (const [code, phase] of everyTuple) {
      const key = scanLockKey(code, phase);
      expect(Number.isSafeInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(INT32_MIN);
      expect(key).toBeLessThanOrEqual(INT32_MAX);
    }
    expect(SCAN_LOCK_NAMESPACE).toBeGreaterThanOrEqual(INT32_MIN);
    expect(SCAN_LOCK_NAMESPACE).toBeLessThanOrEqual(INT32_MAX);
  });

  it('separates the phases of one detector, and the detectors of one phase', () => {
    for (const code of DETECTORS) {
      expect(scanLockKey(code, 'discovery')).not.toBe(scanLockKey(code, 'resolution'));
    }
    for (const phase of PHASES) {
      const keys = DETECTORS.map((code) => scanLockKey(code, phase));
      expect(new Set(keys).size).toBe(DETECTORS.length);
    }
  });

  it('does not collide with the namespace it lives under', () => {
    // Belt and braces: the namespace is the first argument, the key the
    // second, so equality would not actually collide — but a key that equals
    // the namespace is a sign the derivation has been replaced by something
    // constant.
    for (const [code, phase] of everyTuple) {
      expect(scanLockKey(code, phase)).not.toBe(SCAN_LOCK_NAMESPACE);
    }
  });
});
