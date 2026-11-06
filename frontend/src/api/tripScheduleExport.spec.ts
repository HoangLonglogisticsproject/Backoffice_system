import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();

vi.mock('./client', () => ({
  httpClient: { get: (...args: unknown[]) => get(...args) },
}));

const { fetchTripExportSnapshot } = await import('./tripSchedule');

/**
 * The one read behind the Excel export.
 *
 * ★ WHAT THESE PIN IS WHAT MAKES A FILE TRUSTWORTHY: every row of the range,
 * from ONE consistent read, or no file at all. A file that is a little short —
 * one trip missed while pages were read at different instants — looks
 * completely normal, and nothing downstream can detect it.
 *
 * The server answers with a gzip FILE of `{ items, readAt }`; these feed the
 * function real gzip bytes and let the browser's `DecompressionStream` unzip
 * them, exactly as in production.
 */

const REQUEST = { from: '2026-11-02', to: '2026-11-08', customer: '', scope: 'all' as const };
const READ_AT = '2026-11-05T08:42:07.000Z';

/** What the export route sends: gzip bytes of the JSON, as an ArrayBuffer. */
const gzipFile = (value: unknown): ArrayBuffer => {
  const bytes = gzipSync(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
const answer = (data: unknown, contentType = 'application/gzip') => ({ data, headers: { 'content-type': contentType } });

describe('fetchTripExportSnapshot', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('★ reads the whole export in ONE request to the snapshot route and unzips it — no page, no walk', async () => {
    const rows = [{ id: 'a', scheduledOn: '2026-11-02' }, { id: 'b', scheduledOn: '2026-11-08' }];
    get.mockResolvedValue(answer(gzipFile({ items: rows, readAt: READ_AT })));

    const snapshot = await fetchTripExportSnapshot(REQUEST);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      '/trip-schedules/export-snapshot',
      expect.objectContaining({
        params: { from: '2026-11-02', to: '2026-11-08', lifecycle: 'all', assignment: 'all', customer: '' },
        responseType: 'arraybuffer',
      }),
    );
    expect(snapshot).toEqual({ items: rows, readAt: READ_AT });
  });

  it.each(['operational', 'history'] as const)('asks for one screen — %s — through the same route', async (scope) => {
    get.mockResolvedValue(answer(gzipFile({ items: [], readAt: READ_AT })));

    await fetchTripExportSnapshot({ ...REQUEST, scope });

    expect(get.mock.calls[0]![1].params).toMatchObject({ lifecycle: scope });
  });

  it('carries the applied customer search', async () => {
    get.mockResolvedValue(answer(gzipFile({ items: [], readAt: READ_AT })));

    await fetchTripExportSnapshot({ ...REQUEST, customer: 'viễn' });

    expect(get.mock.calls[0]![1].params).toMatchObject({ customer: 'viễn' });
  });

  /**
   * ★ A REFUSAL IS STILL JSON, AND ITS CODE MUST SURVIVE. The request asks for
   * bytes; the response transform turns a JSON answer back into an object so
   * the shared interceptor builds the usual ApiError (EXPORT_BUSY, ...).
   */
  it('★ decodes a JSON refusal for the interceptor, and leaves the file as bytes', async () => {
    get.mockResolvedValue(answer(gzipFile({ items: [], readAt: READ_AT })));
    await fetchTripExportSnapshot(REQUEST);
    const transform = get.mock.calls[0]![1].transformResponse as (raw: ArrayBuffer, headers?: Record<string, unknown>) => unknown;

    const refusal = new TextEncoder().encode(JSON.stringify({ error: { code: 'EXPORT_BUSY', message: 'busy' } })).buffer;
    expect(transform(refusal, { 'content-type': 'application/json; charset=utf-8' })).toEqual({
      error: { code: 'EXPORT_BUSY', message: 'busy' },
    });
    const file = gzipFile({ items: [] });
    expect(transform(file, { 'content-type': 'application/gzip' })).toBe(file);
  });

  /**
   * ★ A SERVER WITHOUT THE ROUTE FAILS THE EXPORT. An older backend answers
   * `/trip-schedules/export-snapshot` as a trip id and refuses it; this build
   * must not then walk the paged `/export` it no longer trusts.
   */
  it('★ never falls back to the paged /export when the snapshot route is refused', async () => {
    get.mockRejectedValue(Object.assign(new Error('Request failed with status code 422'), { response: { status: 422 } }));

    await expect(fetchTripExportSnapshot(REQUEST)).rejects.toThrow();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/trip-schedules/export-snapshot']);
  });

  it.each([
    ['an older server’s JSON page envelope', { items: [{ id: 'a' }], page: 1, total: 120, totalPages: 3 }, 'application/json'],
    ['a proxy’s HTML page served with a 200', '<!doctype html><html></html>', 'text/html'],
    ['bytes labelled gzip that are not gzip', new TextEncoder().encode('{"items":[]}').buffer, 'application/gzip'],
    ['a gzip file of rows with no readAt', gzipFile({ items: [{ id: 'a' }] }), 'application/gzip'],
    ['a gzip file whose readAt is not a time', gzipFile({ items: [], readAt: 'yesterday' }), 'application/gzip'],
    ['a gzip file of something that is not JSON', gzipFile('not json at all'), 'application/gzip'],
    ['a gzip file of a page envelope', gzipFile({ items: [{ id: 'a' }], page: 1, total: 120 }), 'application/gzip'],
  ])('★ refuses %s — no snapshot, no file', async (_label, data, contentType) => {
    get.mockResolvedValue(answer(data, contentType));

    await expect(fetchTripExportSnapshot(REQUEST)).rejects.toThrow('no snapshot');
  });
});
