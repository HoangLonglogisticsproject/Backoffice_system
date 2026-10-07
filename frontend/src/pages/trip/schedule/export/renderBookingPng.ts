import logoUrl from '@/assets/img/LOGO.png';
import type { BookingDocument } from './bookingExportModel';
import { paintBooking } from './bookingSheet';
import { SHEET_FONTS, SHEET_WIDTH } from './bookingTheme';
import { canvasToPng, loadFonts, loadImage } from './canvasText';

/**
 * The booking document → a PNG `Blob`, drawn with native Canvas 2D.
 *
 * ★ DRAWN, NOT SCREENSHOTTED. Nothing here reads the page: the image is laid
 * out from the document model alone, so it cannot pick up a price column, a
 * badge or a button from the screen behind it.
 *
 * ★ DETERMINISTIC: fixed logical width, 2× pixels, white ground, the app's own
 * font and the company logo loaded before the first measurement, and no clock —
 * the export instant is already a string in the model. The height is whatever
 * the content needs: the sheet is measured, then drawn, so nothing is cropped.
 */

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
  const [logo] = await Promise.all([loadImage(logoUrl), loadFonts(SHEET_FONTS, textOf(doc))]);
  const height = paintBooking({ ctx: context2d(document.createElement('canvas')), draw: false }, doc, logo);
  // 2×, or as large as the pixel budget allows — but never below the readability floor.
  const scale = Math.max(MIN_SCALE, Math.min(SCALE, Math.sqrt(MAX_PIXELS / (SHEET_WIDTH * height))));

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(SHEET_WIDTH * scale);
  canvas.height = Math.floor(height * scale);
  const ctx = context2d(canvas);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_WIDTH, height);
  paintBooking({ ctx, draw: true }, doc, logo);
  return canvasToPng(canvas);
}
