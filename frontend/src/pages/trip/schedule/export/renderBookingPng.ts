import logoUrl from '@/assets/img/LOGO.png';
import type { BookingDocument, DocumentBlock } from './bookingExportModel';
import { canvasToPng, font, loadFonts, loadImage, wrapText } from './canvasText';

/**
 * The booking document → a PNG `Blob`, drawn with native Canvas 2D.
 *
 * ★ DRAWN, NOT SCREENSHOTTED. Nothing here reads the page: the image is laid
 * out from the document model alone, so it cannot pick up a price column, a
 * badge or a button from the screen behind it.
 *
 * ★ DETERMINISTIC: fixed logical width, 2× pixels, white ground, the app's own
 * font loaded before the first measurement, and no clock — the export instant
 * is already a string in the model. The height is whatever the content needs:
 * one routine measures, then draws, so nothing is ever cropped.
 */

const WIDTH = 720;
const PAD = 40;
const CONTENT = WIDTH - PAD * 2;
const LABEL = 150;
const SCALE = 2;
// ponytail: iOS Safari refuses a canvas above ~16.7 M pixels; a long document trades 2× for less, never below 1×.
const MAX_PIXELS = 16_000_000;
/**
 * ★ THE READABILITY FLOOR. The PNG is never drawn below 1×, so its smallest
 * text (the 12 px labels and footer) is at least 12 real pixels high and the
 * body 15. Past the budget the image grows taller at 1× rather than shrinking;
 * reaching that needs ~22 000 px of content — far beyond every trip field's
 * 4 000-character cap — and a browser that cannot allocate it says so in the
 * dialog instead of handing out unreadable text.
 */
const MIN_SCALE = 1;

/** The company logo's height in the header; its width follows its own aspect ratio. */
const LOGO_HEIGHT = 44;

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const ACCENT = '#2563eb';
const WARN = '#b45309';

type Style = { font: string; line: number };
const TYPE = {
  brand: { font: font(600, 12), line: 18 },
  title: { font: font(700, 28), line: 36 },
  subtitle: { font: font(400, 13), line: 20 },
  heading: { font: font(600, 12), line: 18 },
  label: { font: font(500, 13), line: 22 },
  value: { font: font(400, 15), line: 22 },
  strong: { font: font(600, 16), line: 24 },
  small: { font: font(400, 12), line: 18 },
} satisfies Record<string, Style>;

/**
 * Lays `doc` out on `ctx` — drawing only when `draw` — and returns the height it
 * takes. `logo` is the decoded company mark, or `null` for the text-only header.
 */
function layout(ctx: CanvasRenderingContext2D, doc: BookingDocument, draw: boolean, logo: HTMLImageElement | null): number {
  let y = PAD;
  ctx.textBaseline = 'top';

  /** Writes wrapped text from `top` (the current `y` unless told), without moving `y`; returns its height. */
  const write = (value: string, x: number, width: number, style: Style, color = INK, top = y): number => {
    ctx.font = style.font;
    const lines = wrapText(value, width, (part) => ctx.measureText(part).width);
    if (draw) {
      ctx.fillStyle = color;
      lines.forEach((line, index) => ctx.fillText(line, x, top + index * style.line));
    }
    return lines.length * style.line;
  };
  const rule = () => {
    if (draw) {
      ctx.fillStyle = RULE;
      ctx.fillRect(PAD, y, CONTENT, 1);
    }
  };

  /** One block at `y`; returns its height. */
  const block = (item: DocumentBlock, markers: number[]): number => {
    switch (item.kind) {
      case 'field':
        return Math.max(write(item.label, PAD, LABEL - 16, TYPE.label, MUTED), write(item.value, PAD + LABEL, CONTENT - LABEL, TYPE.value));
      case 'crew':
        return Math.max(write(item.plate, PAD, LABEL - 16, TYPE.strong), write(item.driver, PAD + LABEL, CONTENT - LABEL, TYPE.value));
      case 'empty':
        return write(item.text, PAD, CONTENT, TYPE.value, WARN);
      case 'stop': {
        markers.push(y + 9);
        let height = write(item.label, PAD + 28, CONTENT - 28, TYPE.small, MUTED);
        if (item.name) height += write(item.name, PAD + 28, CONTENT - 28, TYPE.strong, INK, y + height);
        for (const line of item.lines) height += write(line, PAD + 28, CONTENT - 28, TYPE.value, INK, y + height);
        return height + 10;
      }
    }
  };

  if (draw) {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 0, WIDTH, 6);
  }
  if (logo) {
    // The mark beside the company name, the name centred on it — never stretched.
    const width = (LOGO_HEIGHT * logo.naturalWidth) / logo.naturalHeight;
    if (draw) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logo, PAD, y, width, LOGO_HEIGHT);
    }
    write(doc.brand, PAD + width + 12, CONTENT - width - 12, TYPE.brand, ACCENT, y + (LOGO_HEIGHT - TYPE.brand.line) / 2);
    y += LOGO_HEIGHT + 10;
  } else {
    y += write(doc.brand, PAD, CONTENT, TYPE.brand, ACCENT) + 6;
  }
  y += write(doc.title, PAD, CONTENT, TYPE.title);
  y += write(doc.subtitle, PAD, CONTENT, TYPE.subtitle, MUTED) + 16;
  rule();

  for (const section of doc.sections) {
    y += 24;
    y += write(section.heading.toLocaleUpperCase('vi'), PAD, CONTENT, TYPE.heading, MUTED) + 10;
    const markers: number[] = [];
    for (const item of section.blocks) y += block(item, markers) + 8;
    if (draw) route(ctx, markers);
  }

  y += 20;
  rule();
  y += 16;
  for (const line of doc.footer) y += write(line, PAD, CONTENT, TYPE.small, MUTED);
  return Math.ceil(y + PAD);
}

/** The route's two ends as markers — hollow then filled — joined by a downward arrow. */
function route(ctx: CanvasRenderingContext2D, markers: readonly number[]): void {
  const x = PAD + 8;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = 2;
  markers.forEach((center, index) => {
    ctx.beginPath();
    ctx.arc(x, center, 6, 0, Math.PI * 2);
    if (index === markers.length - 1 && index > 0) ctx.fill();
    else ctx.stroke();
  });
  for (let index = 1; index < markers.length; index += 1) {
    const from = markers[index - 1] + 10;
    const to = markers[index] - 10;
    ctx.beginPath();
    ctx.moveTo(x, from);
    ctx.lineTo(x, to);
    ctx.moveTo(x - 4, to - 5);
    ctx.lineTo(x, to);
    ctx.lineTo(x + 4, to - 5);
    ctx.stroke();
  }
}

/** Every character the document draws, upper-cased headings included — what the font loader fetches glyphs for. */
const textOf = (doc: BookingDocument): string => {
  const all = JSON.stringify(doc);
  return all + all.toLocaleUpperCase('vi');
};

const context2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  return ctx;
};

export async function renderBookingPng(doc: BookingDocument): Promise<Blob> {
  const [logo] = await Promise.all([loadImage(logoUrl), loadFonts(Object.values(TYPE).map((style) => style.font), textOf(doc))]);
  const height = layout(context2d(document.createElement('canvas')), doc, false, logo);
  // 2×, or as large as the pixel budget allows — but never below the readability floor.
  const scale = Math.max(MIN_SCALE, Math.min(SCALE, Math.sqrt(MAX_PIXELS / (WIDTH * height))));

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(WIDTH * scale);
  canvas.height = Math.floor(height * scale);
  const ctx = context2d(canvas);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  layout(ctx, doc, true, logo);
  return canvasToPng(canvas);
}
