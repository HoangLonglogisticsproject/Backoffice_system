import { DEFAULT_LIMIT, MAX_LIMIT, decodeCursor, encodeCursor, toPage } from './cursor';
import { pageQuerySchema } from './page-query.dto';

/**
 * The pure half of pagination: encoding, validation, and turning `limit + 1`
 * rows into a page.
 *
 * No database here on purpose — `common/` may not import `core/` (boundary B3),
 * and none of this needs a server to be true. The keyset behaviour that DOES
 * need one — ties, concurrent writes, total ordering — is proven against real
 * PostgreSQL in `core/organization/persistence/pagination.integration.spec.ts`.
 */
describe('cursor', () => {
  const VALID = { t: '2026-01-01T00:00:00.000Z', i: '11111111-1111-1111-1111-111111111111' };

  it('round-trips a position', () => {
    expect(decodeCursor(encodeCursor(VALID))).toEqual(VALID);
  });

  it('produces a token with no structure a client would be tempted to parse', () => {
    const encoded = encodeCursor(VALID);

    // base64url: no padding, no characters that need escaping in a query string.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
  });

  describe('refuses anything it cannot trust', () => {
    // A silent fall back to page one would turn a client bug into a loop that
    // re-reads the first page forever and looks like success.
    it.each([
      ['not base64', 'not-base64!!!'],
      ['valid base64, not JSON', Buffer.from('hello').toString('base64url')],
      ['JSON but not an object', Buffer.from('42').toString('base64url')],
      ['object missing both fields', Buffer.from('{}').toString('base64url')],
      ['null', Buffer.from('null').toString('base64url')],
    ])('%s', (_label, raw) => {
      expect(() => decodeCursor(raw)).toThrow(/Malformed cursor/);
    });

    it('a timestamp that is not a date', () => {
      expect(() => decodeCursor(encodeCursor({ ...VALID, t: 'yesterday' }))).toThrow(
        /Malformed cursor/,
      );
    });

    it('a tiebreaker that is not a uuid', () => {
      // This one would otherwise reach PostgreSQL as a failed uuid cast and
      // surface as a 500 rather than "your cursor is wrong".
      expect(() => decodeCursor(encodeCursor({ ...VALID, i: 'abc' }))).toThrow(
        /Malformed cursor/,
      );
    });
  });
});

describe('toPage', () => {
  // Real UUIDs, because `decodeCursor` validates the tiebreaker — a fixture
  // with `id-9` in it would be testing the fixture, not the page.
  //
  // `cursorAt` carries MICROSECONDS, as `created_at::text` does. A fixture with
  // millisecond timestamps would agree with a truncating implementation and
  // prove nothing.
  const rows = Array.from({ length: 11 }, (_, n) => ({
    id: `1111111e-1111-4111-8111-11111111111${n.toString(16)}`,
    name: `Person ${n}`,
    cursorAt: `2026-01-01 00:00:00.00012${n}+00`,
  }));

  it('drops the probe row and reports more', () => {
    // 11 rows came back for a limit of 10: the extra one exists only to answer
    // `hasMore`, and must never be handed to the caller.
    const page = toPage(rows, 10);

    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it('the cursor points at the LAST returned row, not the probe', () => {
    const page = toPage(rows, 10);

    expect(decodeCursor(page.nextCursor as string).i).toBe(rows[9]!.id);
  });

  it('the cursor keeps every digit of the sort key', () => {
    // The defect this replaced rounded the key to milliseconds, which names a
    // position EARLIER than the row it points at — so that row is served again
    // at the top of the next page.
    const page = toPage(rows, 10);

    expect(decodeCursor(page.nextCursor as string).t).toBe(rows[9]!.cursorAt);
    expect(decodeCursor(page.nextCursor as string).t).toContain('.000129');
  });

  it('does not leak the anchor into the payload', () => {
    // `cursorAt` is how the page finds its own end. The client gets the opaque
    // cursor instead, and never a raw sort key it might try to send back.
    const page = toPage(rows, 10);

    expect(page.items[0]).not.toHaveProperty('cursorAt');
    expect(page.items[0]).toEqual({ id: rows[0]!.id, name: 'Person 0' });
  });

  it('ends cleanly when the probe row does not come back', () => {
    const page = toPage(rows.slice(0, 10), 10);

    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('an empty result is a page, not an error', () => {
    expect(toPage([], 10)).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
});

describe('pageQuerySchema', () => {
  it('defaults the limit', () => {
    expect(pageQuerySchema.parse({}).limit).toBe(DEFAULT_LIMIT);
  });

  it('accepts the boundaries', () => {
    expect(pageQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(pageQuerySchema.parse({ limit: String(MAX_LIMIT) }).limit).toBe(MAX_LIMIT);
  });

  it('REFUSES an over-large limit rather than clamping it', () => {
    // Clamping would hand back 200 rows to a caller who asked for 5,000 and
    // let them believe they had the whole list.
    expect(pageQuerySchema.safeParse({ limit: String(MAX_LIMIT + 1) }).success).toBe(false);
  });

  it.each([['zero', '0'], ['negative', '-1'], ['fractional', '1.5'], ['not a number', 'abc']])(
    'refuses a %s limit',
    (_label, limit) => {
      expect(pageQuerySchema.safeParse({ limit }).success).toBe(false);
    },
  );

  it('treats an empty cursor as absent, because clients forward a null one', () => {
    expect(pageQuerySchema.parse({ cursor: '' }).cursor).toBeUndefined();
    expect(pageQuerySchema.parse({}).cursor).toBeUndefined();
  });
});
