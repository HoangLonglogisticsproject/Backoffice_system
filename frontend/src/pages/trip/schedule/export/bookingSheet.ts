import { sectionBody } from './bookingBlocks';
import type { BookingDocument, DocumentSection } from './bookingExportModel';
import { BRAND, CONTENT, PAD, PANEL, RULE, SHEET_WIDTH, TYPE } from './bookingTheme';
import { box, capMiddle, dry, type Pen, text } from './canvasPen';

/**
 * The booking sheet, read top-down: a thin brand bar, the header, one quiet
 * container per section, a quiet footer. The look is `bookingTheme`; what goes
 * inside a section is `bookingBlocks`. Runs once dry and once drawing (see
 * `Pen`).
 */

/** The company logo's height; its width follows the file's own aspect ratio. */
const LOGO_HEIGHT = 56;
/** A section container's inner padding. */
const INSET = 20;

/** Lays `doc` out with `pen` and returns the sheet's height. `logo` is the decoded mark, or `null` for a text-only header. */
export function paintBooking(pen: Pen, doc: BookingDocument, logo: HTMLImageElement | null): number {
  pen.ctx.textBaseline = 'top';
  box(pen, { x: 0, y: 0, width: SHEET_WIDTH, height: 4 }, { fill: BRAND });
  let y = 40;
  y += header(pen, doc, logo, y) + 28;
  for (const part of doc.sections) y += section(pen, part, y) + 16;
  y += 12;
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
    text(pen, doc.brand, PAD + mark + 14, y + (LOGO_HEIGHT - TYPE.brand.line) / 2, CONTENT - mark - 14, TYPE.brand);
    y += LOGO_HEIGHT + 18;
  } else {
    y += text(pen, doc.brand, PAD, y, CONTENT, TYPE.brand) + 14;
  }
  y += text(pen, doc.title, PAD, y, CONTENT, TYPE.title) + 2;
  y += text(pen, doc.subtitle, PAD, y, CONTENT, TYPE.subtitle);
  return y - top;
}

/** One section in its own quiet container: a short brand bar, the blue heading, then its content. */
function section(pen: Pen, part: DocumentSection, top: number): number {
  const column = { x: PAD + INSET, width: CONTENT - INSET * 2 };
  const inside = (p: Pen) => {
    const caps = part.heading.toLocaleUpperCase('vi');
    const marker = top + INSET + capMiddle(TYPE.heading);
    box(p, { x: column.x, y: marker - 6, width: 3, height: 12 }, { fill: BRAND, radius: 1.5 });
    const heading = text(p, caps, column.x + 11, top + INSET, column.width - 11, TYPE.heading) + 14;
    return INSET + heading + sectionBody(p, part.blocks, column, top + INSET + heading) + INSET;
  };
  // The container goes down first, so the content is measured before anything is drawn on it.
  const height = inside(dry(pen));
  box(pen, { x: PAD, y: top, width: CONTENT, height }, { fill: PANEL, radius: 10, edge: RULE });
  inside(pen);
  return height;
}
