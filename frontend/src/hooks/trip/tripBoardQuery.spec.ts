import { describe, expect, it } from 'vitest';
import type { TripBoardListFilter } from './keys';
import { boardListRequest, unassignedCountRequest, withoutRows } from './tripBoardQuery';

const FILTER: TripBoardListFilter = {
  from: '2026-09-01',
  to: '2026-09-30',
  assignment: 'unassigned',
  lifecycle: 'history',
  sort: 'lastUpdated',
  direction: 'asc',
  costs: true,
};

describe('boardListRequest', () => {
  it('sends the range, the tab, the screen, the order and the page', () => {
    expect(boardListRequest(FILTER, { page: 3, limit: 50 })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      assignment: 'unassigned',
      lifecycle: 'history',
      sort: 'lastUpdated',
      direction: 'asc',
      page: 3,
      limit: 50,
    });
  });

  it('★ carries every part of the cache key except `costs` — key and request cannot drift', () => {
    const request = boardListRequest(FILTER, { page: 1, limit: 20 });
    const sent = Object.keys(FILTER).filter((key) => key !== 'costs');

    for (const key of sent) {
      expect(request).toHaveProperty(key, FILTER[key as keyof TripBoardListFilter]);
    }
  });

  it.each([true, false])('★ never sends `costs` (%s) — what a caller sees is the server’s call', (costs) => {
    expect(boardListRequest({ ...FILTER, costs }, { page: 1, limit: 20 })).not.toHaveProperty('costs');
  });

  it('takes nothing but page and limit from the pager', () => {
    const pager = { page: 2, limit: 20, from: '1999-01-01', to: '1999-12-31' };

    expect(boardListRequest(FILTER, pager)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });
});

describe('unassignedCountRequest', () => {
  it('★ asks for one uncrewed row of Lịch xe in the range, and no order', () => {
    const request = unassignedCountRequest(FILTER);

    // Lịch xe whatever screen asks: a finished trip is nobody's work to crew.
    expect(request).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      page: 1,
      limit: 1,
      assignment: 'unassigned',
      lifecycle: 'operational',
    });
  });
});

describe('withoutRows', () => {
  it('★ keeps the count and the envelope, and drops the row that could carry a cost', () => {
    const page = {
      items: [{ id: 't1', costSummary: { total: '6250000.50', itemCount: 3 } }],
      page: 1,
      limit: 1,
      total: 7,
      totalPages: 7,
    };

    expect(withoutRows(page)).toEqual({ items: [], page: 1, limit: 1, total: 7, totalPages: 7 });
    expect(page.items).toHaveLength(1);
  });
});
