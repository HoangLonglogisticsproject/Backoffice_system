import type { AlertSignal } from './alert';

/**
 * The identity of an INCIDENT: one detector, one subject.
 *
 * Deterministic and boring on purpose — it is compared by a unique index, so
 * two signals about the same thing must produce byte-identical keys. The
 * subject id is a UUID and the detector code is a closed token, so `:` cannot
 * occur inside either part and the key cannot be ambiguous.
 */
export const dedupeKeyOf = (
  signal: Pick<AlertSignal, 'detectorCode' | 'subjectType' | 'subjectId'>,
): string => `${signal.detectorCode}:${signal.subjectType}:${signal.subjectId}`;
