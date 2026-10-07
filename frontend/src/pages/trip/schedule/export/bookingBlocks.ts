import type { DocumentBlock } from './bookingExportModel';
import { route } from './bookingRoute';
import { RULE, TYPE } from './bookingTheme';
import { box, capMiddle, type Column, type Look, type Pen, text, textWidth, type TextStyle } from './canvasPen';

/**
 * What goes inside a section's container, chosen by what the section holds:
 * the time summary, the route timeline, or label-and-value rows (fields, one
 * lorry per row, or the "not assigned yet" mark).
 */

const LABEL = 132;
/** A chip's height, and the narrowest plate chip — so a column of plates lines up. */
const CHIP = 28;
const PLATE = 112;

type Kind = DocumentBlock['kind'];
type Of<K extends Kind> = Extract<DocumentBlock, { kind: K }>;

/** `blocks` when every one is of `kind`; `null` when they are mixed. */
function only<K extends Kind>(blocks: readonly DocumentBlock[], kind: K): Array<Of<K>> | null {
  const matching = blocks.filter((block): block is Of<K> => block.kind === kind);
  return matching.length === blocks.length ? matching : null;
}

/** A section's blocks laid out in `column` from `top`; returns their height. */
export function sectionBody(pen: Pen, blocks: readonly DocumentBlock[], column: Column, top: number): number {
  const moments = only(blocks, 'moment');
  if (moments) return times(pen, moments, column, top);
  const stops = only(blocks, 'stop');
  if (stops) return route(pen, stops, column, top);
  let y = top;
  blocks.forEach((block, index) => {
    if (index > 0) y += 10;
    y += row(pen, block, column, y);
  });
  return y - top;
}

function row(pen: Pen, block: DocumentBlock, column: Column, top: number): number {
  switch (block.kind) {
    case 'field':
      return Math.max(
        text(pen, block.label, column.x, top, LABEL - 16, TYPE.label),
        text(pen, block.value, column.x + LABEL, top, column.width - LABEL, TYPE.value),
      );
    case 'crew': {
      // The plate in a quiet chip, a step above the driver's name, which sits level with it.
      chip(pen, block.plate, column.x, top, TYPE.plate, { fill: '#eff6ff', edge: '#bfdbfe', radius: 6, min: PLATE });
      const offset = CHIP / 2 - capMiddle(TYPE.value);
      return Math.max(CHIP, offset + text(pen, block.driver, column.x + LABEL, top + offset, column.width - LABEL, TYPE.value));
    }
    case 'empty':
      chip(pen, block.text, column.x, top, TYPE.pending, { fill: '#fffbeb', edge: '#fde68a', radius: CHIP / 2, min: 0 });
      return CHIP;
    case 'moment':
      return times(pen, [block], column, top);
    case 'stop':
      return route(pen, [block], column, top);
  }
}

/**
 * "Thời gian" as the time summary: a column per end — its label, its day, and
 * the hour standing out beneath — with a hairline between the columns.
 */
function times(pen: Pen, moments: ReadonlyArray<Of<'moment'>>, column: Column, top: number): number {
  const share = column.width / moments.length;
  const heights = moments.map((moment, index) => {
    const x = column.x + index * share + (index > 0 ? 24 : 0);
    const width = share - 24;
    let y = top + text(pen, moment.label, x, top, width, TYPE.eyebrow) + 2;
    y += text(pen, moment.day, x, y, width, TYPE.day);
    if (moment.time) y += 2 + text(pen, moment.time, x, y + 2, width, TYPE.time);
    return y - top;
  });
  const height = Math.max(...heights);
  for (let index = 1; index < moments.length; index += 1) {
    box(pen, { x: column.x + index * share, y: top, width: 1, height }, { fill: RULE });
  }
  return height;
}

type ChipLook = Look & { min: number };

/** One line of text centred in a rounded box at `x`. */
function chip(pen: Pen, value: string, x: number, top: number, type: TextStyle, look: ChipLook): void {
  const inner = textWidth(pen, value, type);
  const width = Math.max(look.min, inner + 24);
  box(pen, { x, y: top, width, height: CHIP }, look);
  text(pen, value, x + (width - inner) / 2, top + CHIP / 2 - capMiddle(type), inner, type);
}
