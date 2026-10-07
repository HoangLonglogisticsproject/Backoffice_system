/**
 * What native Canvas 2D needs around it to draw a document: the app's own
 * font, loaded first; text wrapped to a width; the company logo, decoded; and
 * the PNG encoding. No library — the browser already does all of it.
 */

/** Geist, the face the app ships — its Vietnamese subset included (`main.tsx`). */
export const font = (weight: number, size: number): string => `${weight} ${size}px "Geist Variable", sans-serif`;

type Measure = (value: string) => number;

/**
 * `text` as lines no wider than `maxWidth`. Breaks between words; a single word
 * wider than the line — a long code, a URL — is broken between characters.
 *
 * ★ NOTHING IS DROPPED OR ELLIPSIZED. An address that needs six lines gets six;
 * the document grows instead. Explicit line breaks are kept: addresses are
 * typed on several lines. NFC first, so a Vietnamese letter and its marks are
 * one code point and a character break never splits them.
 */
export const wrapText = (text: string, maxWidth: number, measure: Measure): string[] =>
  text
    .normalize('NFC')
    .trim()
    .split('\n')
    .flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, measure));

function wrapParagraph(paragraph: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    const pieces = breakWord(word, maxWidth, measure);
    line = pieces.pop() ?? '';
    lines.push(...pieces);
  }
  return [...lines, line];
}

/** A word as pieces that fit, cut between characters; the last piece stays open for the next word. */
function breakWord(word: string, maxWidth: number, measure: Measure): string[] {
  const pieces: string[] = [];
  let rest = Array.from(word);
  // A lone glyph is never split, so even an impossibly wide one terminates.
  while (rest.length > 1 && measure(rest.join('')) > maxWidth) {
    let cut = rest.length - 1;
    while (cut > 1 && measure(rest.slice(0, cut).join('')) > maxWidth) cut -= 1;
    pieces.push(rest.slice(0, cut).join(''));
    rest = rest.slice(cut);
  }
  return [...pieces, rest.join('')];
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

/**
 * A bundled image, decoded and ready to draw — or `null` when it will not
 * decode. Same-origin (a Vite asset), so the canvas stays exportable.
 *
 * ★ BRANDING IS NOT WORTH A FAILED EXPORT. The caller draws a text-only header
 * on `null`; only the decode is caught here, nothing else.
 */
export async function loadImage(src: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    return null;
  }
  return image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the PNG.'))), 'image/png');
  });
}
