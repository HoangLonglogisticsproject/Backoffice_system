/**
 * ★ WHICH LEGACY `confirmed` TRIPS MAY BE CLOSED AS `finished` — and which wait
 * for a person. Pure rules, shared by the dry run and by the re-check each id
 * gets under its lock before anything is written.
 */

/** How the dry run sees a stored `confirmed` trip. */
export type LegacyClassification =
  | 'ELIGIBLE'
  | 'CONFLICT_PENDING_COMPLETION'
  | 'CONFLICT_CLOSED_PARTIAL'
  | 'SKIPPED_ARCHIVED';

/**
 * The closing stamp as stored. PARTIAL — one half without the other — is what
 * `trip_schedules_closed_state` (0017) forbids; it is classified anyway, and
 * never completed, because pairing an old timestamp with a new actor (or the
 * reverse) would write a stamp that is true of nobody.
 */
export type ClosedMetadata = 'CLOSED_COMPLETE' | 'CLOSED_MISSING' | 'CLOSED_PARTIAL';

/** What `apply` did with one approved id, re-read under its lock. */
export type LegacyOutcome =
  | 'NORMALIZED'
  | 'CONFLICT_PENDING_COMPLETION'
  | 'CONFLICT_CLOSED_PARTIAL'
  | 'SKIPPED_ARCHIVED'
  | 'SKIPPED_ALREADY_FINISHED'
  | 'SKIPPED_MISSING'
  | 'SKIPPED_STATE_CHANGED';

export const closedMetadataOf = (closedAt: unknown, closedBy: unknown): ClosedMetadata => {
  if (closedAt != null && closedBy != null) return 'CLOSED_COMPLETE';
  return closedAt == null && closedBy == null ? 'CLOSED_MISSING' : 'CLOSED_PARTIAL';
};

/** Archived first, then a waiting driver request, then a half stamp: each keeps the trip as it is. */
export const classify = (trip: {
  archived: boolean;
  pendingRequests: number;
  closedMetadata: ClosedMetadata;
}): LegacyClassification => {
  if (trip.archived) return 'SKIPPED_ARCHIVED';
  if (trip.pendingRequests > 0) return 'CONFLICT_PENDING_COMPLETION';
  return trip.closedMetadata === 'CLOSED_PARTIAL' ? 'CONFLICT_CLOSED_PARTIAL' : 'ELIGIBLE';
};
