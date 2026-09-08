import { describe, expect, it } from 'vitest';
import { formatDistance } from './distance';

/** `\s` because `Intl` may separate the unit with a non-breaking space. */
describe('formatDistance', () => {
  it('rounds metres to whole numbers', () => {
    expect(formatDistance(42.37, 'en')).toMatch(/^42\sm$/);
    expect(formatDistance(0.4, 'vi')).toMatch(/^0\sm$/);
  });

  it('switches to kilometres with one decimal from 1000 m', () => {
    expect(formatDistance(1234, 'en')).toMatch(/^1\.2\skm$/);
    expect(formatDistance(1234, 'vi')).toMatch(/^1,2\skm$/);
    expect(formatDistance(999.6, 'en')).toMatch(/^1000\sm$/);
  });
});
