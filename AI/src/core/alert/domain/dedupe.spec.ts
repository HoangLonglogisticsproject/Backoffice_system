import { dedupeKeyOf } from './dedupe';

describe('dedupe key', () => {
  const subjectId = '11111111-1111-4111-8111-111111111111';

  it('is deterministic over detector, subject type and subject id', () => {
    const a = dedupeKeyOf({ detectorCode: 'UNASSIGNED_TRIP', subjectType: 'trip', subjectId });
    const b = dedupeKeyOf({ detectorCode: 'UNASSIGNED_TRIP', subjectType: 'trip', subjectId });
    expect(a).toBe(b);
    expect(a).toBe(`UNASSIGNED_TRIP:trip:${subjectId}`);
  });

  it('ignores everything else about a signal', () => {
    const base = { detectorCode: 'D', subjectType: 'assignment' as const, subjectId };
    expect(dedupeKeyOf({ ...base, severity: 'high', title: 'x' } as never)).toBe(dedupeKeyOf(base));
  });

  it('changes when any of the three parts changes', () => {
    const base = { detectorCode: 'D', subjectType: 'trip' as const, subjectId };
    expect(dedupeKeyOf({ ...base, detectorCode: 'E' })).not.toBe(dedupeKeyOf(base));
    expect(dedupeKeyOf({ ...base, subjectType: 'assignment' })).not.toBe(dedupeKeyOf(base));
    expect(dedupeKeyOf({ ...base, subjectId: '22222222-2222-4222-8222-222222222222' })).not.toBe(dedupeKeyOf(base));
  });
});
