import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { DriverTrip } from '@/types/driver';
import DriverHistoryPage from './DriverHistoryPage';

/**
 * The driver's completed trips.
 *
 * ★ MOCKED AT THE API MODULE, NOT AT THE HOOK. The paging is the behaviour
 * worth testing — one page, a cursor, the next page appended — and stubbing the
 * hook would test the stub. This drives the real `useInfiniteQuery` and checks
 * what actually reaches the server.
 *
 * ★ PLATES ARE ASSERTED IN THEIR RENDERED FORM. `formatPlate` normalises
 * `51C-111.11` to `51C-11111`, so the fixtures carry the stored shape and the
 * assertions carry the displayed one — matching on the input would pass only
 * until somebody looked at the screen.
 */

vi.mock('@/api/driverPortal', () => ({ fetchMyHistory: vi.fn() }));

import { fetchMyHistory } from '@/api/driverPortal';

const history = vi.mocked(fetchMyHistory);

const trip = (id: string, scheduledOn: string, plate: string): DriverTrip =>
  ({
    tripId: `t-${id}`,
    scheduledOn,
    vehicle: { id: `v-${id}`, plate },
    customer: { id: 'c1', name: 'Công ty A' },
    pickupAddress: 'KCN Sóng Thần',
    pickupContact: null,
    deliveryAddress: 'Cảng Cát Lái',
    deliveryContact: null,
    cargoInfo: null,
    pickupLocation: null,
    deliveryLocation: null,
    scheduledPickupAt: `${scheduledOn}T01:00:00.000Z`,
    scheduledDeliveryAt: null,
    driverInstructions: null,
    assignment: { id, assignedAt: `${scheduledOn}T00:00:00.000Z` },
  }) as DriverTrip;

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter>
          <DriverHistoryPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

describe('DriverHistoryPage', () => {
  beforeEach(() => {
    history.mockReset();
  });

  it('★ asks for the first page with no cursor and no driver id', async () => {
    history.mockResolvedValue({ trips: [], nextCursor: null });
    renderPage();

    // The scope is the session. There is no parameter a client could send to
    // widen it — the same security model as the schedule.
    await waitFor(() => expect(history).toHaveBeenCalledWith({ before: null }));
  });

  it('lists completed trips in the server’s order, grouped under their day', async () => {
    history.mockResolvedValue({
      trips: [trip('a1', '2026-09-12', '51C-111.11'), trip('a2', '2026-09-11', '51C-222.22')],
      nextCursor: null,
    });
    renderPage();

    const days = await screen.findAllByRole('heading', { level: 2 });
    expect(days).toHaveLength(2);
    // Newest first, and NOT re-sorted here: a second opinion on the client
    // would fight the paging the moment a later page arrived below.
    expect(days[0]).toHaveTextContent('12/09/2026');
    expect(days[1]).toHaveTextContent('11/09/2026');
    expect(screen.getAllByText(/51C-11111/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/51C-22222/).length).toBeGreaterThan(0);
  });

  it('says so when a driver has completed nothing', async () => {
    history.mockResolvedValue({ trips: [], nextCursor: null });
    renderPage();

    expect(await screen.findByText('Chưa có chuyến nào hoàn thành.')).toBeInTheDocument();
  });

  describe('paging', () => {
    it('★ the next page resumes at the cursor the server gave, and APPENDS', async () => {
      const cursor = { assignedAt: '2026-09-11T00:00:00.000Z', id: 'a2' };
      history
        .mockResolvedValueOnce({
          trips: [trip('a1', '2026-09-12', '51C-111.11')],
          nextCursor: cursor,
        })
        .mockResolvedValueOnce({
          trips: [trip('a3', '2026-09-01', '51C-333.33')],
          nextCursor: null,
        });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));

      await waitFor(() => expect(screen.getAllByText(/51C-33333/).length).toBeGreaterThan(0));
      // Appended, not replaced: a driver who scrolled does not lose what they
      // already read.
      expect(screen.getAllByText(/51C-11111/).length).toBeGreaterThan(0);
      expect(history).toHaveBeenLastCalledWith({ before: cursor });
    });

    it('★ offers nothing more when the server says there is nothing older', async () => {
      history.mockResolvedValue({
        trips: [trip('a1', '2026-09-12', '51C-111.11')],
        nextCursor: null,
      });
      renderPage();

      await screen.findAllByText(/51C-11111/);
      expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
      // A list that simply stops looks like one that failed to load the rest.
      expect(screen.getByText('Đã hết.')).toBeInTheDocument();
    });
  });

  it('★ shows no money, because the server sends none', async () => {
    history.mockResolvedValue({
      trips: [trip('a1', '2026-09-12', '51C-111.11')],
      nextCursor: null,
    });
    renderPage();

    await screen.findAllByText(/51C-11111/);
    // Not a filter applied here — `DriverTrip` carries no amount at all, and
    // the query behind it joins no table that holds one. This pins the absence
    // so a future field cannot arrive unnoticed.
    expect(document.body.textContent).not.toMatch(/₫|VND/);
  });
});
