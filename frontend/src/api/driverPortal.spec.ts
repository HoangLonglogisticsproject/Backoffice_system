import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpClient } from './client';
import { fetchMyAssignment, fetchMyAssignments, recordExecutionEvent } from './driverPortal';

/**
 * ★ READS GIVE UP, WRITES DO NOT.
 *
 * A read that hangs keeps a skeleton on a driver's screen for minutes, so each
 * one stops after ten seconds and fails as "no connection". A write that timed
 * out may still have landed; its answer is the idempotency key, so it is never
 * cut short by the client.
 */
describe('driver portal repository — timeouts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives up on the schedule read after ten seconds', async () => {
    const get = vi.spyOn(httpClient, 'get').mockResolvedValue({ data: [] });

    await fetchMyAssignments();

    expect(get).toHaveBeenCalledWith('/driver/assignments', expect.objectContaining({ timeout: 10_000 }));
  });

  it('gives up on one assignment read after ten seconds', async () => {
    const get = vi.spyOn(httpClient, 'get').mockResolvedValue({ data: {} });

    await fetchMyAssignment('a1');

    expect(get).toHaveBeenCalledWith('/driver/assignments/a1', expect.objectContaining({ timeout: 10_000 }));
  });

  it('never times out a write — a cut-short tap may still have landed', async () => {
    const post = vi.spyOn(httpClient, 'post').mockResolvedValue({ data: {} });

    await recordExecutionEvent('a1', { type: 'ARRIVED_PICKUP', clientEventId: 'e1' });

    expect(post).toHaveBeenCalledTimes(1);
    const [path, , config] = post.mock.calls[0] ?? [];
    expect(path).toBe('/driver/assignments/a1/execution-events');
    expect(config?.timeout).toBeUndefined();
  });
});
