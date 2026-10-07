import { wrapText } from './canvasText';

/**
 * One pass over a canvas layout. A sheet is laid out twice by the same code —
 * dry, to learn how tall it is, then for real on a canvas of that height — so
 * every primitive here returns the space it takes and touches pixels only when
 * `draw` is set. The two passes cannot disagree.
 */
export interface Pen {
  readonly ctx: CanvasRenderingContext2D;
  readonly draw: boolean;
}

export type TextStyle = { font: string; size: number; line: number; color: string };

/**
 * How far below a line's top the middle of its capitals sits — what a marker,
 * a hairline or a box centres on. Geist's capitals start at the `top` baseline
 * and stand 0.72 em (measured in Chromium).
 */
export const capMiddle = (style: TextStyle): number => style.size * 0.36;

/** The same pen, measuring only — for a block whose height must be known before it is drawn. */
export const dry = (pen: Pen): Pen => ({ ctx: pen.ctx, draw: false });

/** `value` wrapped to `width` from (x, top), or set against the column's right edge; returns its height. */
export function text(pen: Pen, value: string, x: number, top: number, width: number, style: TextStyle, align: 'left' | 'right' = 'left'): number {
  const { ctx } = pen;
  ctx.font = style.font;
  const lines = wrapText(value, width, (part) => ctx.measureText(part).width);
  if (pen.draw) {
    ctx.fillStyle = style.color;
    ctx.textAlign = align;
    const from = align === 'right' ? x + width : x;
    lines.forEach((line, index) => ctx.fillText(line, from, top + index * style.line));
    ctx.textAlign = 'left';
  }
  return lines.length * style.line;
}

/** How wide `value` is on one line. */
export function textWidth(pen: Pen, value: string, style: TextStyle): number {
  pen.ctx.font = style.font;
  return pen.ctx.measureText(value).width;
}

/** Where a block may draw: from `x`, `width` wide. */
export type Column = { x: number; width: number };
export type Area = { x: number; y: number; width: number; height: number };
export type Look = { fill: string; radius?: number; edge?: string };

/**
 * A filled box with rounded corners, outlined in `edge` when given; one pixel
 * high, a hairline. Corners by `arcTo`, which every canvas has — `roundRect`
 * is missing from the Safari of an older iPhone.
 */
export function box(pen: Pen, { x, y, width, height }: Area, { fill, radius = 0, edge }: Look): void {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
