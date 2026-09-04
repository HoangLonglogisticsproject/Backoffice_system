import { describe, expect, it } from 'vitest';
import { formatPlate, formatWithCommas, stripCommas, stripPlate } from './format';

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

/**
 * ★ THE FOUR SPELLINGS THE WORKBOOK ACTUALLY HELD.
 *
 * `50H44266` beside `50H-49266`, `51D.65233` beside `51D65233` — the same
 * lorries, typed four ways, none of them findable by looking for the others.
 * These cases are the real data, not invented shapes.
 */
describe('formatPlate', () => {
  it.each([
    // The commonest lorry plate: two digits, one letter, five numbers.
    ['50H49266', '50H-49266'],
    ['51D65233', '51D-65233'],
    // A four-digit registration number.
    ['51C4265', '51C-4265'],
    // Two series letters.
    ['50AA123646', '50AA-123646'],
  ])('puts the break in on %s', (raw, expected) => {
    expect(formatPlate(raw)).toBe(expected);
  });

  it.each([
    ['51D.65233', '51D-65233'],
    ['51D 65233', '51D-65233'],
    ['51D_65233', '51D-65233'],
    ['51D--65233', '51D-65233'],
  ])('replaces whatever separator was typed: %s', (raw, expected) => {
    expect(formatPlate(raw)).toBe(expected);
  });

  it('uppercases the series letter, so one lorry is not two', () => {
    expect(formatPlate('51c-4265')).toBe('51C-4265');
    expect(formatPlate(' 50h49266 ')).toBe('50H-49266');
  });

  /**
   * ★ IDEMPOTENT, AND THAT IS LOAD-BEARING. These values are re-rendered on
   * every keystroke elsewhere on the page; a formatter that shifted its own
   * output would walk the break along the number.
   */
  it('★ is a no-op on its own output', () => {
    for (const raw of ['50H49266', '51C-4265', '50AA-123646', '59X1-12345', '51D.65233']) {
      const once = formatPlate(raw);
      expect(formatPlate(once)).toBe(once);
    }
  });

  /**
   * ★ AN EXISTING SEPARATOR WINS OVER THE RULE.
   *
   * Stripped of punctuation `59X112345` is genuinely ambiguous — `59X-112345`
   * for a lorry, `59X1-12345` for a motorbike — and both are real plates, so no
   * rule can tell them apart. When whoever typed it already said where the break
   * goes, that answer is kept.
   */
  it('★ keeps the break the typist chose, even where the rule would differ', () => {
    expect(formatPlate('59X1-12345')).toBe('59X1-12345');
    // The same characters with no separator: the rule decides, and says so.
    expect(formatPlate('59X112345')).toBe('59X-112345');
  });

  it('ignores a separator that lands somewhere no break can go', () => {
    // Spacing, not a split: `50` is not a head, so the rule decides instead.
    expect(formatPlate('50 H 49266')).toBe('50H-49266');
  });

  /**
   * ⚠ ANYTHING UNRECOGNISED COMES BACK UNTOUCHED — the same contract
   * `formatWithCommas` keeps. Silently reshaping a value it does not understand
   * is how a display turns into a lie about the record.
   */
  it.each([
    ['a foreign or unusual plate', 'ABC-1234'],
    ['still being typed', '51D'],
    ['a registration number too long to be one', '51D1234567890'],
    ['a trailer code', 'RM-51D-65233'],
    ['prose somebody put in the cell', 'chưa có xe'],
  ])('hands back %s unchanged', (_label, raw) => {
    expect(formatPlate(raw)).toBe(raw);
  });

  it('trims, and answers an absent plate with an empty string', () => {
    expect(formatPlate('  ')).toBe('');
    expect(formatPlate('')).toBe('');
    // `vehicle?.plate` is `string | null` on every read model that carries one.
    expect(formatPlate(null)).toBe('');
    expect(formatPlate(undefined)).toBe('');
  });

  it('★ never changes what would be sent back — it only reads', () => {
    // The plate is stored as somebody typed it and matched on nothing. This is
    // a display function; there is no inverse of it anywhere, on purpose.
    const stored = '51D.65233';
    formatPlate(stored);
    expect(stored).toBe('51D.65233');
  });
});

/**
 * ★ WHAT ACTUALLY REACHES THE SERVER.
 *
 * 0011 generates `plate_key` as `upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))`
 * and makes it the unique index. This produces that same string, so the value
 * STORED and the value MATCHED ON are one — which is what stops the catalogue
 * holding two spellings of one lorry again.
 */
describe('stripPlate', () => {
  it.each([
    ['50AA-123333', '50AA123333'],
    ['51D.65233', '51D65233'],
    ['51D 65233', '51D65233'],
    ['50h44266', '50H44266'],
    [' 51c-4265 ', '51C4265'],
  ])('turns %s into the plain plate', (raw, expected) => {
    expect(stripPlate(raw)).toBe(expected);
  });

  it('is a no-op on a plate that never had separators', () => {
    expect(stripPlate('50H44266')).toBe('50H44266');
    expect(stripPlate('')).toBe('');
  });

  it('answers an absent plate with an empty string', () => {
    expect(stripPlate(null)).toBe('');
    expect(stripPlate(undefined)).toBe('');
  });

  /**
   * ★ ROUND-TRIPS FOR A LORRY, AND SAYS WHERE IT DOES NOT.
   *
   * `formatPlate(stripPlate(x))` gives back the same plate for every shape this
   * deployment registers. The one case it cannot is a MOTORBIKE plate, whose
   * series digit is only distinguishable BY the break — stripping throws away
   * the only evidence. Pinned here so the limit is a decision on the record
   * rather than a surprise.
   */
  it('★ round-trips a lorry plate through the display form', () => {
    for (const plate of ['50H-49266', '51C-4265', '50AA-123333', '51D-65233']) {
      expect(formatPlate(stripPlate(plate))).toBe(plate);
    }
  });

  it('⚠ loses the break on a motorbike plate, which is the known limit', () => {
    expect(formatPlate(stripPlate('59X1-12345'))).toBe('59X-112345');
  });
});
