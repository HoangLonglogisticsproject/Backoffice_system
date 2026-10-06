import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { holdsFleetMoney } from '@/hooks/trip/keys';
import type { FleetBoard, FleetTurn, FleetVehicleDay } from '@/types/fleet';
import FleetOperationsPage from './FleetOperationsPage';

/**
 * "Điều hành xe", as a dispatcher and as the SuperAdmin use it.
 *
 * ★ THE SCREEN DERIVES NOTHING. States, the fuel answer and the amounts are the
 * server's; this file pins that they are shown as sent — and that an amount the
 * server left out (`null`, no `cost.read`) never turns into a figure here.
 */
const fetchFleetBoard = vi.fn();
const fetchVehicleCosts = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/fleetOperations', () => ({ fetchFleetBoard: (...a: unknown[]) => fetchFleetBoard(...a) }));
vi.mock('@/api/vehicleCost', () => ({
  VEHICLE_COST_PAGE_LIMIT: 200,
  fetchVehicleCosts: (...a: unknown[]) => fetchVehicleCosts(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({ useSession: () => useSession() }));

const session = (permissions: string[]) => ({ can: (p: string) => permissions.includes(p), loading: false });

const turn = (over: Partial<FleetTurn> = {}): FleetTurn => ({
  assignmentId: 'a1',
  tripId: 't1',
  scheduledOn: '2026-10-06',
  scheduledPickupAt: null,
  scheduledDeliveryAt: null,
  pickupName: 'Cảng Cát Lái',
  deliveryName: 'KCN Tân Tạo',
  customerName: 'VIỄN ĐẠT',
  driver: { id: 'd1', displayName: 'Tài Xế A' },
  closed: false,
  progress: { reached: 2, next: 'ARRIVED_DELIVERY' },
  state: 'running',
  ...over,
});

const vehicle = (id: string, plate: string, over: Partial<FleetVehicleDay> = {}): FleetVehicleDay => ({
  vehicle: { id, plate, ownership: 'company', dailyFuelCheckRequired: true, archived: false },
  state: 'running',
  drivers: [{ id: 'd1', displayName: 'Tài Xế A' }],
  turns: [turn()],
  fuel: {
    obligation: 'FUEL_ADDED',
    check: { outcome: 'fuel_added', declaredBy: { id: 'd1', displayName: 'Tài Xế A' }, declaredAt: '2026-10-06T00:30:00.000Z', vehicleCostId: 'c1', amount: '650000.00' },
    fills: 2,
    totalAmount: '950000.00',
    issues: [],
  },
  ...over,
});

const board = (withMoney: boolean): FleetBoard => {
  const money = <T,>(value: T) => (withMoney ? value : null);
  const running = vehicle('v1', '51H27314');
  return {
    businessDate: '2026-10-06',
    withMoney,
    summary: { total: 3, running: 1, waiting: 1, unassigned: 1, fuelMissing: 1 },
    vehicles: [
      { ...running, fuel: { ...running.fuel, totalAmount: money('950000.00'), check: { ...running.fuel.check!, amount: money('650000.00') } } },
      vehicle('v2', '51C99999', {
        state: 'waiting',
        drivers: [{ id: 'd2', displayName: 'Tài Xế B' }],
        turns: [turn({ assignmentId: 'a2', state: 'waiting', progress: { reached: 0, next: 'ARRIVED_PICKUP' }, driver: { id: 'd2', displayName: 'Tài Xế B' }, pickupName: 'Kho Sóng Thần' })],
        fuel: { obligation: 'REQUIRED_MISSING', check: null, fills: 0, totalAmount: money('0.00'), issues: ['FUEL_UNDECLARED'] },
      }),
      vehicle('v3', '60A11111', {
        state: 'unassigned',
        drivers: [],
        turns: [],
        fuel: { obligation: 'NOT_REQUIRED', check: null, fills: 0, totalAmount: money('0.00'), issues: [] },
      }),
    ],
  };
};

const page = (client: QueryClient) => (
  <QueryClientProvider client={client}>
    <LanguageProvider>
      <MemoryRouter>
        <FleetOperationsPage />
      </MemoryRouter>
    </LanguageProvider>
  </QueryClientProvider>
);
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderPage = () => render(page(newClient()));

const rowOf = async (plate: RegExp) => {
  const table = await screen.findByRole('table', { name: /Điều hành xe/ });
  const row = within(table).getAllByRole('row').find((candidate) => plate.test(candidate.textContent ?? ''));
  if (!row) throw new Error(`No row for ${plate}`);
  return row;
};

describe('★ Điều hành xe', () => {
  beforeEach(() => {
    fetchFleetBoard.mockReset();
    fetchVehicleCosts.mockReset().mockResolvedValue({
      items: [
        { id: 'c1', vehicleId: 'v1', businessDate: '2026-10-06', category: 'fuel', amount: '650000.00', liters: '40.00', odometerKm: 120000, note: null, source: 'driver_portal', sourceTripId: 't1', sourceTrip: null, sourceAssignmentId: 'a1', createdBy: 'd1', createdByUser: { id: 'd1', displayName: 'Tài Xế A' }, createdAt: '2026-10-06T00:30:00.000Z', voidedAt: null, voidedBy: null, voidReason: null },
        { id: 'c2', vehicleId: 'v1', businessDate: '2026-10-06', category: 'fuel', amount: '300000.00', liters: null, odometerKm: null, note: null, source: 'driver_portal', sourceTripId: 't1', sourceTrip: null, sourceAssignmentId: 'a1', createdBy: 'd1', createdByUser: { id: 'd1', displayName: 'Tài Xế A' }, createdAt: '2026-10-06T05:00:00.000Z', voidedAt: null, voidedBy: null, voidReason: null },
      ],
      total: 2,
      totalAmount: '950000.00',
      page: 1,
      limit: 200,
    });
  });

  it('shows the day in five numbers and one row per lorry, as the server derived it', async () => {
    useSession.mockReturnValue(session(['trip.read', 'cost.read']));
    fetchFleetBoard.mockResolvedValue(board(true));
    renderPage();

    const running = await rowOf(/51H/);
    expect(screen.getByRole('button', { name: /Tổng xe/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /Chưa khai nhiên liệu/ })).toHaveTextContent('1');
    expect(running).toHaveTextContent('Đang chạy');
    expect(running).toHaveTextContent('Cảng Cát Lái → KCN Tân Tạo');
    expect(running).toHaveTextContent('Đã khai · Có đổ nhiên liệu');
    expect(running).toHaveTextContent(/950[.,]000/);
    expect(await rowOf(/51C/)).toHaveTextContent('Chưa khai');
    expect(await rowOf(/60A/)).toHaveTextContent('Chưa phân công');
    expect(fetchFleetBoard).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('★ shows no amount the server did not send — and says why', async () => {
    useSession.mockReturnValue(session(['trip.read']));
    fetchFleetBoard.mockResolvedValue(board(false));
    renderPage();

    const running = await rowOf(/51H/);
    expect(running).not.toHaveTextContent(/950[.,]000/);
    expect(running).toHaveTextContent('2 giao dịch');
    expect(screen.getByText('Số tiền nhiên liệu chỉ hiển thị cho người có quyền xem chi phí.')).toBeTruthy();
  });

  it('filters by a summary card, by state, by driver and by a search that ignores Vietnamese marks', async () => {
    useSession.mockReturnValue(session(['trip.read']));
    fetchFleetBoard.mockResolvedValue(board(false));
    renderPage();
    const plates = async () => {
      const table = await screen.findByRole('table', { name: /Điều hành xe/ });
      return within(table).getAllByRole('row').slice(1).map((row) => row.querySelector('td')?.textContent);
    };
    await rowOf(/51H/);

    fireEvent.click(screen.getByRole('button', { name: /Chưa khai nhiên liệu/ }));
    expect(await plates()).toEqual([expect.stringMatching(/^51C/)]);
    fireEvent.click(screen.getByRole('button', { name: /Tổng xe/ }));
    fireEvent.change(screen.getByLabelText('Tài xế'), { target: { value: 'd2' } });
    expect(await plates()).toEqual([expect.stringMatching(/^51C/)]);
    fireEvent.change(screen.getByLabelText('Tài xế'), { target: { value: '' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Tìm biển số/ }), { target: { value: 'cat lai' } });
    expect(await plates()).toEqual([expect.stringMatching(/^51H/)]);
    fireEvent.change(screen.getByRole('textbox', { name: /Tìm biển số/ }), { target: { value: 'không có' } });
    expect(await screen.findByText('Không có xe nào khớp bộ lọc.')).toBeTruthy();
  });

  it('★ opens a lorry: the check and the day\'s fills kept apart, the declaration\'s fill marked', async () => {
    useSession.mockReturnValue(session(['trip.read', 'cost.read']));
    fetchFleetBoard.mockResolvedValue(board(true));
    renderPage();

    fireEvent.click(within(await rowOf(/51H/)).getByRole('button', { name: /Xem chi tiết/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Tổng quan', 'Lịch chạy', 'Nhiên liệu', 'Chi phí']);
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Nhiên liệu' }));

    const check = await within(dialog).findByRole('region', { name: 'Khai nhiên liệu đầu ca' });
    expect(check).toHaveTextContent('Đã khai · Có đổ nhiên liệu');
    expect(check).toHaveTextContent(/650[.,]000/);
    const fills = within(dialog).getByRole('region', { name: 'Giao dịch nhiên liệu trong ngày' });
    expect(await within(fills).findByText(/950[.,]000/)).toBeTruthy();
    expect(fills).toHaveTextContent('Khai đầu ca');
    expect(fills).toHaveTextContent('Đổ thêm');
    expect(fetchVehicleCosts).toHaveBeenCalledWith('v1', { from: '2026-10-06', to: '2026-10-06' });
  });

  it('★ without cost.read: no "Chi phí" tab, no ledger read, the fills counted only', async () => {
    useSession.mockReturnValue(session(['trip.read']));
    fetchFleetBoard.mockResolvedValue(board(false));
    renderPage();

    fireEvent.click(within(await rowOf(/51H/)).getByRole('button', { name: /Xem chi tiết/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('tab', { name: 'Chi phí' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Nhiên liệu' }));
    const fills = await within(dialog).findByRole('region', { name: 'Giao dịch nhiên liệu trong ngày' });
    expect(fills).toHaveTextContent('2 giao dịch');
    await waitFor(() => expect(fetchVehicleCosts).not.toHaveBeenCalled());
  });

  it('★ drops every day read with money once cost.read is gone — never served again', async () => {
    const client = newClient();
    const moneyCached = () =>
      client.getQueryCache().findAll({ queryKey: ['trip', 'fleet'] }).some((query) => holdsFleetMoney(query.queryKey));
    useSession.mockReturnValue(session(['trip.read', 'cost.read']));
    fetchFleetBoard.mockImplementation(async () => board(useSession().can('cost.read')));
    const view = render(page(client));
    expect(await rowOf(/51H/)).toHaveTextContent(/950[.,]000/);
    expect(moneyCached()).toBe(true);

    useSession.mockReturnValue(session(['trip.read']));
    view.rerender(page(client));

    await waitFor(() => expect(moneyCached()).toBe(false));
    await waitFor(async () => expect(await rowOf(/51H/)).not.toHaveTextContent(/950[.,]000/));
  });

  it('lists the lorry\'s runs of the day with progress in words', async () => {
    useSession.mockReturnValue(session(['trip.read']));
    fetchFleetBoard.mockResolvedValue(board(false));
    renderPage();

    fireEvent.click(within(await rowOf(/51C/)).getByRole('button', { name: /Xem chi tiết/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Lịch chạy' }));
    expect(await within(dialog).findByText(/Kho Sóng Thần → KCN Tân Tạo/)).toBeTruthy();
    expect(dialog).toHaveTextContent('0/4 · Chưa bắt đầu');
  });
});
