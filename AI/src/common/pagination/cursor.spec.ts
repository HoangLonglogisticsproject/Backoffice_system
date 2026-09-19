import { ValidationError } from '../errors/domain.error';
import { decodeCursor, encodeCursor, toPage } from './cursor';

describe('keyset cursor', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('round-trips the exact timestamp text', () => {
    const t = '2026-09-19 10:00:00.123456+00';
    expect(decodeCursor(encodeCursor({ t, i: id }))).toEqual({ t, i: id });
  });

  it.each(['', 'nope', Buffer.from('{"t":1}').toString('base64url'), Buffer.from('{"t":"x","i":"y"}').toString('base64url')])(
    'refuses a malformed cursor %j with a 422, never a silent first page',
    (raw) => {
      expect(() => decodeCursor(raw)).toThrow(ValidationError);
    },
  );

  it('turns limit+1 rows into a page and strips the anchor', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `${n}`.padStart(8, '0') + id.slice(8), cursorAt: `2026-09-19 10:00:0${n}.000001+00`, n }));
    const page = toPage(rows, 2);
    expect(page.items).toEqual([{ id: rows[0]!.id, n: 1 }, { id: rows[1]!.id, n: 2 }]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor as string)).toEqual({ t: rows[1]!.cursorAt, i: rows[1]!.id });
    expect(toPage(rows.slice(0, 2), 2).nextCursor).toBeNull();
  });
});
