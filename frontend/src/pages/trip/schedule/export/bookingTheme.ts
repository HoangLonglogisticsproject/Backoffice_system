import type { TextStyle } from './canvasPen';
import { font } from './canvasText';

/**
 * The booking sheet's look: page geometry, palette and type.
 *
 * ★ A CORPORATE DOCUMENT, NOT A POSTER: white ground, one brand blue, slate
 * greys and hairlines. The only tint sits behind the route — what the sheet is
 * for — and the only warm colour marks a lorry not yet assigned.
 */

export const SHEET_WIDTH = 720;
export const PAD = 48;
export const CONTENT = SHEET_WIDTH - PAD * 2;

export const BRAND = '#2563eb';
const NAVY = '#1e3a8a';
const INK = '#0f172a';
const BODY = '#334155';
const MUTED = '#64748b';
export const RULE = '#e2e8f0';

const style = (weight: number, size: number, line: number, color: string): TextStyle => ({ font: font(weight, size), size, line, color });
export const TYPE = {
  brand: style(700, 15, 20, NAVY),
  title: style(700, 26, 32, INK),
  subtitle: style(400, 13, 18, MUTED),
  heading: style(600, 12, 16, BRAND),
  label: style(500, 13, 22, MUTED),
  value: style(400, 15, 22, INK),
  stopLabel: style(500, 12, 18, MUTED),
  stopTime: style(600, 13, 18, BODY),
  place: style(600, 16, 24, INK),
  detail: style(400, 14, 21, BODY),
  plate: style(700, 14, 20, NAVY),
  pending: style(600, 13, 18, '#b45309'),
  small: style(400, 12, 18, MUTED),
};
/** Every face the sheet draws in — what has to load before the first measurement. */
export const SHEET_FONTS = [...new Set(Object.values(TYPE).map((type) => type.font))];
