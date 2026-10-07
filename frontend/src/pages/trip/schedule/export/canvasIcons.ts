import type { SectionIcon } from './bookingExportModel';

/**
 * The section marks, in lucide's own geometry — the icon set the app already
 * draws with (lucide-react, ISC) — stroked as native `Path2D`, so the PNG
 * speaks the screen's visual language without rendering React into a canvas
 * or reaching into the library's private exports. Circles are written as two
 * arcs, a polyline as a path; every subpath starts absolute.
 */
const PATHS: Record<SectionIcon, readonly string[]> = {
  clock: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 6v6l4 2'],
  pin: [
    'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
    'M9 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  ],
  package: [
    'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
    'M12 22V12',
    'M3.29 7 12 12 20.71 7',
    'M7.5 4.27l9 5.15',
  ],
  truck: [
    'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2',
    'M15 18H9',
    'M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14',
    'M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M5 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
};

/** `name`, `size` px square with its top-left at (x, y), in lucide's 2-unit round stroke. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: SectionIcon, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(PATHS[name].join(' ')));
  ctx.restore();
}
