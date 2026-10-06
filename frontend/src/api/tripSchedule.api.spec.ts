import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTripSchedules } from './tripSchedule';
import { httpClient } from './client';

/**
 * What actually leaves the browser.
 *
 * ★ THE LAYER EVERY OTHER TEST MOCKS PAST. The board's hooks and screens are
 * tested against `fetchTripSchedules` as a spy, so they prove what is handed TO
 * this module and nothing about what it then sends. `readTripPage` whitelists
 * its parameters by hand, and a filter missing from that list is dropped here —
 * silently, after being built correctly, keyed correctly and asserted correctly
 * everywhere upstream. That is not a hypothetical: `customer` shipped that way,
 * and this file exists because of it.
 */
describe('fetchTripSchedules — the query string', () => {
  const get = vi.spyOn(httpClient, 'get');

  beforeEach(() => {
    get.mockReset().mockResolvedValue({ data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  const paramsOf = () => (get.mock.calls[0]![1] as { params: Record<string, unknown> }).params;

  it('★ sends the customer search — the parameter the whitelist used to drop', async () => {
    await fetchTripSchedules({ from: '2026-10-01', to: '2026-10-31', page: 1, limit: 20, customer: 'viễn' });

    expect(paramsOf()).toMatchObject({ customer: 'viễn' });
  });

  it('★ sends every filter the board has, so a new one cannot be lost in here', async () => {
    await fetchTripSchedules({
      from: '2026-10-01',
      to: '2026-10-31',
      page: 2,
      limit: 20,
      assignment: 'unassigned',
      lifecycle: 'history',
      sort: 'lastUpdated',
      direction: 'asc',
      customer: '3SC',
    });

    expect(paramsOf()).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      page: 2,
      limit: 20,
      assignment: 'unassigned',
      lifecycle: 'history',
      sort: 'lastUpdated',
      direction: 'asc',
      customer: '3SC',
    });
  });

  it('leaves an unset filter out entirely, so the server applies its own default', async () => {
    // axios drops `undefined`; the point is that an absent search is ABSENT
    // rather than an empty string the server then has to interpret.
    await fetchTripSchedules({ from: '2026-10-01', to: '2026-10-31', page: 1, limit: 20 });

    expect(paramsOf().customer).toBeUndefined();
    expect(paramsOf().assignment).toBeUndefined();
  });
});
