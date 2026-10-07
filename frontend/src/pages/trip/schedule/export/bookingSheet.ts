import { sectionBody } from './bookingBlocks';
import type { BookingDocument, DocumentSection } from './bookingExportModel';
import { BAND, BRAND, CONTENT, PAD, RULE, SHEET_WIDTH, TYPE } from './bookingTheme';
import { drawIcon } from './canvasIcons';
import { box, capMiddle, dry, type Pen, text } from './canvasPen';

/**
 * The booking sheet, read top-down: a thin brand bar, the header, one framed
 * section each, a quiet footer. The look is `bookingTheme`; what goes inside a
 * section is `bookingBlocks`. Runs once dry and once drawing (see `Pen`).
 */

/** The company logo's height; its width follows the file's own aspect ratio. */
const LOGO_HEIGHT = 52;
/** A section's heading band, its icon tile, and the content's inner padding. */
const BAND_HEIGHT = 46;
const TILE = 28;
const INSET = 22;

/** Lays `doc` out with `pen` and returns the sheet's height. `logo` is the decoded mark, or `null` for a text-only header. */
export function paintBooking(pen: Pen, doc: BookingDocument, logo: HTMLImageElement | null): number {
  pen.ctx.textBaseline = 'top';
  box(pen, { x: 0, y: 0, width: SHEET_WIDTH, height: 4 }, { fill: BRAND });
  let y = 44;
  y += header(pen, doc, logo, y) + 24;
  // The header's close: a hairline, led by a short stroke of the brand blue.
  box(pen, { x: PAD, y, width: CONTENT, height: 1 }, { fill: RULE });
  box(pen, { x: PAD, y: y - 1, width: 56, height: 3 }, { fill: BRAND, radius: 1.5 });
  y += 28;
  for (const part of doc.sections) y += section(pen, part, y) + 18;
  y += 10;
  box(pen, { x: PAD, y, width: CONTENT, height: 1 }, { fill: RULE });
  y += 16;
  for (const line of doc.footer) y += text(pen, line, PAD, y, CONTENT, TYPE.small);
  return Math.ceil(y + 36);
}

/**
 * Left-aligned, read top-down: the brand lockup — the mark, the company name
 * centred on it — then PHIẾU BOOKING, the largest text, then its subtitle.
 */
function header(pen: Pen, doc: BookingDocument, logo: HTMLImageElement | null, top: number): number {
  let y = top;
  if (logo) {
    const mark = (LOGO_HEIGHT * logo.naturalWidth) / logo.naturalHeight;
    if (pen.draw) {
      pen.ctx.imageSmoothingQuality = 'high';
      pen.ctx.drawImage(logo, PAD, y, mark, LOGO_HEIGHT);
    }
    text(pen, doc.brand, PAD + mark + 16, y + (LOGO_HEIGHT - TYPE.brand.line) / 2, CONTENT - mark - 16, TYPE.brand);
    y += LOGO_HEIGHT + 20;
  } else {
    y += text(pen, doc.brand, PAD, y, CONTENT, TYPE.brand) + 16;
  }
  y += text(pen, doc.title, PAD, y, CONTENT, TYPE.title) + 4;
  y += text(pen, doc.subtitle, PAD, y, CONTENT, TYPE.subtitle);
  return y - top;
}

/**
 * One section, framed: a blue-gray heading band — the section's icon on a
 * brand-blue tile, its title in navy small capitals — over a white body.
 */
function section(pen: Pen, part: DocumentSection, top: number): number {
  const column = { x: PAD + INSET, width: CONTENT - INSET * 2 };
  const body = top + BAND_HEIGHT + INSET;
  const height = BAND_HEIGHT + INSET + sectionBody(dry(pen), part.blocks, column, body) + INSET;
  box(pen, { x: PAD, y: top, width: CONTENT, height }, { fill: '#ffffff', radius: 10 });
  box(pen, { x: PAD, y: top, width: CONTENT, height: BAND_HEIGHT }, { fill: BAND, radius: [10, 10, 0, 0] });
  box(pen, { x: PAD, y: top + BAND_HEIGHT, width: CONTENT, height: 1 }, { fill: RULE });
  const tile = { x: PAD + 16, y: top + (BAND_HEIGHT - TILE) / 2 };
  box(pen, { ...tile, width: TILE, height: TILE }, { fill: BRAND, radius: 7 });
  if (pen.draw) drawIcon(pen.ctx, part.icon, tile.x + 6, tile.y + 6, TILE - 12, '#ffffff');
  const caps = part.heading.toLocaleUpperCase('vi');
  text(pen, caps, tile.x + TILE + 12, tile.y + TILE / 2 - capMiddle(TYPE.heading), CONTENT - TILE - 44, TYPE.heading);
  sectionBody(pen, part.blocks, column, body);
  box(pen, { x: PAD, y: top, width: CONTENT, height }, { radius: 10, edge: RULE });
  return height;
}
