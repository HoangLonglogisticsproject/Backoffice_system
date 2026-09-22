import { ValidationError } from '../errors/domain.error';

/**
 * Keyset pagination — the backend's contract (ADR-0002), copied so the two
 * services page the same way and the backend gateway can pass a cursor
 * through untouched.
 *
 * The cursor is the pair `(timestamp, id)`; the timestamp travels as the exact
 * text PostgreSQL rendered (`last_seen_at::text`) and is never parsed into a
 * JavaScript `Date`, which would drop the microseconds and return the last row
 * of every page as the first row of the next.
 */

export interface Cursor {
  /** ISO-8601 text as rendered by PostgreSQL. */
  t: string;
  /** The row's UUID — the tiebreaker that makes the ordering total. */
  i: string;
}

export interface Page<T> {
  items: T[];
  /** `null` on the last page. */
  nextCursor: string | null;
  hasMore: boolean;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** A malformed cursor is a 422, never a silent first page. */
export function decodeCursor(raw: string): Cursor {
  const refuse = (): never => {
    throw new ValidationError('Malformed cursor.', { cursor: 'Not a valid pagination cursor.' });
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return refuse();
  }

  if (typeof parsed !== 'object' || parsed === null) return refuse();

  const { t, i } = parsed as { t?: unknown; i?: unknown };

  if (typeof t !== 'string' || typeof i !== 'string') return refuse();
  if (Number.isNaN(Date.parse(t))) return refuse();
  if (!UUID.test(i)) return refuse();

  return { t, i };
}

/** A fetched row that knows its own position: `cursorAt` is `…::text`, never a Date. */
export interface CursorAnchored {
  id: string;
  cursorAt: string;
}

/** Turns `limit + 1` fetched rows into a page; the extra row is the `hasMore` signal. */
export function toPage<T extends CursorAnchored>(
  rows: T[],
  limit: number,
): Page<Omit<T, 'cursorAt'>> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept.at(-1);

  return {
    items: kept.map(({ cursorAt: _cursorAt, ...item }) => item),
    nextCursor: hasMore && last ? encodeCursor({ t: last.cursorAt, i: last.id }) : null,
    hasMore,
  };
}
