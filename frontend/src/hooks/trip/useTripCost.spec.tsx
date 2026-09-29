import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tripKeys } from './keys';
import { useTripCost } from './useTripCost';

let permissions: string[] = [];
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => ({
    state: { status: 'ready' },
    can: (permission: string) => permissions.includes(permission),
  }),
}));
vi.mock('@/api/tripCost', () => ({
  fetchTripCosts: async () => ({ items: [], total: '0.00' }),
  fetchOutsourceHires: async () => ({ items: [], total: '0.00' }),
  fetchTripCostSummary: async () => ({ costs: '0.00', hires: '0.00', combined: '0.00' }),
}));

const boardPage = (costs: boolean) => [
  ...tripKeys.scheduleList({
    from: '2026-09-01',
    to: '2026-09-30',
    assignment: 'all',
    lifecycle: 'operational',
    sort: 'executionDate',
    direction: 'desc',
    costs,
  }),
  { page: 1, limit: 20 },
];
const BADGE = tripKeys.unassignedCount({ from: '2026-09-01', to: '2026-09-30' });
const PAGE = { items: [], page: 1, limit: 20, total: 0, totalPages: 0 };

/**
 * The board's cost column and the cost dialog show one figure, so the dialog's
 * writes and the permission's loss have to reach the board's cache too — and
 * only the board pages that actually hold money.
 */
describe('useTripCost — the board pages that carry cost', () => {
  let client: QueryClient;
  const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const key of [boardPage(true), boardPage(false), BADGE]) client.setQueryData(key, PAGE);
  });

  it('★ a recorded or withdrawn cost re-reads the board pages holding costs, and only those', () => {
    permissions = ['cost.read'];
    const { result } = renderHook(() => useTripCost('t1'), { wrapper });

    act(() => result.current.reload());

    expect(client.getQueryState(boardPage(true))?.isInvalidated).toBe(true);
    expect(client.getQueryState(boardPage(false))?.isInvalidated).toBe(false);
    expect(client.getQueryState(BADGE)?.isInvalidated).toBe(false);
  });

  it('★ losing cost.read drops the cached pages holding costs, and leaves the rest', () => {
    permissions = ['cost.read'];
    const { rerender } = renderHook(() => useTripCost(null), { wrapper });
    expect(client.getQueryData(boardPage(true))).toBeDefined();

    permissions = [];
    rerender();

    expect(client.getQueryData(boardPage(true))).toBeUndefined();
    expect(client.getQueryData(boardPage(false))).toEqual(PAGE);
    expect(client.getQueryData(BADGE)).toEqual(PAGE);
  });
});
