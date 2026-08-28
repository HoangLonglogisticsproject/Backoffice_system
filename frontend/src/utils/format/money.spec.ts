import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

/**
 * ★ THE FORMATTER MUST NEVER PARSE.
 *
 * Amounts arrive as decimal strings from a `NUMERIC(14,2)` column, chosen
 * because floats cannot hold decimals exactly. A formatter that went through
 * `Number()` would be correct for small figures and wrong for the ones that
 * matter, which is the worst possible failure mode — so these cases pin the
 * largest value the column can hold and the fractions a float would mangle.
 */
describe('formatMoney', () => {
  it.each([
    ['1500000.00', '1.500.000'],
    ['0.00', '0'],
    ['999.00', '999'],
    ['1000.00', '1.000'],
    ['4500000', '4.500.000'],
  ])('renders %p as %p', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it('★ renders the largest figure NUMERIC(14,2) can hold, exactly', () => {
    // Number("999999999999.99") is representable, but the habit of parsing is
    // what this guards against — the digits come through untouched.
    expect(formatMoney('999999999999.99')).toBe('999.999.999.999,99');
  });

  it('★ keeps a non-zero fraction rather than rounding it away', () => {
    // Hiding it would silently disagree with what is stored.
    // Kept as the two places the column stores, not trimmed to ',5'.
    expect(formatMoney('1500000.50')).toBe('1.500.000,50');
    expect(formatMoney('0.01')).toBe('0,01');
  });

  it('drops a fraction that carries no value, because VND has no subunit in use', () => {
    expect(formatMoney('250000.00')).toBe('250.000');
  });

  it('hands back anything that is not a plain decimal, untouched', () => {
    // The server is the authority on what it sent; a formatter is not the place
    // to discover a contract change, and mangling it would hide one.
    expect(formatMoney('-1')).toBe('-1');
    expect(formatMoney('abc')).toBe('abc');
    expect(formatMoney('')).toBe('');
  });
});
