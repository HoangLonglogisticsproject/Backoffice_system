import type { DocumentBlock } from './bookingExportModel';
import { BRAND, TYPE } from './bookingTheme';
import { capMiddle, type Column, type Pen, text } from './canvasPen';

export type Stop = Extract<DocumentBlock, { kind: 'stop' }>;

/** The column the timeline runs down, left of the stops' text. */
const RAIL = 32;

/**
 * The route as a vertical timeline: each end's small-capital label, its place
 * in bold, its address and contact. Places only — when they happen is
 * "Thời gian"'s to say. Returns the height it takes.
 */
export function route(pen: Pen, stops: readonly Stop[], column: Column, top: number): number {
  const x = column.x + RAIL;
  const width = column.width - RAIL;
  const markers: number[] = [];
  let y = top;
  stops.forEach((stop, index) => {
    if (index > 0) y += 22;
    markers.push(y + capMiddle(TYPE.eyebrow));
    y += text(pen, stop.label.toLocaleUpperCase('vi'), x, y, width, TYPE.eyebrow) + 4;
    if (stop.name) y += text(pen, stop.name, x, y, width, TYPE.place) + 2;
    for (const line of stop.lines) y += text(pen, line, x, y, width, TYPE.detail);
  });
  if (pen.draw) rail(pen.ctx, column.x + 8, markers);
  return y - top;
}

/**
 * The ends as markers — a ring where the goods are taken, a solid mark where
 * they arrive, each with a centre dot — joined by a quiet dashed line that
 * arrives as an arrowhead.
 */
function rail(ctx: CanvasRenderingContext2D, x: number, markers: readonly number[]): void {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#93b4f0';
  for (let index = 1; index < markers.length; index += 1) {
    const from = markers[index - 1] + 13;
    const to = markers[index] - 13;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, from);
    ctx.lineTo(x, to - 1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x - 4, to - 5);
    ctx.lineTo(x, to);
    ctx.lineTo(x + 4, to - 5);
    ctx.stroke();
  }
  markers.forEach((center, index) => {
    const arrives = index > 0 && index === markers.length - 1;
    dot(ctx, x, center, 7, arrives ? BRAND : '#ffffff', BRAND);
    dot(ctx, x, center, 2.5, arrives ? '#ffffff' : BRAND);
  });
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string, edge?: string): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = edge;
    ctx.stroke();
  }
}
