import { describe, expect, it } from 'vitest';
import { wrapText } from './canvasText';

/** Every character 10 px wide — wrapping as arithmetic. */
const measure = (value: string) => Array.from(value).length * 10;

describe('wrapText', () => {
  it('breaks between words, filling each line as far as it goes', () => {
    expect(wrapText('Kho lạnh phía sau nhà điều hành', 120, measure)).toEqual(['Kho lạnh', 'phía sau nhà', 'điều hành']);
  });

  it('★ never drops or shortens anything — every word of a long Vietnamese address survives, in order', () => {
    const address =
      'Lô B2-7, Đường số 12, Khu công nghiệp Tân Phú Trung, Xã Tân Phú Trung, Huyện Củ Chi, Thành phố Hồ Chí Minh';
    const lines = wrapText(address, 200, measure);
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.join(' ')).toBe(address);
    expect(lines.every((line) => measure(line) <= 200)).toBe(true);
    expect(lines.join('')).not.toContain('…');
  });

  it('keeps the line breaks somebody typed, and breaks a word longer than the line between characters', () => {
    expect(wrapText('12 Nguyễn Huệ\nPhường Sài Gòn', 400, measure)).toEqual(['12 Nguyễn Huệ', 'Phường Sài Gòn']);
    expect(wrapText('MAWB-176-12345678901', 80, measure)).toEqual(['MAWB-176', '-1234567', '8901']);
  });

  it('★ normalizes to NFC, so a letter and its tone mark are never split across lines', () => {
    const decomposed = 'Nguyễn'.normalize('NFD');
    expect(wrapText(decomposed, 30, measure)).toEqual(['Ngu', 'yễn']);
  });

  it('terminates on a glyph wider than the line itself', () => {
    expect(wrapText('AB', 5, measure)).toEqual(['A', 'B']);
  });
});
