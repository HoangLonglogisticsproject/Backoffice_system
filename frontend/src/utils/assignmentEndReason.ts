import type { TranslationKey } from '@/types/translate';

/**
 * Why a dispatch turn ended, as a person should read it.
 *
 * ★ TWO KINDS OF REASON SHARE THE COLUMN. Most are typed by a dispatcher when
 * they swap or remove a driver — "A báo ốm." — and are shown exactly as typed.
 * A few are written by the SYSTEM as a fixed token: `historical_entry` marks
 * the crew of a trip recorded after it ran. The token stays as stored (it is
 * audit data); only its wording is decided here.
 *
 * A `Map`, not an object literal: a typed reason such as "constructor" must
 * never find something on `Object.prototype`.
 */
const SYSTEM_REASONS = new Map<string, TranslationKey>([['historical_entry', 'historicalEntryReason']]);

export const endReasonText = (reason: string, t: (key: TranslationKey) => string): string => {
  const key = SYSTEM_REASONS.get(reason);
  return key ? t(key) : reason;
};
