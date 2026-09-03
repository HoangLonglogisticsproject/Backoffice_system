import { describe, expect, it } from 'vitest';
import { formatMoney, sumMoney } from './money';

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
    ['1500000.00', '1,500,000'],
    ['0.00', '0'],
    ['999.00', '999'],
    ['1000.00', '1,000'],
    ['4500000', '4,500,000'],
  ])('renders %p as %p', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it('★ renders the largest figure NUMERIC(14,2) can hold, exactly', () => {
    // Number("999999999999.99") is representable, but the habit of parsing is
    // what this guards against — the digits come through untouched.
    expect(formatMoney('999999999999.99')).toBe('999,999,999,999.99');
  });

  it('★ keeps a non-zero fraction rather than rounding it away', () => {
    // Hiding it would silently disagree with what is stored.
    // Kept as the two places the column stores, not trimmed to '.5'.
    expect(formatMoney('1500000.50')).toBe('1,500,000.50');
    expect(formatMoney('0.01')).toBe('0.01');
  });

  it('drops a fraction that carries no value, because VND has no subunit in use', () => {
    expect(formatMoney('250000.00')).toBe('250,000');
  });

  it('hands back anything that is not a plain decimal, untouched', () => {
    // The server is the authority on what it sent; a formatter is not the place
    // to discover a contract change, and mangling it would hide one.
    expect(formatMoney('-1')).toBe('-1');
    expect(formatMoney('abc')).toBe('abc');
    expect(formatMoney('')).toBe('');
  });
});

/**
 * ★ SUMMING MUST NOT GO THROUGH A FLOAT EITHER.
 *
 * A driver reviewing three fuel receipts before submitting wants a total. The
 * naive one — `amounts.reduce((a, b) => a + parseFloat(b), 0)` — is right for
 * small figures and wrong for the ones that matter, which is the worst failure
 * mode available: nothing looks broken.
 */
describe('sumMoney', () => {
  it('★ adds the classic float trap exactly', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in float64.
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
  });

  it('adds real trip figures', () => {
    expect(sumMoney(['1500000.00', '200000.00', '300000.00'])).toBe('2000000.00');
  });

  it('carries between minor and major units', () => {
    expect(sumMoney(['0.99', '0.02'])).toBe('1.01');
  });

  it('holds the largest figure the column can store', () => {
    // NUMERIC(14,2) → 12 digits before the point.
    expect(sumMoney(['999999999999.99', '0.01'])).toBe('1000000000000.00');
  });

  it('is zero for no lines, which is what an empty trip shows', () => {
    expect(sumMoney([])).toBe('0.00');
  });

  it('tolerates the shapes a server or a form can produce', () => {
    expect(sumMoney(['1500000', '0.5'])).toBe('1500000.50');
  });

  it('never returns a number', () => {
    expect(typeof sumMoney(['1.00'])).toBe('string');
  });

  // ------------------------------------------------ malformed input --

  /**
   * ★ THESE PIN A CRASH, NOT A PREFERENCE.
   *
   * `BigInt('1,500,000')` throws, and `sumMoney` is called while
   * `ExpensePanel` renders — so one unexpected shape from the server did not
   * show an odd total, it took the whole screen down and left the driver with
   * a blank page and their receipts undeclared.
   */
  it.each([
    ['a thousands separator', '1,500,000'],
    ['letters', 'abc'],
    ['a lone sign', '-'],
    ['digits with a suffix', '12a'],
    ['two decimal points', '1.2.3'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    // Refused rather than answered wrongly: the column is CHECK (amount > 0),
    // `formatMoney` refuses negatives too, and the old arithmetic turned
    // '-1.50' into '-0.50'.
    ['a negative amount', '-1.50'],
  ])('answers null rather than throwing on %s', (_case, bad) => {
    expect(() => sumMoney([bad])).not.toThrow();
    expect(sumMoney([bad])).toBeNull();
  });

  it('refuses the whole total when ONE line is malformed, rather than skipping it', () => {
    // ★ THE DANGEROUS ALTERNATIVE, REJECTED ON PURPOSE. Dropping the bad line
    // would answer '1500000.00' — a total quietly missing somebody's fuel
    // receipt, wrong in the direction nobody checks.
    expect(sumMoney(['1500000.00', 'not-a-number'])).toBeNull();
  });

  it('still totals exactly when every line is well formed', () => {
    // The guard must not cost the guarantee it protects.
    expect(sumMoney(['1500000.00', '0.5', '250000'])).toBe('1750000.50');
  });
});
