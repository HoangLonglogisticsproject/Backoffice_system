import { describe, expect, it } from 'vitest';
import { translate, type TranslationKey } from '@/types/translate';
import type { TripAssignmentRef } from '@/types/trip';
import type { TripBoardRow, TripCostSummary } from '@/types/tripBoard';
import { toTripSheetRows, tripSheetColumnWidths } from './tripScheduleSheet';

/**
 * The cost block inside the whole sheet: where it sits, who gets it, and what
 * it never does to the rest of the row.
 */
const t = (key: TranslationKey) => translate('vi', key);

const turn = (id: string, plate: string): TripAssignmentRef => ({
  id, vehicle: { id: `v-${id}`, plate }, driver: { id: 'd1', displayName: 'Tài Xế A' },
  assignedAt: '2026-08-04T01:00:00.000Z', started: false,
});

const costs = (over: Partial<TripCostSummary> = {}): TripCostSummary => ({
  total: '0.00', itemCount: 0, hires: '0.00',
  byCategory: { fuel: '0.00', toll: '0.00', warehouse: '0.00', loading: '0.00', overtime: '0.00' },
  ...over,
});

const trip = (over: Partial<TripBoardRow> = {}): TripBoardRow =>
  ({
    id: 't1', scheduledOn: '2026-08-04', legacyVehicleId: null, assignments: [turn('a1', '50H49266')],
    customerId: 'c1', customer: { id: 'c1', name: 'WWL' }, cargoInfo: null,
    pickupAddress: null, deliveryAddress: null, pickupContact: null, deliveryContact: null,
    pickupAt: null, deliveryAt: null, sellPrice: '6000000', purchasePrice: '3000000', note: null,
    status: 'confirmed', createdBy: 'u9', createdByUser: { id: 'u9', displayName: 'Điều Độ' },
    pickupLocationId: null, deliveryLocationId: null, pickupLocation: null, deliveryLocation: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    costSummary: costs({ total: '800000.00', itemCount: 1, byCategory: { ...costs().byCategory, fuel: '800000.00' } }),
    ...over,
  }) as TripBoardRow;

/**
 * The 17 headings the sheet had before it had costs — pinned, not derived, and
 * checked against `origin/main`'s own mapper when this was written.
 */
const BEFORE = [
  '#', 'Ngày', 'Xe', 'Tài xế', 'Khách hàng', 'Hàng hoá', 'Điểm lấy hàng',
  'Điểm lấy hàng — Liên hệ', 'Điểm lấy hàng — Thời gian', 'Điểm giao hàng',
  'Điểm giao hàng — Liên hệ', 'Điểm giao hàng — Thời gian', 'Trạng thái',
  'Giá cước bán', 'Giá cước mua', 'Ghi chú', 'Người tạo',
];
const COST_BLOCK = ['Dầu', 'Cầu trạm', 'Phí kho', 'Bốc xếp', 'Tăng ca', 'Xe thuê ngoài', 'Tổng chi phí chuyến'];

const headingsOf = (visible: { prices?: boolean; costs?: boolean }) =>
  Object.keys(toTripSheetRows([trip()], t, 'vi', visible)[0]!);

describe('toTripSheetRows — the cost block', () => {
  it('★ leaves every existing column exactly as it was when costs are not asked for', () => {
    expect(headingsOf({ prices: true })).toEqual(BEFORE);
  });

  it('★ places the block after "Giá cước mua" and before "Ghi chú", moving nothing else', () => {
    expect(headingsOf({ prices: true, costs: true })).toEqual([
      ...BEFORE.slice(0, 15), ...COST_BLOCK, ...BEFORE.slice(15),
    ]);
  });

  it('★ omits the block without cost.read — even when a figure arrived — and leaks none of it', () => {
    const [row] = toTripSheetRows([trip()], t, 'vi', { prices: true });

    COST_BLOCK.forEach((heading) => expect(Object.keys(row!)).not.toContain(heading));
    expect(JSON.stringify(row)).not.toContain('800000');
  });

  it('★ keeps a multi-lorry trip on one row, its money once', () => {
    const rows = toTripSheetRows(
      [trip({ assignments: [turn('a1', '50H49266'), turn('a2', '51D65233'), turn('a3', '51C12345')] })],
      t, 'vi', { costs: true },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!['Dầu']).toBe(800000);
  });

  it('keeps each trip’s money on its own row', () => {
    const rows = toTripSheetRows(
      [trip(), trip({ id: 't2', costSummary: costs({ total: '50.00', itemCount: 1, hires: '50.00' }) })],
      t, 'vi', { costs: true },
    );

    expect(rows.map((row) => [row['Dầu'], row['Xe thuê ngoài'], row['Tổng chi phí chuyến']])).toEqual([
      [800000, 0, 800000],
      [0, 50, 50],
    ]);
  });

  it('★ never adds "Giá cước mua" into the cost total — a hire may be the same payment', () => {
    const [row] = toTripSheetRows(
      [trip({
        purchasePrice: '4500000',
        costSummary: costs({
          total: '4700000.00', itemCount: 2, hires: '4500000.00',
          byCategory: { ...costs().byCategory, loading: '200000.00' },
        }),
      })],
      t, 'vi', { prices: true, costs: true },
    );

    expect(row!['Giá cước mua']).toBe(4500000);
    expect(row!['Xe thuê ngoài']).toBe(4500000);
    expect(row!['Tổng chi phí chuyến']).toBe(4700000);
    expect(row!['Tổng chi phí chuyến']).not.toBe(9200000);
  });

  /**
   * ★ AUTHORIZED AND NOTHING RECORDED IS ZERO, NOT BLANK. The server sends a
   * summary of "0.00"s for every trip it counted — a trip with no line still
   * gets one — so a SUPERADMIN exporting a quiet month gets the whole block,
   * every cell a number. Whether the block exists is never read off the figures.
   */
  it('★ gives 100 trips with nothing recorded the full block, every cell a numeric 0', () => {
    const quiet = Array.from({ length: 100 }, (_, i) => trip({ id: `t${i}`, costSummary: costs() }));
    const rows = toTripSheetRows(quiet, t, 'vi', { costs: true });

    expect(rows).toHaveLength(100);
    for (const row of rows) {
      expect(COST_BLOCK.map((heading) => row[heading])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    }
  });

  it('★ decides the block from the viewer, never from the rows — a first row without a figure changes nothing', () => {
    const rows = toTripSheetRows([trip({ costSummary: null }), trip({ id: 't2' })], t, 'vi', { costs: true });

    expect(Object.keys(rows[0]!)).toEqual(expect.arrayContaining(COST_BLOCK));
    expect(rows[1]!['Tổng chi phí chuyến']).toBe(800000);
  });

  /**
   * The one blank: a viewer who holds `cost.read` by their session, yet a row
   * arrived with no figure — a session gone stale or a server fault. Unknown is
   * not zero, and it is never "no costs": that arrives as zeros, above.
   */
  it('★ writes a row that arrived with no figure as blank cells — unknown, not zero', () => {
    const [row] = toTripSheetRows([trip({ costSummary: null })], t, 'vi', { costs: true });

    COST_BLOCK.forEach((heading) => expect(row![heading]).toBeNull());
  });

  it.each([
    { prices: false, costs: false },
    { prices: true, costs: false },
    { prices: false, costs: true },
    { prices: true, costs: true },
  ])('★ gives every column a width — prices $prices, costs $costs', (visible) => {
    expect(tripSheetColumnWidths(visible)).toHaveLength(headingsOf(visible).length);
  });
});
