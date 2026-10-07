import type { DocumentBlock } from './bookingExportModel';
import { BRAND, TYPE } from './bookingTheme';
import { capMiddle, type Column, type Pen, text } from './canvasPen';

export type Stop = Extract<DocumentBlock, { kind: 'stop' }>;

/** The column the timeline runs down, left of the stops' text. */
const RAIL = 30;

/**
 * The route as a vertical timeline: each end's small label, its place in
 * bold, its address and contact. Places only — when they happen is
 * "Thời gian"'s to say. Returns the height it takes.
 */
export function route(pen: Pen, stops: readonly Stop[], column: Column, top: number): number {
  const x = column.x + RAIL;
  const width = column.width - RAIL;
  const markers: number[] = [];
  let y = top;
  stops.forEach((stop, index) => {
    if (index > 0) y += 20;
    markers.push(y + capMiddle(TYPE.eyebrow));
    y += text(pen, stop.label, x, y, width, TYPE.eyebrow) + 2;
    if (stop.name) y += text(pen, stop.name, x, y, width, TYPE.place);
    for (const line of stop.lines) y += text(pen, line, x, y, width, TYPE.detail);
  });
  if (pen.draw) rail(pen.ctx, column.x + 7, markers);
  return y - top;
}

/** The ends as markers — hollow, then filled — joined by a light line that arrives as an arrowhead. */
function rail(ctx: CanvasRenderingContext2D, x: number, markers: readonly number[]): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#93c5fd';
  for (let index = 1; index < markers.length; index += 1) {
    const from = markers[index - 1] + 11;
    const to = markers[index] - 11;
    ctx.beginPath();
    ctx.moveTo(x, from);
    ctx.lineTo(x, to);
    ctx.moveTo(x - 4, to - 5);
    ctx.lineTo(x, to);
    ctx.lineTo(x + 4, to - 5);
    ctx.stroke();
  }
  ctx.strokeStyle = BRAND;
  markers.forEach((center, index) => {
    ctx.beginPath();
    ctx.arc(x, center, 6, 0, Math.PI * 2);
    ctx.fillStyle = index > 0 && index === markers.length - 1 ? BRAND : '#ffffff';
    ctx.fill();
    ctx.stroke();
  });
}
