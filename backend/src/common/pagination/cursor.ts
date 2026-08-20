import { ValidationError } from '../errors/domain.error';

/**
 * Keyset pagination: the page contract, and the cursor that walks it.
 *
 * WHY KEYSET AND NOT OFFSET. `OFFSET n` makes the database walk and discard n
 * rows on every page, so the cost of page 16,000 is paid on page 16,000.
 * Measured on 888,000 memberships: `OFFSET 800000` took 941.9 ms and spilled
 * 22 MB of sort to disk, while the equivalent keyset page took 0.279 ms. Keyset
 * is flat in depth because it asks "the next 50 after this key", which an index
 * answers by seeking once.
 *
 * OFFSET is also WRONG under concurrent writes, which matters more than the
 * milliseconds. A row inserted at the head while somebody is reading shifts
 * every later row by one: the reader sees the boundary row twice, and a delete
 * makes them miss one. A keyset cursor names a position in a total order rather
 * than a distance from the start, so nothing another writer does can move the
 * rows already read.
 *
 * ★ THE TIEBREAKER IS NOT OPTIONAL. Timestamps are not unique — a bulk
 * provisioning or one transaction sharing `now()` produces ties. With a cursor
 * on the timestamp ALONE and a page boundary inside a tie group, measured on
 * 10 rows per timestamp:
 *
 *   `created_at >  $last`   silently LOSES 5 rows
 *   `created_at >= $last`   silently DUPLICATES 5 rows
 *
 * Neither reports an error. Comparing the pair `(timestamp, id)` makes the
 * order total, and the same page boundary then loses and duplicates nothing.
 * That is why every cursor here carries both halves.
 */

/** The position of the last row returned: its sort timestamp and its id. */
export interface Cursor {
  /** ISO-8601. The `created_at` / `requested_at` of the last row on the page. */
  t: string;
  /** That row's UUID — the tiebreaker that makes the ordering total. */
  i: string;
}

/**
 * A page of rows, and how to ask for the next one.
 *
 * `hasMore` is computed by reading one row beyond `limit` and discarding it —
 * never by `COUNT(*)`, which would re-scan the whole partition on every page
 * and reintroduce exactly the cost pagination exists to remove. For the same
 * reason there is deliberately NO total count in this shape: it cannot be
 * produced without the scan being avoided.
 */
export interface Page<T> {
  items: T[];
  /** `null` on the last page. A client pages until `hasMore` is false. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Contract default. Big enough to fill a screen, small enough to stay cheap. */
export const DEFAULT_LIMIT = 50;

/**
 * Contract maximum. Above this a "page" stops bounding anything, which is how
 * the unpaginated behaviour would quietly come back through a query parameter.
 */
export const MAX_LIMIT = 200;

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Encodes a position as an opaque token.
 *
 * Opaque so that clients treat it as a token to hand back rather than a
 * structure to build — the moment somebody constructs one by hand, the sort key
 * becomes a public API that cannot be changed.
 *
 * ⚠ OPACITY IS NOT SECURITY. base64url is encoding, not encryption; anyone can
 * decode it. That is acceptable because a cursor carries NO authority: it names
 * a row position and nothing else. Scope stays on the route and is authorized
 * before this value is ever read — see `decodeCursor`.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor, or refuses.
 *
 * ★ A MALFORMED CURSOR IS AN ERROR, NEVER A SILENT FIRST PAGE. Quietly starting
 * over would turn a client bug — a truncated token, a stale one from an older
 * encoding — into an infinite loop that re-reads page one forever and looks
 * like the server is fine. 422 says which side is wrong.
 *
 * ⚠ NOTHING HERE IS TRUSTED FOR AUTHORIZATION. The cursor names a position; it
 * cannot widen a query. A caller who lifts a cursor from one department's list
 * and replays it against another still gets rows from the department on the
 * URL, because that is where scope comes from and it was already checked by the
 * guard chain before this function ran. Moving a cursor between lists is
 * therefore harmless — it produces a wrong-looking page, not a leak.
 */
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
  // A timestamp that does not parse would reach the database as a cast error,
  // which surfaces as a 500 rather than "your cursor is wrong".
  if (Number.isNaN(Date.parse(t))) return refuse();
  if (!UUID.test(i)) return refuse();

  return { t, i };
}

/**
 * A fetched row that knows its own position in the sort order.
 *
 * ★ `cursorAt` IS A STRING, AND THAT IS THE WHOLE POINT. It is the sort
 * timestamp exactly as PostgreSQL rendered it — `created_at::text` — and it must
 * never be produced from a JavaScript `Date`.
 *
 * `TIMESTAMPTZ` holds MICROSECONDS. A JavaScript `Date` holds whole
 * MILLISECONDS. The moment a sort key is read into a `Date` the last three
 * digits are gone, and `date.toISOString()` hands back a value STRICTLY EARLIER
 * than the row it names. Feed that to `WHERE (created_at, id) > ($t, $i)` and
 * the comparison resolves on its first component — `created_at > $t` is true for
 * the very row the cursor points at — so the `id` tiebreaker is never consulted
 * and THE LAST ROW OF EVERY PAGE COMES BACK AS THE FIRST ROW OF THE NEXT.
 *
 * That defect shipped. Measured on 25 rows at `limit` 10: pages of 10, 10 and 7,
 * twenty-seven rows for twenty-five members, with rows 9 and 18 each returned
 * twice. It hid because every proof of the pagination used timestamps seeded at
 * whole minutes, where truncating to milliseconds loses nothing — while
 * `DEFAULT now()` puts sub-millisecond digits on 100% of real rows.
 *
 * Keeping the key as text end to end means it is never parsed and never
 * rounded: the exact bytes PostgreSQL sorted by are the exact bytes that come
 * back in the cursor.
 */
export interface CursorAnchored {
  id: string;
  /** `created_at::text` / `requested_at::text` — full precision, never a Date. */
  cursorAt: string;
}

/**
 * Turns `limit + 1` fetched rows into a page.
 *
 * The extra row is the whole `hasMore` mechanism: if it came back, another page
 * exists. It is dropped rather than returned, so a caller always receives at
 * most `limit` items.
 *
 * `cursorAt` is stripped from every item on the way out. It is how the page
 * finds its own end, not something a client should see or send back — the
 * cursor is the only thing that travels, and it stays opaque.
 *
 * There is deliberately NO `cursorOf` callback any more. Each call site used to
 * supply `(row) => ({ t: row.someDate.toISOString(), i: row.id })`, and that
 * lambda WAS the bug — five copies of it, each one silently truncating. Reading
 * the anchor off the row instead leaves nowhere for a `Date` to enter.
 */
export function toPage<T extends CursorAnchored>(
  rows: T[],
  limit: number,
): Page<Omit<T, 'cursorAt'>> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept.at(-1);

  return {
    items: kept.map(({ cursorAt: _cursorAt, ...item }) => item),
    // Null on the last page, and null for an empty result — there is no
    // position to resume from in either case.
    nextCursor: hasMore && last ? encodeCursor({ t: last.cursorAt, i: last.id }) : null,
    hasMore,
  };
}
