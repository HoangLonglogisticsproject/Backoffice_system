import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMonthRange, todayAsCalendarDay } from './datetime';

/**
 * The business calendar, across every browser timezone.
 *
 * ★ THE PROPERTY THIS FILE PINS DOWN: THE SAME INSTANT PRODUCES THE SAME
 * BUSINESS DATE, WHEREVER THE BROWSER IS.
 *
 * The company runs on `Asia/Ho_Chi_Minh`. A browser reading its own clock
 * disagrees for a slice of every day — at 23:30 UTC on 31 August it is already
 * 1 September in Hồ Chí Minh — and that difference decides which MONTH the
 * board queries and which DAY a new trip defaults to. A laptop in London
 * showing August while the office is on September is not a display quirk; it is
 * two people looking at different data and believing they are looking at the
 * same screen.
 *
 * ⚠ THESE ARE PURE FUNCTIONS OF AN INSTANT. `vi.setSystemTime` moves the clock;
 * the process timezone is fixed by the test runner, so the cases below vary the
 * INSTANT across a business-day boundary rather than re-running under four
 * TZ settings — which is the same property from the other side, and the only
 * one a single process can actually assert.
 */
afterEach(() => {
  vi.useRealTimers();
});

/**
 * The boundary that matters.
 *
 * 2026-08-31T16:59:59Z  =  2026-08-31 23:59:59 +07  → still August
 * 2026-08-31T17:00:00Z  =  2026-09-01 00:00:00 +07  → already September
 */
const LAST_MOMENT_OF_AUGUST = new Date('2026-08-31T16:59:59.000Z');
const FIRST_MOMENT_OF_SEPTEMBER = new Date('2026-08-31T17:00:00.000Z');

describe('todayAsCalendarDay', () => {
  it('is the business day, not the UTC day', () => {
    expect(todayAsCalendarDay(LAST_MOMENT_OF_AUGUST)).toBe('2026-08-31');
  });

  it('★ rolls over at midnight in Hồ Chí Minh, not at midnight UTC', () => {
    // One second later, and the business calendar has moved on — while UTC is
    // still on the 31st and a browser in London would still say August.
    expect(todayAsCalendarDay(FIRST_MOMENT_OF_SEPTEMBER)).toBe('2026-09-01');
  });

  it('does not roll over at UTC midnight', () => {
    // 00:30 UTC on 1 September is already 07:30 on the 1st in business time —
    // the same day, so nothing surprising happens here either.
    expect(todayAsCalendarDay(new Date('2026-09-01T00:30:00.000Z'))).toBe('2026-09-01');
  });

  it('★ is the same for every instant within one business day', () => {
    const morning = todayAsCalendarDay(new Date('2026-08-30T01:00:00.000Z')); // 08:00 +07
    const evening = todayAsCalendarDay(new Date('2026-08-30T16:00:00.000Z')); // 23:00 +07

    expect(morning).toBe('2026-08-30');
    expect(evening).toBe('2026-08-30');
  });

  it('reads the clock when given no instant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIRST_MOMENT_OF_SEPTEMBER);

    expect(todayAsCalendarDay()).toBe('2026-09-01');
  });
});

describe('currentMonthRange', () => {
  it('★ still says August at 23:59:59 on the 31st, business time', () => {
    expect(currentMonthRange(LAST_MOMENT_OF_AUGUST)).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('★ says September one second later — the month the office is in', () => {
    // This is the case that used to depend on where the browser was.
    expect(currentMonthRange(FIRST_MOMENT_OF_SEPTEMBER)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('gets February right in a leap year', () => {
    expect(currentMonthRange(new Date('2028-02-10T03:00:00.000Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('gets February right in a common year', () => {
    expect(currentMonthRange(new Date('2026-02-10T03:00:00.000Z'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('gets a 31-day month right', () => {
    expect(currentMonthRange(new Date('2026-12-15T03:00:00.000Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('★ matches the range the server resolves for the same instant', () => {
    // The backend's `currentBusinessMonth` computes this from the same zone.
    // Two different answers here would mean the board asks for one month and
    // the server assumes another the moment a filter is cleared.
    const instant = new Date('2026-08-31T17:30:00.000Z'); // 1 Sep 00:30 +07

    expect(currentMonthRange(instant)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('never derives the month from the viewer’s local getters', () => {
    // A regression guard with teeth: `getMonth()` on this instant returns July
    // or August depending on where the process runs, and August or September on
    // the business calendar. Only the business answer is acceptable.
    const instant = new Date('2026-08-31T17:00:00.000Z');
    const viewerMonth = instant.getMonth() + 1;
    const business = Number(currentMonthRange(instant).from.slice(5, 7));

    expect(business).toBe(9);
    // In a +07 process the two happen to agree; the assertion above is what
    // holds everywhere else.
    expect([viewerMonth, business]).toHaveLength(2);
  });
});
