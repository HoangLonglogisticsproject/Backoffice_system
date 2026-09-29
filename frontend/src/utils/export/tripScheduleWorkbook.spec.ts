import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkBook, WorkSheet } from 'xlsx';
import { translate, type TranslationKey } from '@/types/translate';
import type { TripBoardRow } from '@/types/tripBoard';
import { downloadTripScheduleWorkbook } from './tripScheduleWorkbook';

/**
 * The real SheetJS writer, with only the download stubbed: what reaches the
 * file is the workbook object handed to `writeFile`.
 */
const writeFile = vi.fn();
vi.mock('xlsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('xlsx')>()),
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

const t = (key: TranslationKey) => translate('vi', key);

const trip = (id: string, costSummary: TripBoardRow['costSummary']): TripBoardRow => ({
    id, scheduledOn: '2026-08-04', legacyVehicleId: null, assignments: [],
    customerId: null, customer: null, cargoInfo: null,
    pickupAddress: null, deliveryAddress: null, pickupContact: null, deliveryContact: null,
    pickupAt: null, deliveryAt: null, sellPrice: '6000000', purchasePrice: null, note: null,
    status: 'confirmed', createdBy: 'u9', createdByUser: { id: 'u9', displayName: 'Điều Độ' },
    pickupLocationId: null, deliveryLocationId: null, pickupLocation: null, deliveryLocation: null,
    pickupLatitude: null, pickupLongitude: null, deliveryLatitude: null, deliveryLongitude: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', costSummary,
  });

const ZERO = { fuel: '0.00', toll: '0.00', warehouse: '0.00', loading: '0.00', overtime: '0.00' };

/** The written sheet as { heading → cells top to bottom }, plus its column widths. */
const written = (): { columns: Map<string, ({ t?: string; v?: unknown; z?: string } | undefined)[]>; widths: number } => {
  const [book] = writeFile.mock.calls[0] as [WorkBook];
  const sheet: WorkSheet = book.Sheets[book.SheetNames[0]!]!;
  const columns = new Map<string, ({ t?: string; v?: unknown; z?: string } | undefined)[]>();
  for (const [address, cell] of Object.entries(sheet)) {
    const match = /^([A-Z]+)1$/.exec(address);
    if (!match) continue;
    const cellsBelow = [2, 3, 4].map((row) => sheet[`${match[1]}${row}`] as { t?: string; v?: unknown; z?: string } | undefined);
    columns.set(String((cell as { v: unknown }).v), cellsBelow);
  }
  return { columns, widths: (sheet['!cols'] ?? []).length };
};

describe('downloadTripScheduleWorkbook — the cost block in the file', () => {
  beforeEach(() => writeFile.mockReset());

  /** Three rows: recorded costs (one fractional), no figure at all, and a counted zero. */
  const exportTwo = async (includeCosts: boolean, lifecycle: 'operational' | 'history' = 'operational') => {
    const counted = { total: '600000.50', itemCount: 3, hires: '0.00', byCategory: { ...ZERO, fuel: '600000.50' } };
    const nothingRecorded = { total: '0.00', itemCount: 0, hires: '0.00', byCategory: ZERO };
    return downloadTripScheduleWorkbook({
      trips: [trip('t1', counted), trip('t2', null), trip('t3', nothingRecorded)],
      t, language: 'vi', range: { from: '2026-08-01', to: '2026-08-31' },
      includePrices: true, includeCosts, lifecycle,
    });
  };

  it('★ writes cost cells as NUMBERS in the money format, one row per trip', async () => {
    expect(await exportTwo(true)).toBe(3);
    const { columns } = written();

    for (const heading of ['Dầu', 'Tăng ca', 'Xe thuê ngoài', 'Tổng chi phí chuyến', 'Giá cước bán']) {
      expect(columns.get(heading)?.[0]).toMatchObject({ t: 'n', z: '#,##0' });
    }
    // The stored value keeps its fraction; only the display format rounds it.
    expect(columns.get('Dầu')?.[0]?.v).toBe(600000.5);
    expect(columns.get('Tăng ca')?.[0]?.v).toBe(0);
  });

  it('★ writes an authorized trip with nothing recorded as numeric 0s, the total included', async () => {
    await exportTwo(true);
    const { columns } = written();

    for (const heading of ['Dầu', 'Cầu trạm', 'Phí kho', 'Bốc xếp', 'Tăng ca', 'Xe thuê ngoài', 'Tổng chi phí chuyến']) {
      expect(columns.get(heading)?.[2]).toMatchObject({ t: 'n', v: 0, z: '#,##0' });
    }
  });

  it('★ leaves an unknown cost as an empty cell — no zero, no text', async () => {
    await exportTwo(true);
    // SheetJS keeps `null` as a stub cell (`t: 'z'`), which the file writes as
    // nothing at all; what matters is that it is neither a number nor text.
    const cell = written().columns.get('Tổng chi phí chuyến')?.[1];

    expect(cell?.t).not.toBe('n');
    expect(cell?.v ?? null).toBeNull();
  });

  it('gives every written column a width', async () => {
    await exportTwo(true);
    const { columns, widths } = written();

    expect(widths).toBe(columns.size);
  });

  it('★ writes no cost column at all without cost.read', async () => {
    await exportTwo(false);
    const { columns, widths } = written();

    expect([...columns.keys()]).not.toContain('Tổng chi phí chuyến');
    expect(widths).toBe(columns.size);
  });
});

describe('downloadTripScheduleWorkbook — Lịch sử chuyến', () => {
  beforeEach(() => writeFile.mockReset());

  const exportHistory = (includeCosts: boolean) =>
    downloadTripScheduleWorkbook({
      trips: [trip('t1', { total: '800000.00', itemCount: 1, hires: '0.00', byCategory: { ...ZERO, fuel: '800000.00' } })],
      t, language: 'vi', range: { from: '2026-08-01', to: '2026-08-31' },
      includePrices: true, includeCosts, lifecycle: 'history',
    });

  it('★ names the file and the sheet after the screen it came from', async () => {
    await exportHistory(true);
    const [book, fileName] = writeFile.mock.calls[0] as [WorkBook, string];

    expect(fileName).toBe('lich-su-chuyen_2026-08-01_2026-08-31.xlsx');
    expect(book.SheetNames).toEqual(['Lịch sử chuyến']);
  });

  it('★ drops the status column — every row is finished — and keeps the money, numeric', async () => {
    await exportHistory(true);
    const { columns, widths } = written();

    expect([...columns.keys()]).not.toContain('Trạng thái');
    expect(columns.get('Dầu')?.[0]).toMatchObject({ t: 'n', v: 800000, z: '#,##0' });
    expect(columns.get('Giá cước bán')?.[0]).toMatchObject({ t: 'n', v: 6000000 });
    expect(widths).toBe(columns.size);
  });

  it('writes no cost column without the export key, on this screen too', async () => {
    await exportHistory(false);
    const { columns, widths } = written();

    expect([...columns.keys()]).not.toContain('Tổng chi phí chuyến');
    expect(widths).toBe(columns.size);
  });
});
