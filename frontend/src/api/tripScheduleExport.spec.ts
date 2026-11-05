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
 */

const REQUEST = { from: '2026-11-02', to: '2026-11-08', customer: '', scope: 'all' as const };
const READ_AT = '2026-11-05T08:42:07.000Z';

describe('fetchTripExportSnapshot', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('★ reads the whole export in ONE request to the snapshot route — no page, no walk', async () => {
    get.mockResolvedValue({
      data: { items: [{ id: 'a', vehicleId: null }, { id: 'b', vehicleId: 'v1' }], readAt: READ_AT },
    });

    const snapshot = await fetchTripExportSnapshot(REQUEST);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/trip-schedules/export-snapshot', {
      params: { from: '2026-11-02', to: '2026-11-08', lifecycle: 'all', assignment: 'all', customer: '' },
    });
    expect(snapshot.readAt).toBe(READ_AT);
    expect(snapshot.items.map((row) => row.id)).toEqual(['a', 'b']);
    // The wire's legacy column is renamed here, as on every other trip read.
    expect(snapshot.items[1]).toMatchObject({ legacyVehicleId: 'v1' });
    expect(snapshot.items[1]).not.toHaveProperty('vehicleId');
  });

  it.each(['operational', 'history'] as const)('asks for one screen — %s — through the same route', async (scope) => {
    get.mockResolvedValue({ data: { items: [], readAt: READ_AT } });

    await fetchTripExportSnapshot({ ...REQUEST, scope });

    expect(get).toHaveBeenCalledWith(
      '/trip-schedules/export-snapshot',
      expect.objectContaining({ params: expect.objectContaining({ lifecycle: scope }) }),
    );
  });

  it('carries the applied customer search', async () => {
    get.mockResolvedValue({ data: { items: [], readAt: READ_AT } });

    await fetchTripExportSnapshot({ ...REQUEST, customer: 'viễn' });

    expect(get).toHaveBeenCalledWith(
      '/trip-schedules/export-snapshot',
      expect.objectContaining({ params: expect.objectContaining({ customer: 'viễn' }) }),
    );
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
    ['an older server’s page envelope', { items: [{ id: 'a' }], page: 1, limit: 50, total: 120, totalPages: 3 }],
    ['rows with no readAt', { items: [{ id: 'a' }] }],
    ['a readAt that is not a time', { items: [{ id: 'a' }], readAt: 'yesterday' }],
    ['no rows at all', { readAt: READ_AT }],
    ['a proxy’s HTML page served with a 200', '<!doctype html><html></html>'],
    ['an empty body', undefined],
  ])('★ refuses %s — no snapshot, no file', async (_label, data) => {
    get.mockResolvedValue({ data });

    await expect(fetchTripExportSnapshot(REQUEST)).rejects.toThrow('no snapshot');
  });
});
