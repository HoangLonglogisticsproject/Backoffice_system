import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();

vi.mock('./client', () => ({
  httpClient: { get: (...args: unknown[]) => get(...args) },
}));

const { fetchAllTripSchedules } = await import('./tripSchedule');

/**
 * The page walk behind the Excel export.
 *
 * ★ WHAT THESE PIN IS THE THING THAT MAKES AN EXPORT TRUSTWORTHY: that the file
 * holds the whole result set. A walk that quietly stopped after page one would
 * produce a file that looks completely normal — headings, rows, a plausible
 * count — and is missing most of the month. Nothing downstream can detect that,
 * so it has to be caught here.
 */

const page = (items: unknown[], over: Record<string, unknown> = {}) => ({
  data: { items, page: 1, limit: 200, total: items.length, totalPages: 1, ...over },
});

const trip = (id: string) => ({ id });

describe('fetchAllTripSchedules', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('★ walks every page and returns the rows in order', async () => {
    get
      .mockResolvedValueOnce(page([trip('a'), trip('b')], { total: 5, totalPages: 3 }))
      .mockResolvedValueOnce(page([trip('c'), trip('d')], { page: 2, total: 5, totalPages: 3 }))
      .mockResolvedValueOnce(page([trip('e')], { page: 3, total: 5, totalPages: 3 }));

    const rows = await fetchAllTripSchedules({ from: '2026-08-01', to: '2026-08-31' });

    expect(rows.map((row) => (row as { id: string }).id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(get).toHaveBeenCalledTimes(3);
  });

  /**
   * ★ AT THE API'S CEILING, NOT THE BOARD'S PAGE SIZE. The endpoint refuses a
   * limit above 200 rather than clamping it, so asking for more would fail the
   * export outright; asking for the screen's fifty would triple the requests.
   */
  it('★ asks for the largest page the endpoint allows', async () => {
    get.mockResolvedValue(page([]));

    await fetchAllTripSchedules({ from: '2026-08-01', to: '2026-08-31' });

    expect(get).toHaveBeenCalledWith(
      '/trip-schedules',
      expect.objectContaining({
        params: expect.objectContaining({ page: 1, limit: 200 }),
      }),
    );
  });

  it('carries the range and the tab into every page it asks for', async () => {
    get
      .mockResolvedValueOnce(page([trip('a')], { total: 2, totalPages: 2 }))
      .mockResolvedValueOnce(page([trip('b')], { page: 2, total: 2, totalPages: 2 }));

    await fetchAllTripSchedules({
      from: '2026-08-01',
      to: '2026-08-31',
      assignment: 'all',
    });

    for (const call of get.mock.calls) {
      expect(call[1].params).toMatchObject({
        from: '2026-08-01',
        to: '2026-08-31',
        assignment: 'all',
      });
    }
  });

  /**
   * `totalPages` is `0` for an empty result — there is no "page 1 of 0" to
   * navigate to — so the loop must not ask for a second page over nothing.
   */
  it('stops at one request when the range is empty', async () => {
    get.mockResolvedValue(page([], { total: 0, totalPages: 0 }));

    const rows = await fetchAllTripSchedules({ from: '2026-08-01', to: '2026-08-31' });

    expect(rows).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('reports progress as it goes, so a long range can say so', async () => {
    get
      .mockResolvedValueOnce(page([trip('a')], { total: 2, totalPages: 2 }))
      .mockResolvedValueOnce(page([trip('b')], { page: 2, total: 2, totalPages: 2 }));

    const seen: Array<[number, number]> = [];
    await fetchAllTripSchedules({ from: '2026-08-01', to: '2026-08-31' }, (loaded, total) =>
      seen.push([loaded, total]),
    );

    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  /**
   * ★ A REFUSAL MID-WALK IS A FAILED EXPORT, NOT A SHORT ONE. Returning the
   * pages that did arrive would hand somebody a file that is missing rows and
   * says nothing about it — the exact failure the whole walk exists to avoid.
   */
  it('★ fails outright when a later page is refused', async () => {
    get
      .mockResolvedValueOnce(page([trip('a')], { total: 2, totalPages: 2 }))
      .mockRejectedValueOnce(new Error('boom'));

    await expect(
      fetchAllTripSchedules({ from: '2026-08-01', to: '2026-08-31' }),
    ).rejects.toThrow();
  });
});
