import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCalendarDay, formatCalendarWeekday, formatTimeOnDay } from './datetime';

/**
 * The module under a process already in `zone`.
 *
 * ★ THE ZONE MUST MOVE BEFORE THE IMPORT. `datetime.ts` builds each formatter
 * once and keeps it, and an `Intl.DateTimeFormat` fixes its zone when it is
 * built. The statically imported copy above has already built its formatters
 * under the suite's UTC, so changing `TZ` afterwards and asking it again proves
 * nothing — the case would pass with the `timeZone: 'UTC'` pin deleted. A fresh
 * module builds fresh formatters under the zone that is actually set.
 */
async function datetimeUnder(zone: string) {
  process.env.TZ = zone;
  vi.resetModules();
  return import('./datetime');
}

describe('formatCalendarWeekday', () => {
  const suiteZone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = suiteZone;
  });

  it('names the day in Vietnamese — the schedule subtitle and day headings', () => {
    expect(formatCalendarWeekday('2026-08-30', 'vi')).toBe('Chủ Nhật, 30/08/2026');
  });

  it('names it in English', () => {
    expect(formatCalendarWeekday('2026-08-30', 'en')).toBe('Sunday, 08/30/2026');
  });

  it.each(['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    '★ never shifts the day, even with the process in %s',
    async (zone) => {
      const fresh = await datetimeUnder(zone);

      expect(fresh.formatCalendarWeekday('2026-01-01', 'vi')).toBe('Thứ Năm, 01/01/2026');
      expect(fresh.formatCalendarDay('2026-01-01', 'vi')).toBe('1/1/2026');
    },
  );

  it('★ holds where a naive Date would already have slipped to the day before', async () => {
    // `scheduledOn` is a DATE, not an instant. Read as one, 2026-01-01 is
    // New Year's Eve for anyone west of UTC — the guard proves this process
    // really did move before the formatters were built.
    const fresh = await datetimeUnder('America/Los_Angeles');

    expect(new Date('2026-01-01').getDate()).toBe(31);
    expect(fresh.formatCalendarWeekday('2026-01-01', 'vi')).toBe('Thứ Năm, 01/01/2026');
    expect(fresh.formatCalendarDay('2026-01-01', 'vi')).toBe('1/1/2026');
  });
});

describe('formatCalendarDay', () => {
  it('shares the same day, without the weekday', () => {
    expect(formatCalendarDay('2026-08-30', 'vi')).toBe('30/8/2026');
  });
});

describe('a value that is not a real calendar day', () => {
  // ★ Shown raw rather than rolled into a neighbouring day, so a server-side
  // mistake stays visible.
  it.each(['2026-8-30', '30/08/2026', '', '2026-02-30', '2026-13-01'])('returns %j as it arrived', (day) => {
    expect(formatCalendarWeekday(day, 'vi')).toBe(day);
    expect(formatCalendarDay(day, 'vi')).toBe(day);
  });
});

describe('formatTimeOnDay', () => {
  // The suite runs in UTC (vite.config.ts), so the wall clock is the Z clock.
  it.each([
    ['vi', '01:05 · 30/8/2026'],
    ['en', '01:05 AM · 8/30/2026'],
  ] as const)('puts the clock first, then the day, in %s', (language, expected) => {
    expect(formatTimeOnDay('2026-08-30T01:05:00.000Z', language)).toBe(expected);
  });

  it.each(['vi', 'en'] as const)('never shows seconds, even when the instant has them (%s)', (language) => {
    const rendered = formatTimeOnDay('2026-08-30T01:05:59.999Z', language);

    expect(rendered).toContain('01:05');
    expect(rendered).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it.each(['not-a-date', '', '2026-13-45T99:00:00Z'])('returns %j as it arrived when it is not an instant', (iso) => {
    expect(formatTimeOnDay(iso, 'vi')).toBe(iso);
  });
});
