/**
 * The three things native Canvas 2D needs around it to draw a document: the
 * app's own font, loaded first; text wrapped to a width; and the PNG encoding.
 * No library — the browser already does all of it.
 */

/** Geist, the face the app ships — its Vietnamese subset included (`main.tsx`). */
export const font = (weight: number, size: number): string => `${weight} ${size}px "Geist Variable", sans-serif`;

/**
 * `text` as lines no wider than `maxWidth`. Breaks between words; a single word
 * wider than the line — a long code, a URL — is broken between characters.
 *
 * ★ NOTHING IS DROPPED OR ELLIPSIZED. An address that needs six lines gets six;
 * the document grows instead. Explicit line breaks are kept: addresses are
 * typed on several lines. NFC first, so a Vietnamese letter and its marks are
 * one code point and a character break never splits them.
 */
export function wrapText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.normalize('NFC').trim().split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      // A lone glyph is never split, so even an impossibly wide one terminates.
      while (measure(line) > maxWidth && Array.from(line).length > 1) {
        const chars = Array.from(line);
        let cut = chars.length - 1;
        while (cut > 1 && measure(chars.slice(0, cut).join('')) > maxWidth) cut -= 1;
        lines.push(chars.slice(0, cut).join(''));
        line = chars.slice(cut).join('');
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Loads every face the document uses, for the characters it uses.
 *
 * ★ BEFORE THE FIRST MEASUREMENT. Canvas never waits for a font: text drawn
 * before Geist (or its Vietnamese subset) has loaded comes out in a fallback
 * face, and widths measured in that face wrap the lines wrongly. Passing the
 * document's own text makes the browser fetch exactly the unicode ranges it
 * needs; `fonts.ready` then covers anything already in flight.
 */
export async function loadFonts(fonts: readonly string[], sample: string): Promise<void> {
  await Promise.all(fonts.map((spec) => document.fonts.load(spec, sample)));
  await document.fonts.ready;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the PNG.'))), 'image/png');
  });
}
