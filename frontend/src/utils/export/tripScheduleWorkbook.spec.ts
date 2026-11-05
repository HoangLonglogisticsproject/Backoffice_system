import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkBook, WorkSheet } from 'xlsx';
import { translate, type TranslationKey } from '@/types/translate';
import type { TripExportScope } from '@/types/trip';
import type { TripBoardRow } from '@/types/tripBoard';
import { downloadTripScheduleWorkbook, exportDetails, type TripScheduleExport } from './tripScheduleWorkbook';

/**
 * The real SheetJS writer, with only the download stubbed: what reaches the
 * file is the workbook object handed to `writeFile`.
 */
const writeFile = vi.fn();
/** Set by the case whose download fails; the stub then throws as `writeFile` would. */
let writeFailure: Error | null = null;
vi.mock('xlsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('xlsx')>()),
  writeFile: (...args: unknown[]) => {
    if (writeFailure) throw writeFailure;
    return writeFile(...args);
  },
}));

const t = (key: TranslationKey) => translate('vi', key);

const trip = (id: string, costSummary: TripBoardRow['costSummary'], over: Partial<TripBoardRow> = {}): TripBoardRow => ({
    id, scheduledOn: '2026-08-04', legacyVehicleId: null, assignments: [],
    customerId: null, customer: null, cargoInfo: null,
    pickupAddress: null, deliveryAddress: null, pickupContact: null, deliveryContact: null,
    pickupAt: null, deliveryAt: null, sellPrice: '6000000', purchasePrice: null, note: null,
    status: 'pending', createdBy: 'u9', createdByUser: { id: 'u9', displayName: 'Điều Độ' },
    pickupLocationId: null, deliveryLocationId: null, pickupLocation: null, deliveryLocation: null,
    pickupLatitude: null, pickupLongitude: null, deliveryLatitude: null, deliveryLongitude: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', costSummary,
    ...over,
  });

const ZERO = { fuel: '0.00', toll: '0.00', warehouse: '0.00', loading: '0.00', overtime: '0.00' };
const READ_AT = '2026-11-05T08:42:07.000Z';

/** Everything a file needs besides its rows; a case overrides what it is about. */
const request = (over: Partial<TripScheduleExport>): TripScheduleExport => ({
  trips: [],
  t,
  range: { from: '2026-08-01', to: '2026-08-31' },
  customer: '',
  readAt: READ_AT,
  includePrices: true,
  includeCosts: true,
  scope: 'operational',
  now: new Date('2026-11-05T08:42:09.000Z'),
  ...over,
});

type Cell = { t?: string; v?: unknown; z?: string } | undefined;

/** The written DATA sheet as { heading → cells top to bottom }, plus its column widths and heading order. */
const written = (): { columns: Map<string, Cell[]>; headings: string[]; widths: number } => {
  const [book] = writeFile.mock.calls[0] as [WorkBook];
  const sheet: WorkSheet = book.Sheets[book.SheetNames[0]!]!;
  const columns = new Map<string, Cell[]>();
  const headings: string[] = [];
  for (const [address, cell] of Object.entries(sheet)) {
    const match = /^([A-Z]+)1$/.exec(address);
    if (!match) continue;
    const heading = String((cell as { v: unknown }).v);
    headings.push(heading);
    columns.set(heading, [2, 3, 4].map((row) => sheet[`${match[1]}${row}`] as Cell));
  }
  return { columns, headings, widths: (sheet['!cols'] ?? []).length };
};

describe('downloadTripScheduleWorkbook — the cost block in the file', () => {
  beforeEach(() => writeFile.mockReset());

  /** Three rows: recorded costs (one fractional), no figure at all, and nothing recorded. */
  const exportThree = async (includeCosts: boolean, scope: TripExportScope = 'operational') => {
    const counted = { total: '600000.50', itemCount: 3, hires: '0.00', byCategory: { ...ZERO, fuel: '600000.50' } };
    const nothingRecorded = { total: '0.00', itemCount: 0, hires: '0.00', byCategory: ZERO };
    return downloadTripScheduleWorkbook(
      request({ trips: [trip('t1', counted), trip('t2', null), trip('t3', nothingRecorded)], includeCosts, scope }),
    );
  };

  it('★ writes cost cells as NUMBERS in the money format, one row per trip', async () => {
    expect(await exportThree(true)).toBe(3);
    const { columns } = written();

    for (const heading of ['Dầu', 'Tổng chi phí chuyến', 'Giá cước bán']) {
      expect(columns.get(heading)?.[0]).toMatchObject({ t: 'n', z: '#,##0' });
    }
    // The stored value keeps its fraction; only the display format rounds it.
    expect(columns.get('Dầu')?.[0]?.v).toBe(600000.5);
  });

  /**
   * ★ NO LIVE LINE IS AN EMPTY CELL, NOT A 0 — finished trip or not. A 0 in a
   * file reads as "confirmed to have cost nothing", which nobody said.
   */
  it('★ leaves every cost cell of a trip with nothing recorded EMPTY — the total included', async () => {
    await exportThree(true);
    const { columns } = written();

    for (const heading of ['Dầu', 'Cầu trạm', 'Phí kho', 'Bốc xếp', 'Tăng ca', 'Xe thuê ngoài', 'Tổng chi phí chuyến']) {
      const cell = columns.get(heading)?.[2];
      expect(cell?.t).not.toBe('n');
      expect(cell?.v ?? null).toBeNull();
    }
  });

  it('★ leaves a category with no line empty beside one that has a figure', async () => {
    await exportThree(true);
    const { columns } = written();

    expect(columns.get('Dầu')?.[0]?.v).toBe(600000.5);
    expect(columns.get('Tăng ca')?.[0]?.v ?? null).toBeNull();
    expect(columns.get('Xe thuê ngoài')?.[0]?.v ?? null).toBeNull();
  });

  it('★ leaves an unknown cost as an empty cell — no zero, no text', async () => {
    await exportThree(true);
    // SheetJS keeps `null` as a stub cell (`t: 'z'`), which the file writes as
    // nothing at all; what matters is that it is neither a number nor text.
    const cell = written().columns.get('Tổng chi phí chuyến')?.[1];

    expect(cell?.t).not.toBe('n');
    expect(cell?.v ?? null).toBeNull();
  });

  it('gives every written column a width — in every scope', async () => {
    for (const scope of ['operational', 'history', 'all'] as const) {
      writeFile.mockReset();
      await exportThree(true, scope);
      const { columns, widths } = written();

      expect(widths).toBe(columns.size);
    }
  });

  it('★ writes no cost column at all without the export key', async () => {
    await exportThree(false);
    const { columns, widths } = written();

    expect([...columns.keys()]).not.toContain('Tổng chi phí chuyến');
    expect(widths).toBe(columns.size);
  });
});

describe('downloadTripScheduleWorkbook — days and times as real dates', () => {
  beforeEach(() => writeFile.mockReset());

  /**
   * ★ A DATE CELL, NOT TEXT. "5/11/2026" as text sorts after "10/11/2026", and
   * an English screen used to write "11/5/2026". The serial is the same for
   * every reader; the format pins dd/mm/yyyy.
   */
  it('★ writes the pickup day as a date serial shown dd/mm/yyyy — the last day of the range included', async () => {
    await downloadTripScheduleWorkbook(
      request({
        range: { from: '2026-11-02', to: '2026-11-08' },
        trips: [trip('a', null, { scheduledOn: '2026-11-02' }), trip('b', null, { scheduledOn: '2026-11-08' })],
      }),
    );
    const day = written().columns.get('Ngày');

    expect(day?.[0]).toMatchObject({ t: 'n', v: 46328, z: 'dd/mm/yyyy' });
    expect(day?.[1]).toMatchObject({ t: 'n', v: 46334, z: 'dd/mm/yyyy' });
  });

  /**
   * ★ HỒ CHÍ MINH'S CLOCK, WHATEVER THE BROWSER'S. 16:30 UTC is 23:30 on the
   * 8th in the office and 17:15 UTC is 00:15 on the 9th — the file must say
   * so even when made on a laptop set to another zone (the suite runs this
   * file under TZ=UTC, and `sheetDate.spec` under America/New_York).
   */
  it('★ writes pickup and delivery as date-time serials on Hồ Chí Minh’s clock, shown dd/mm/yyyy hh:mm', async () => {
    await downloadTripScheduleWorkbook(
      request({
        trips: [trip('a', null, { pickupAt: '2026-11-08T16:30:00.000Z', deliveryAt: '2026-11-08T17:15:00.000Z' })],
      }),
    );
    const { columns } = written();
    const pickup = columns.get('Điểm lấy hàng — Thời gian')?.[0];
    const delivery = columns.get('Điểm giao hàng — Thời gian')?.[0];

    expect(pickup).toMatchObject({ t: 'n', z: 'dd/mm/yyyy hh:mm' });
    expect(pickup?.v).toBeCloseTo(46334 + 23.5 / 24, 8);
    expect(delivery?.v).toBeCloseTo(46335 + 0.25 / 24, 8);
  });

  it('leaves a missing time an empty cell, not a date of 1900', async () => {
    await downloadTripScheduleWorkbook(request({ trips: [trip('a', null)] }));

    const cell = written().columns.get('Điểm lấy hàng — Thời gian')?.[0];
    expect(cell?.t).not.toBe('n');
    expect(cell?.v ?? null).toBeNull();
  });
});

describe('downloadTripScheduleWorkbook — which screen the file is of', () => {
  beforeEach(() => writeFile.mockReset());

  const finished = trip('t1', { total: '800000.00', itemCount: 1, hires: '0.00', byCategory: { ...ZERO, fuel: '800000.00' } }, {
    status: 'finished',
  });
  const legacy = trip('t2', null, { status: 'confirmed' });
  const open = trip('t3', null, { status: 'executing' });

  /** The columns every file of Lịch xe has had — the template people reconcile against. */
  const LICH_XE = [
    '#', 'Ngày', 'Xe', 'Tài xế', 'Khách hàng', 'Hàng hoá',
    'Điểm lấy hàng', 'Điểm lấy hàng — Liên hệ', 'Điểm lấy hàng — Thời gian',
    'Điểm giao hàng', 'Điểm giao hàng — Liên hệ', 'Điểm giao hàng — Thời gian',
    'Trạng thái', 'Giá cước bán', 'Giá cước mua',
    'Dầu', 'Cầu trạm', 'Phí kho', 'Bốc xếp', 'Tăng ca', 'Xe thuê ngoài', 'Tổng chi phí chuyến',
    'Ghi chú', 'Người tạo',
  ];

  it('★ keeps Lịch xe’s columns exactly, in the same order — nothing inserted', async () => {
    await downloadTripScheduleWorkbook(request({ trips: [open], scope: 'operational' }));

    expect(written().headings).toEqual(LICH_XE);
  });

  it('★ keeps Lịch sử chuyến’s columns — Lịch xe’s without the status — and names the file after it', async () => {
    await downloadTripScheduleWorkbook(request({ trips: [finished], scope: 'history' }));
    const [book, fileName] = writeFile.mock.calls[0] as [WorkBook, string];

    expect(fileName).toBe('lich-su-chuyen_2026-08-01_2026-08-31.xlsx');
    expect(book.SheetNames).toEqual(['Lịch sử chuyến', 'Thông tin xuất']);
    expect(written().headings).toEqual(LICH_XE.filter((heading) => heading !== 'Trạng thái'));
    expect(written().columns.get('Dầu')?.[0]).toMatchObject({ t: 'n', v: 800000, z: '#,##0' });
  });

  /**
   * ★ BOTH SCREENS: Lịch xe's layout, with "Nhóm chuyến" and "Mã chuyến"
   * APPENDED — nothing anybody filters on moves. The group follows the same
   * rule as the server's split, so a retired "Đã xác nhận (dữ liệu cũ)" is
   * Lịch xe, exactly where the board still lists it.
   */
  it('★ the combined file: Lịch xe’s columns, then group and trip id — status and group per the server’s split', async () => {
    await downloadTripScheduleWorkbook(
      request({ trips: [finished, legacy, open], scope: 'all', range: { from: '2026-11-02', to: '2026-11-08' } }),
    );
    const [book, fileName] = writeFile.mock.calls[0] as [WorkBook, string];
    const { headings, columns } = written();

    expect(fileName).toBe('tong-hop-chuyen_2026-11-02_2026-11-08.xlsx');
    expect(book.SheetNames).toEqual(['Tổng hợp chuyến', 'Thông tin xuất']);
    expect(headings).toEqual([...LICH_XE, 'Nhóm chuyến', 'Mã chuyến']);
    expect(columns.get('Trạng thái')?.map((cell) => cell?.v)).toEqual([
      'Đã xác nhận',
      'Đã xác nhận (dữ liệu cũ)',
      'Đang thực hiện',
    ]);
    expect(columns.get('Nhóm chuyến')?.map((cell) => cell?.v)).toEqual(['Lịch sử chuyến', 'Lịch xe', 'Lịch xe']);
    expect(columns.get('Mã chuyến')?.map((cell) => cell?.v)).toEqual(['t1', 't2', 't3']);
  });

  it('★ a file that cannot be written fails the call — the caller then says no success', async () => {
    writeFailure = new Error('disk full');
    try {
      await expect(downloadTripScheduleWorkbook(request({ trips: [open] }))).rejects.toThrow('disk full');
    } finally {
      writeFailure = null;
    }
  });
});

describe('exportDetails — the "Thông tin xuất" sheet', () => {
  const rows = (over: Partial<TripScheduleExport>) => new Map(exportDetails(request(over)).map(([k, v]) => [k, v]));

  it('★ states the scope, the period by pickup day, the customers, the exclusion and when the data was read', () => {
    const details = rows({
      scope: 'all',
      range: { from: '2026-11-02', to: '2026-11-08' },
      trips: [trip('a', null, { status: 'finished' }), trip('b', null), trip('c', null, { status: 'confirmed' })],
    });

    expect(details.get('Phạm vi')).toBe('Cả Lịch xe và Lịch sử chuyến');
    expect(details.get('Kỳ xuất (theo ngày lấy hàng)')).toBe('02/11/2026 – 08/11/2026 (gồm cả ngày đầu và ngày cuối)');
    expect(details.get('Khách hàng')).toBe('Tất cả khách hàng');
    expect(details.get('Không gồm')).toBe('Chuyến đã lưu trữ');
    // 08:42:07 UTC is 15:42:07 in Hồ Chí Minh — the SERVER's clock, labelled as such.
    expect(details.get('Thời điểm bắt đầu đọc dữ liệu — giờ máy chủ')).toBe('05/11/2026 15:42:07 (giờ Việt Nam)');
    expect(details.get('Thời điểm tạo file')).toBe('05/11/2026 15:42:09 (giờ Việt Nam, theo đồng hồ máy tính tạo file)');
    expect(details.get('Số chuyến')).toBe('3 (Lịch xe: 2 · Lịch sử chuyến: 1)');
    expect(details.get('Nhóm chuyến')).toContain('Đã xác nhận (dữ liệu cũ)');
  });

  it('★ never claims the read is the moment the button was pressed', () => {
    const text = exportDetails(request({ trips: [trip('a', null)] })).flat().join(' ');

    expect(text).not.toMatch(/bấm/i);
    expect(text).toContain('lần đọc');
  });

  it('states the applied customer search when there is one', () => {
    expect(rows({ customer: 'viễn' }).get('Khách hàng')).toBe('Tên có chứa “viễn”');
  });

  it('★ names the money columns left out by permission, so an absent column is not read as "no figure"', () => {
    const details = rows({ includePrices: false, includeCosts: false });

    expect(details.get('Cột không có do quyền')).toContain('Giá cước bán, Giá cước mua');
    expect(details.get('Cột không có do quyền')).toContain('Chi phí chuyến');
    expect(details.has('Ghi chú về tiền')).toBe(false);
  });

  it('★ says a blank cost is no live line, not a zero — whenever money is in the file', () => {
    expect(rows({}).get('Ghi chú về tiền')).toContain('không có nghĩa là chi phí bằng 0');
    expect(rows({}).has('Cột không có do quyền')).toBe(false);
  });

  it('counts one screen without a breakdown', () => {
    expect(rows({ scope: 'history', trips: [trip('a', null, { status: 'finished' })] }).get('Số chuyến')).toBe('1');
  });
});
