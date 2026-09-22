import { alertQuerySchema } from './alert-query.dto';

describe('alert list query', () => {
  it('defaults to the two statuses that are somebody\'s work', () => {
    const parsed = alertQuerySchema.parse({});
    expect(parsed.status).toEqual(['open', 'acknowledged']);
    expect(parsed.severity).toEqual([]);
    expect(parsed.limit).toBe(50);
    expect(parsed.cursor).toBeUndefined();
  });

  it('accepts comma-separated lists, trimming blanks', () => {
    const parsed = alertQuerySchema.parse({ status: 'dismissed, resolved,', severity: 'high,critical' });
    expect(parsed.status).toEqual(['dismissed', 'resolved']);
    expect(parsed.severity).toEqual(['high', 'critical']);
  });

  it('refuses unknown values rather than ignoring them', () => {
    expect(alertQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(alertQuerySchema.safeParse({ severity: 'urgent' }).success).toBe(false);
    expect(alertQuerySchema.safeParse({ tripId: 'not-a-uuid' }).success).toBe(false);
    expect(alertQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(alertQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('coerces the limit and treats an empty cursor as absent', () => {
    const parsed = alertQuerySchema.parse({ limit: '10', cursor: '' });
    expect(parsed.limit).toBe(10);
    expect(parsed.cursor).toBeUndefined();
  });
});
