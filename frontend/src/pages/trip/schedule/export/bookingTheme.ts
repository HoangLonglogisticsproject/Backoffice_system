import type { TextStyle } from './canvasPen';
import { font } from './canvasText';

/**
 * The booking sheet's look: page geometry, palette and type.
 *
 * ★ EXECUTIVE, NOT DECORATIVE: white ground, one brand blue, navy and slate
 * text, blue-gray bands and hairlines. No gradient, no shadow; the only warm
 * colour marks a lorry not yet assigned.
 */

export const SHEET_WIDTH = 720;
export const PAD = 48;
export const CONTENT = SHEET_WIDTH - PAD * 2;

export const BRAND = '#2563eb';
export const NAVY = '#1e3a8a';
const INK = '#0f172a';
const BODY = '#334155';
const MUTED = '#64748b';
/** Hairlines and container edges. */
export const RULE = '#e2e8f0';
/** Dividers between rows inside a section — a shade quieter than a rule. */
export const DIVIDER = '#eef2f7';
/** A section's heading band — blue-gray, a breath off white. */
export const BAND = '#f5f8fc';

const style = (weight: number, size: number, line: number, color: string): TextStyle => ({ font: font(weight, size), size, line, color });
export const TYPE = {
  brand: style(700, 16, 22, NAVY),
  title: style(800, 30, 36, INK),
  subtitle: style(400, 13, 18, MUTED),
  heading: style(700, 12, 16, NAVY),
  eyebrow: style(600, 11, 16, MUTED),
  label: style(500, 13, 22, MUTED),
  value: style(400, 15, 22, INK),
  day: style(500, 15, 22, BODY),
  time: style(700, 20, 26, INK),
  place: style(600, 16, 24, INK),
  detail: style(400, 14, 21, BODY),
  plate: style(700, 15, 20, NAVY),
  driver: style(500, 15, 22, BODY),
  pending: style(600, 13, 18, '#b45309'),
  small: style(400, 12, 18, MUTED),
};
/** Every face the sheet draws in — what has to load before the first measurement. */
export const SHEET_FONTS = [...new Set(Object.values(TYPE).map((type) => type.font))];
