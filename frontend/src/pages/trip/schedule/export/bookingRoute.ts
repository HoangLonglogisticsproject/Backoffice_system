import type { DocumentBlock } from './bookingExportModel';
import { BRAND, CONTENT, PAD, RULE, TYPE } from './bookingTheme';
import { box, capMiddle, dry, type Pen, text, textWidth } from './canvasPen';

export type Stop = Extract<DocumentBlock, { kind: 'stop' }>;

/** The panel's padding, and the column the timeline runs down. */
const INSET = 20;
const RAIL = 30;

/**
 * The route as a vertical timeline on a tinted panel. Each end: its label with
 * its time against the right edge, then its place in bold, its address and its
 * contact. Returns the panel's height.
 */
export function route(pen: Pen, stops: readonly Stop[], top: number): number {
  const x = PAD + INSET + RAIL;
  const width = CONTENT - INSET * 2 - RAIL;
  const ends = (p: Pen) => {
    const markers: number[] = [];
    let y = top + INSET;
    stops.forEach((stop, index) => {
      if (index > 0) y += 20;
      markers.push(y + capMiddle(TYPE.stopLabel));
      const time = stop.time ? textWidth(p, stop.time, TYPE.stopTime) + 16 : 0;
      let height = Math.max(
        text(p, stop.label, x, y, width - time, TYPE.stopLabel),
        stop.time ? text(p, stop.time, x, y, width, TYPE.stopTime, 'right') : 0,
      );
      height += 4;
      if (stop.name) height += text(p, stop.name, x, y + height, width, TYPE.place);
      for (const line of stop.lines) height += text(p, line, x, y + height, width, TYPE.detail);
      y += height;
    });
    return { height: y + INSET - top, markers };
  };
  // The panel goes down first, so its height is measured before anything is drawn on it.
  const { height } = ends(dry(pen));
  box(pen, PAD, top, CONTENT, height, '#f8fafc', 10, RULE);
  const { markers } = ends(pen);
  if (pen.draw) rail(pen.ctx, PAD + INSET + 7, markers);
  return height;
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
