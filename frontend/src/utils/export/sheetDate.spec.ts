import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetDay, sheetInstant } from './sheetDate';

/**
 * Days and instants as Excel serials.
 *
 * ★ THE ZONE MOVES BEFORE THE IMPORT, as in `datetime.spec`: the formatter
 * behind `sheetInstant` is built once, when its module loads, so a fresh module
 * is what proves the conversion ignores the browser's zone.
 */
async function sheetDateUnder(zone: string) {
  process.env.TZ = zone;
  vi.resetModules();
  return import('./sheetDate');
}

describe('sheetDay — a DATE, no zone involved', () => {
  it('★ counts the day from Excel’s epoch — both ends of 02/11–08/11/2026', () => {
    expect(sheetDay('2026-11-02')).toBe(46328);
    expect(sheetDay('2026-11-08')).toBe(46334);
  });

  it('is an empty cell for anything that is not exactly a day', () => {
    expect(sheetDay('')).toBeNull();
    expect(sheetDay(null)).toBeNull();
    expect(sheetDay('08/11/2026')).toBeNull();
  });
});

describe('sheetInstant — an instant, on Hồ Chí Minh’s wall clock', () => {
  const suiteZone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = suiteZone;
  });

  it('★ 16:30 UTC is 23:30 on the 8th; 17:15 UTC is 00:15 on the 9th', () => {
    expect(sheetInstant('2026-11-08T16:30:00.000Z')).toBeCloseTo(46334 + 23.5 / 24, 8);
    expect(sheetInstant('2026-11-08T17:15:00.000Z')).toBeCloseTo(46335 + 0.25 / 24, 8);
  });

  it.each(['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh', 'Pacific/Kiritimati'])(
    '★ writes the same serial whatever zone the browser is in — %s',
    async (zone) => {
      const fresh = await sheetDateUnder(zone);

      expect(fresh.sheetInstant('2026-11-08T16:30:00.000Z')).toBeCloseTo(46334 + 23.5 / 24, 8);
      expect(fresh.sheetDay('2026-11-08')).toBe(46334);
    },
  );

  it('is an empty cell when there is no instant', () => {
    expect(sheetInstant(null)).toBeNull();
    expect(sheetInstant('not a time')).toBeNull();
  });
});
