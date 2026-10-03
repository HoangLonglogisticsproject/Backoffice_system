import { describe, expect, it } from 'vitest';
import {
  PERIODS,
  blockedPicks,
  canonicalOf,
  displayCalendarDate,
  displayClock12,
  maskCalendarDate,
  parseCalendarDate,
  parseClockTime,
  partsOf,
} from './dateTimeText';

describe('the picked hour — 12-hour on screen, 24-hour HH:mm in the form', () => {
  it.each([
    ['09:30 AM', '09:30'],
    ['09:30 PM', '21:30'],
    ['9:28 pm', '21:28'],
    ['12:00 AM', '00:00'],
    ['12:15 PM', '12:15'],
    ['21:30', '21:30'],
    ['0930', '09:30'],
  ])('reads %s as %s', (written, canonical) => {
    expect(parseClockTime(written)).toBe(canonical);
  });

  it.each(['13:00 PM', '0:30 AM', '24:00', '09:60', '', '9:3'])('refuses %j', (written) => {
    expect(parseClockTime(written)).toBeNull();
  });

  it('★ AM comes before PM, always — not the browser’s choice', () => {
    expect(PERIODS).toEqual(['AM', 'PM']);
  });

  it('★ 09 : 30 : AM is 09:30, 09 : 30 : PM is 21:30, 09 : 28 : PM is 21:28', () => {
    expect(canonicalOf({ hour: 9, minute: 30, period: 'AM' })).toBe('09:30');
    expect(canonicalOf({ hour: 9, minute: 30, period: 'PM' })).toBe('21:30');
    expect(canonicalOf({ hour: 9, minute: 28, period: 'PM' })).toBe('21:28');
    expect(canonicalOf({ hour: 12, minute: 5, period: 'AM' })).toBe('00:05');
    expect(canonicalOf({ hour: 9, minute: null, period: 'PM' })).toBeNull();
  });

  it('★ every minute of the day goes round the picker and back unchanged — 00 to 59, every hour', () => {
    for (let minuteOfDay = 0; minuteOfDay < 24 * 60; minuteOfDay += 1) {
      const hour = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
      const minute = String(minuteOfDay % 60).padStart(2, '0');
      expect(canonicalOf(partsOf(`${hour}:${minute}`))).toBe(`${hour}:${minute}`);
    }
  });

  it('shows the closed field 12-hour: 09:30 PM, 12:05 AM — half chosen as 09:-- --', () => {
    expect(displayClock12(partsOf('21:30'))).toBe('09:30 PM');
    expect(displayClock12(partsOf('09:30'))).toBe('09:30 AM');
    expect(displayClock12(partsOf('00:05'))).toBe('12:05 AM');
    expect(displayClock12({ hour: 9, minute: null, period: null })).toBe('09:-- --');
    expect(displayClock12(partsOf(''))).toBe('');
  });

  describe('★ the current minute is the floor — at 22:06 today', () => {
    const at2206 = (parts: Parameters<typeof blockedPicks>[1]) => blockedPicks('22:06', parts);

    it('closes AM, and every PM hour whose last minute is gone', () => {
      const none = { hour: null, minute: null, period: null };
      expect(at2206(none).period('AM')).toBe(true);
      expect(at2206(none).period('PM')).toBe(false);
      expect([9, 10, 11, 12].map(at2206(none).hour)).toEqual([true, false, false, true]);
    });

    it('★ at 10 PM: 22:05 closed, 22:06 and 22:07 open', () => {
      const tenPm = at2206({ hour: 10, minute: null, period: 'PM' });
      expect([5, 6, 7].map(tenPm.minute)).toEqual([true, false, false]);
    });

    it('leaves a later day — no floor — wholly open', () => {
      const free = blockedPicks(undefined, { hour: 1, minute: null, period: 'AM' });
      expect(free.hour(1) || free.minute(0) || free.period('AM')).toBe(false);
    });
  });
});

describe('the date text — dd/mm/yyyy, day first', () => {
  it.each([
    ['03/10/2026', '2026-10-03'],
    ['3/10/2026', '2026-10-03'],
    ['03102026', '2026-10-03'],
    ['2026-10-03', '2026-10-03'],
    ['29/02/2028', '2028-02-29'],
  ])('reads %s as %s', (typed, canonical) => {
    expect(parseCalendarDate(typed)).toBe(canonical);
  });

  it.each(['31/02/2026', '29/02/2027', '10/13/2026', '03/10/26', '', '2026-13-01'])('refuses %j', (typed) => {
    expect(parseCalendarDate(typed)).toBeNull();
  });

  it('puts the slashes in as the digits arrive, and leaves a pasted ISO day alone', () => {
    expect(['0', '03', '031', '0310', '03102', '03102026'].map(maskCalendarDate)).toEqual([
      '0',
      '03',
      '03/1',
      '03/10',
      '03/10/2',
      '03/10/2026',
    ]);
    expect(maskCalendarDate('3/10/2026')).toBe('3/10/2026');
    expect(maskCalendarDate('2026-10-03')).toBe('2026-10-03');
  });

  it('★ keeps every keystroke when typed one digit at a time onto what the field shows', () => {
    const typeInto = (mask: (text: string) => string, keys: string) =>
      [...keys].reduce((shown, key) => mask(shown + key), '');
    expect(typeInto(maskCalendarDate, '05102026')).toBe('05/10/2026');
    expect(typeInto(maskCalendarDate, '3/10/2026')).toBe('3/10/2026');
    expect(parseCalendarDate(typeInto(maskCalendarDate, '05102026'))).toBe('2026-10-05');
  });

  it('shows a canonical day day-first', () => {
    expect(displayCalendarDate('2026-10-03')).toBe('03/10/2026');
    expect(displayCalendarDate('')).toBe('');
  });
});
