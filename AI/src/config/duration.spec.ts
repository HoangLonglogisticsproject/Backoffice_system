import { parseDuration, toSeconds } from './duration';

describe('duration', () => {
  it.each([
    ['500ms', 500],
    ['45s', 45_000],
    ['30m', 1_800_000],
    ['2h', 7_200_000],
    ['12h', 43_200_000],
    ['0s', 0],
    ['  2h  ', 7_200_000],
  ])('parses %s', (text, expected) => {
    expect(parseDuration(text)).toBe(expected);
  });

  it.each([
    ['a bare number — seconds or milliseconds is a factor of a thousand', '300'],
    ['an unknown unit', '2d'],
    ['a negative value', '-5m'],
    ['a fraction', '1.5h'],
    ['empty', ''],
    ['words', 'two hours'],
    ['a unit with no amount', 'h'],
  ])('refuses %s', (_label, text) => {
    expect(parseDuration(text)).toBeNull();
  });

  it('refuses a value too large to be an exact integer', () => {
    expect(parseDuration(`${Number.MAX_SAFE_INTEGER}h`)).toBeNull();
  });

  it('rounds to seconds for log lines and evidence', () => {
    expect(toSeconds(7_200_000)).toBe(7200);
    expect(toSeconds(1_499)).toBe(1);
    expect(toSeconds(-3_600_000)).toBe(-3600);
  });
});
