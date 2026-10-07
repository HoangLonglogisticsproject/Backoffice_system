import type { BookingDocument, DocumentBlock } from './bookingExportModel';
import { route, type Stop } from './bookingRoute';
import { BRAND, CONTENT, PAD, RULE, SHEET_WIDTH, TYPE } from './bookingTheme';
import { box, capMiddle, dry, type Look, type Pen, text, textWidth, type TextStyle } from './canvasPen';

/**
 * The booking sheet, top to bottom: a thin brand bar, the header, one section
 * per block of the document, the footer. Where each string goes — the look is
 * `bookingTheme`, the route's timeline `bookingRoute`. Runs once dry and once
 * drawing (see `Pen`).
 */

const LABEL = 140;
/** The company logo's height; its width follows the file's own aspect ratio. */
const LOGO_HEIGHT = 56;
/** A chip's height, and the narrowest plate chip — so a column of plates lines up. */
const CHIP = 28;
const PLATE = 112;

/** A one-pixel hairline in the rule colour. */
const rule = (pen: Pen, x: number, y: number, width: number) => box(pen, { x, y, width, height: 1 }, { fill: RULE });

/** Lays `doc` out with `pen` and returns the sheet's height. `logo` is the decoded mark, or `null` for a text-only header. */
export function paintBooking(pen: Pen, doc: BookingDocument, logo: HTMLImageElement | null): number {
  pen.ctx.textBaseline = 'top';
  box(pen, { x: 0, y: 0, width: SHEET_WIDTH, height: 4 }, { fill: BRAND });
  let y = 44;
  y += header(pen, doc, logo, y) + 22;
  rule(pen, PAD, y, CONTENT);
  for (const section of doc.sections) {
    y += 28;
    y += heading(pen, section.heading, y) + 14;
    const stops = section.blocks.filter((block): block is Stop => block.kind === 'stop');
    y += stops.length === section.blocks.length ? route(pen, stops, y) : rows(pen, section.blocks, y);
  }
  y += 36;
  rule(pen, PAD, y, CONTENT);
  y += 14;
  // When it was exported on the left, what it is for on the right.
  const exported = Math.min(textWidth(pen, doc.footer.exported, TYPE.small), CONTENT / 2);
  const note = CONTENT - exported - 24;
  y += Math.max(text(pen, doc.footer.exported, PAD, y, exported, TYPE.small), text(pen, doc.footer.note, PAD + CONTENT - note, y, note, TYPE.small, 'right'));
  return Math.ceil(y + 36);
}

/** The brand lockup — the mark, the company name centred on it — on the left; the document's title against the right edge. */
function header(pen: Pen, doc: BookingDocument, logo: HTMLImageElement | null, top: number): number {
  const mark = logo ? (LOGO_HEIGHT * logo.naturalWidth) / logo.naturalHeight : 0;
  const name = logo ? PAD + mark + 14 : PAD;
  const width = PAD + CONTENT - (name + textWidth(pen, doc.brand, TYPE.brand) + 32);
  const titles = (p: Pen, y: number) => {
    const title = text(p, doc.title, PAD + CONTENT - width, y, width, TYPE.title, 'right');
    return title + 2 + text(p, doc.subtitle, PAD + CONTENT - width, y + title + 2, width, TYPE.subtitle, 'right');
  };
  const titlesHeight = titles(dry(pen), top);
  const height = Math.max(logo ? LOGO_HEIGHT : TYPE.brand.line, titlesHeight);
  if (logo && pen.draw) {
    pen.ctx.imageSmoothingQuality = 'high';
    pen.ctx.drawImage(logo, PAD, top + (height - LOGO_HEIGHT) / 2, mark, LOGO_HEIGHT);
  }
  text(pen, doc.brand, name, top + (height - TYPE.brand.line) / 2, CONTENT, TYPE.brand);
  titles(pen, top + (height - titlesHeight) / 2);
  return height;
}

/** "THỜI GIAN ————" — the section's name, then a hairline to the edge. */
function heading(pen: Pen, value: string, top: number): number {
  const caps = value.toLocaleUpperCase('vi');
  const end = PAD + textWidth(pen, caps, TYPE.heading) + 12;
  rule(pen, end, top + capMiddle(TYPE.heading), PAD + CONTENT - end);
  return text(pen, caps, PAD, top, CONTENT, TYPE.heading);
}

/** Label-and-value rows, one lorry per row, or the "not assigned yet" mark. */
function rows(pen: Pen, blocks: readonly DocumentBlock[], top: number): number {
  let y = top;
  blocks.forEach((block, index) => {
    if (index > 0) y += 10;
    y += row(pen, block, y);
  });
  return y - top;
}

function row(pen: Pen, block: DocumentBlock, top: number): number {
  switch (block.kind) {
    case 'field':
      return Math.max(text(pen, block.label, PAD, top, LABEL - 16, TYPE.label), text(pen, block.value, PAD + LABEL, top, CONTENT - LABEL, TYPE.value));
    case 'crew': {
      // The plate in a quiet chip, a step above the driver's name, which sits level with it.
      chip(pen, block.plate, top, TYPE.plate, { fill: '#eff6ff', edge: '#bfdbfe', radius: 6, min: PLATE });
      const offset = CHIP / 2 - capMiddle(TYPE.value);
      return Math.max(CHIP, offset + text(pen, block.driver, PAD + LABEL, top + offset, CONTENT - LABEL, TYPE.value));
    }
    case 'empty':
      chip(pen, block.text, top, TYPE.pending, { fill: '#fffbeb', edge: '#fde68a', radius: CHIP / 2, min: 0 });
      return CHIP;
    case 'stop':
      return route(pen, [block], top);
  }
}

type ChipLook = Look & { min: number };

/** One line of text centred in a rounded box at the left margin. */
function chip(pen: Pen, value: string, top: number, type: TextStyle, look: ChipLook): void {
  const inner = textWidth(pen, value, type);
  const width = Math.max(look.min, inner + 24);
  box(pen, { x: PAD, y: top, width, height: CHIP }, look);
  text(pen, value, PAD + (width - inner) / 2, top + CHIP / 2 - capMiddle(type), inner, type);
}
