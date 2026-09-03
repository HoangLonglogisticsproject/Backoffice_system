import { describe, expect, it } from 'vitest';
import { formatWithCommas, stripCommas } from './format';

describe('formatWithCommas', () => {
  it.each([
    ['1500000', '1,500,000'],
    ['0', '0'],
    ['999', '999'],
    ['1000', '1,000'],
    ['999999999999', '999,999,999,999'],
  ])('groups %p as %p', (input, expected) => {
    expect(formatWithCommas(input)).toBe(expected);
  });

  /**
   * ★ THE CASE THE WHOLE DESIGN RESTS ON.
   *
   * `MoneyInput` is controlled: the value it renders is the value it formats,
   * and React hands that same string back on the next render. If a second pass
   * grouped the commas that are already there, every keystroke would double
   * them — `1,500,000` → `1,,5,00,,000` — and the field would be unusable.
   */
  it('★ is idempotent — formatting its own output changes nothing', () => {
    let value = '1500000';
    for (let pass = 0; pass < 3; pass += 1) value = formatWithCommas(value);
    expect(value).toBe('1,500,000');
  });

  describe('★ survives a number that is still being typed', () => {
    it('keeps a trailing point rather than swallowing it', () => {
      // Eating it would make the decimal point untypeable: the character would
      // vanish the instant it was pressed.
      expect(formatWithCommas('1500000.')).toBe('1,500,000.');
    });

    it('keeps a fraction exactly as typed, trailing zeros included', () => {
      // '1500.50' must not become '1,500.5' — the person is mid-word, and the
      // column stores two places anyway.
      expect(formatWithCommas('1500.50')).toBe('1,500.50');
      expect(formatWithCommas('1500.0')).toBe('1,500.0');
    });

    it('leaves an empty field empty', () => {
      expect(formatWithCommas('')).toBe('');
      expect(formatWithCommas('   ')).toBe('');
    });
  });

  it('hands back anything that is not a plain decimal, untouched', () => {
    // Same contract as `formatMoney`: mangling an unexpected shape would hide
    // it, and this function is not the place to discover one.
    expect(formatWithCommas('-1')).toBe('-1');
    expect(formatWithCommas('abc')).toBe('abc');
    expect(formatWithCommas('1.2.3')).toBe('1.2.3');
    expect(formatWithCommas('12a')).toBe('12a');
    expect(formatWithCommas('1e6')).toBe('1e6');
  });

  it('accepts a number, for the callers that legitimately hold one', () => {
    // Counts and quantities — never money, which is a string end to end.
    expect(formatWithCommas(1500000)).toBe('1,500,000');
    expect(formatWithCommas(0)).toBe('0');
  });
});

describe('stripCommas', () => {
  it('gives back the plain decimal the server expects', () => {
    expect(stripCommas('1,500,000')).toBe('1500000');
    expect(stripCommas('1,500,000.50')).toBe('1500000.50');
  });

  it('is a no-op on a string that never had separators', () => {
    expect(stripCommas('1500000')).toBe('1500000');
    expect(stripCommas('')).toBe('');
  });

  /**
   * ★ ROUND-TRIPS EXACTLY, DIGIT FOR DIGIT.
   *
   * This is the guarantee that lets the form keep display and payload in one
   * state: what is shown is what is sent, with only the commas between them.
   */
  it('★ round-trips with formatWithCommas', () => {
    for (const plain of ['1500000', '1500000.50', '0.01', '999999999999.99']) {
      expect(stripCommas(formatWithCommas(plain))).toBe(plain);
    }
  });
});
