import { describe, expect, it } from 'vitest';
import { holdsTripCosts, tripKeys } from './keys';

const list = (costs: boolean) =>
  tripKeys.scheduleList({
    from: '2026-08-01',
    to: '2026-08-31',
    assignment: 'all',
    lifecycle: 'operational',
    sort: 'executionDate',
    direction: 'desc',
    costs,
  });

describe('holdsTripCosts', () => {
  it('★ finds a board page fetched with cost.read — with the page appended, as the cache stores it', () => {
    expect(holdsTripCosts([...list(true), { page: 2, limit: 20 }])).toBe(true);
  });

  it('leaves a board page fetched without it alone', () => {
    expect(holdsTripCosts([...list(false), { page: 1, limit: 20 }])).toBe(false);
  });

  it('leaves the tab badge and the per-trip money keys to their own rules', () => {
    expect(holdsTripCosts(tripKeys.unassignedCount({ from: '2026-08-01', to: '2026-08-31' }))).toBe(false);
    expect(holdsTripCosts(tripKeys.costSummary('t1'))).toBe(false);
  });
});
