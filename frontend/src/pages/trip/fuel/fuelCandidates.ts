import type { FuelCandidate } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';

/** Why a cost cannot take this receipt — or `null` when it can. The server refuses the same. */
export const blockedReason = (candidate: FuelCandidate): TranslationKey | null => {
  if (candidate.backing.voided) return 'fuelBlockedVoided';
  if (candidate.conflicts.length > 0) return 'fuelBlockedConflicts';
  return null;
};

/**
 * Other fills that already hold this receipt's image or document — each must
 * be confirmed as a different fill before it goes onto the picked one.
 */
export const sharingFills = (target: FuelCandidate, matches: readonly FuelCandidate[]): FuelCandidate[] =>
  matches.filter(
    (match) =>
      match.fuelTransactionId !== null &&
      match.fuelTransactionId !== target.fuelTransactionId &&
      (match.level === 'exact' || match.level === 'high'),
  );
