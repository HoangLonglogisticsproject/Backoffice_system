import { classify, closedMetadataOf } from './legacy-confirmed';

describe('legacy `confirmed` classification — what may be closed, and what waits for a person', () => {
  it('reads the closing stamp as complete, missing or PARTIAL — never as "good enough"', () => {
    expect(closedMetadataOf(new Date(), 'u1')).toBe('CLOSED_COMPLETE');
    expect(closedMetadataOf(null, null)).toBe('CLOSED_MISSING');
    expect(closedMetadataOf(new Date(), null)).toBe('CLOSED_PARTIAL');
    expect(closedMetadataOf(null, 'u1')).toBe('CLOSED_PARTIAL');
  });

  it('★ is ELIGIBLE only when not archived, nothing is pending, and the stamp is whole or absent', () => {
    const base = { archived: false, pendingRequests: 0 } as const;
    expect(classify({ ...base, closedMetadata: 'CLOSED_MISSING' })).toBe('ELIGIBLE');
    expect(classify({ ...base, closedMetadata: 'CLOSED_COMPLETE' })).toBe('ELIGIBLE');
    // A half stamp would be completed with a new actor or a new time — refused, for review.
    expect(classify({ ...base, closedMetadata: 'CLOSED_PARTIAL' })).toBe('CONFLICT_CLOSED_PARTIAL');
    expect(classify({ ...base, pendingRequests: 1, closedMetadata: 'CLOSED_MISSING' })).toBe(
      'CONFLICT_PENDING_COMPLETION',
    );
    // Archived outranks everything: never unarchived, never closed here.
    expect(classify({ archived: true, pendingRequests: 1, closedMetadata: 'CLOSED_PARTIAL' })).toBe('SKIPPED_ARCHIVED');
  });
});
