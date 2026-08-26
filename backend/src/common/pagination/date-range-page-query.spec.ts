import {
  buildDateRangePageQuerySchema,
  businessToday,
  currentBusinessMonth,
} from './date-range-page-query.dto';
import { toOffsetPage } from './offset-page';

/**
 * The guarantees the offset argument rests on, asserted rather than assumed.
 *
 * ADR-0003 permits offset pagination on this list ONLY because the range is
 * always present and always small. Every test below is a check that one of
 * those two words still holds.
 */

const at = (iso: string) => () => new Date(iso);
const schema = (nowIso: string) => buildDateRangePageQuerySchema(at(nowIso));

const parse = (nowIso: string, query: Record<string, unknown>) =>
  schema(nowIso).safeParse(query);

const ok = (nowIso: string, query: Record<string, unknown>) => {
  const result = parse(nowIso, query);
  if (!result.success) throw new Error(`expected success, got ${result.error.message}`);
  return result.data;
};

const issuePaths = (nowIso: string, query: Record<string, unknown>) => {
  const result = parse(nowIso, query);
  if (result.success) throw new Error('expected failure');
  return result.error.issues.map((issue) => issue.path.join('.'));
};

describe('business calendar', () => {
  it('reads the date in Hồ Chí Minh, not in UTC', () => {
    // 23:00 UTC on 31 August is already 06:00 on 1 September in the office. A
    // server clock would answer August here, and default a dispatcher entering
    // September's first trips into the wrong month.
    expect(businessToday(new Date('2026-08-31T23:00:00Z'))).toBe('2026-09-01');
    expect(businessToday(new Date('2026-08-31T16:00:00Z'))).toBe('2026-08-31');
  });

  it('spans the whole month, whatever its length', () => {
    expect(currentBusinessMonth(new Date('2026-08-15T03:00:00Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(currentBusinessMonth(new Date('2026-02-10T03:00:00Z'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    // Leap year: February has to grow by a day without anybody editing a table.
    expect(currentBusinessMonth(new Date('2028-02-10T03:00:00Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });
});

describe('dateRangePageQuerySchema', () => {
  describe('the range is never absent', () => {
    it('defaults an empty query to the current month', () => {
      expect(ok('2026-08-25T03:00:00Z', {})).toEqual({
        from: '2026-08-01',
        to: '2026-08-31',
        page: 1,
        limit: 50,
      });
    });

    it('completes a half-open range from the month the given end falls in', () => {
      expect(ok('2026-08-25T03:00:00Z', { from: '2026-06-10' })).toMatchObject({
        from: '2026-06-10',
        to: '2026-06-30',
      });
      expect(ok('2026-08-25T03:00:00Z', { to: '2026-06-10' })).toMatchObject({
        from: '2026-06-01',
        to: '2026-06-10',
      });
    });

    it('treats an empty string as absent, not as a malformed date', () => {
      // What a client sends when it forwards a cleared filter input.
      expect(ok('2026-08-25T03:00:00Z', { from: '', to: '' })).toMatchObject({
        from: '2026-08-01',
        to: '2026-08-31',
      });
    });
  });

  describe('the range is never large', () => {
    it('accepts a range of exactly the maximum', () => {
      // 2026-01-01 .. 2026-12-31 inclusive is 365 days; add one to reach 366.
      expect(ok('2026-08-25T03:00:00Z', { from: '2026-01-01', to: '2027-01-01' })).toMatchObject({
        from: '2026-01-01',
      });
    });

    it('refuses a range one day past it, rather than trimming it', () => {
      expect(issuePaths('2026-08-25T03:00:00Z', { from: '2026-01-01', to: '2027-01-02' })).toEqual([
        'to',
      ]);
    });

    it('refuses a whole decade', () => {
      expect(issuePaths('2026-08-25T03:00:00Z', { from: '2020-01-01', to: '2026-12-31' })).toEqual([
        'to',
      ]);
    });
  });

  describe('malformed input', () => {
    it('refuses a backwards range', () => {
      expect(issuePaths('2026-08-25T03:00:00Z', { from: '2026-08-31', to: '2026-08-01' })).toEqual([
        'to',
      ]);
    });

    it('accepts a single-day range, which is not backwards', () => {
      expect(ok('2026-08-25T03:00:00Z', { from: '2026-08-04', to: '2026-08-04' })).toMatchObject({
        from: '2026-08-04',
        to: '2026-08-04',
      });
    });

    it('refuses a date that does not exist, before it reaches PostgreSQL', () => {
      // The regex alone would pass this and the cast would be a 500.
      expect(issuePaths('2026-08-25T03:00:00Z', { from: '2026-02-31' })).toEqual(['from']);
      expect(issuePaths('2026-08-25T03:00:00Z', { from: '2026-13-01' })).toEqual(['from']);
    });

    it('refuses a date in any other notation', () => {
      expect(issuePaths('2026-08-25T03:00:00Z', { from: '04/08/2026' })).toEqual(['from']);
      expect(issuePaths('2026-08-25T03:00:00Z', { from: '2026-8-4' })).toEqual(['from']);
    });

    it('refuses a limit outside the shared contract instead of clamping it', () => {
      expect(issuePaths('2026-08-25T03:00:00Z', { limit: '5000' })).toEqual(['limit']);
      expect(issuePaths('2026-08-25T03:00:00Z', { limit: '0' })).toEqual(['limit']);
    });

    it('refuses a page that is not a whole number at least 1', () => {
      expect(issuePaths('2026-08-25T03:00:00Z', { page: '0' })).toEqual(['page']);
      expect(issuePaths('2026-08-25T03:00:00Z', { page: '1.5' })).toEqual(['page']);
    });

    it('coerces the numbers query strings actually carry', () => {
      expect(ok('2026-08-25T03:00:00Z', { page: '3', limit: '20' })).toMatchObject({
        page: 3,
        limit: 20,
      });
    });
  });
});

describe('toOffsetPage()', () => {
  it('derives the page count rather than trusting a second number', () => {
    expect(toOffsetPage([1, 2, 3], 137, 3, 50)).toEqual({
      items: [1, 2, 3],
      page: 3,
      limit: 50,
      total: 137,
      totalPages: 3,
    });
  });

  it('reports no pages at all for an empty result, not "page 1 of 0"', () => {
    expect(toOffsetPage([], 0, 1, 50)).toMatchObject({ total: 0, totalPages: 0 });
  });

  it('keeps the real total on a page past the end — the client recovers from it', () => {
    expect(toOffsetPage([], 137, 99, 50)).toMatchObject({ page: 99, total: 137, totalPages: 3 });
  });

  it('rounds a partial last page up', () => {
    expect(toOffsetPage([], 51, 1, 50).totalPages).toBe(2);
    expect(toOffsetPage([], 50, 1, 50).totalPages).toBe(1);
  });
});
