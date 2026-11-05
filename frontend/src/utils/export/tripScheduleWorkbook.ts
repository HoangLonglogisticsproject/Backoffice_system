import { displayCalendarDate } from '@/components/ui/dateTimeText';
import type { TranslationKey } from '@/types/translate';
import { TRIP_EXPORT_SCOPE_LABELS, type TripExportScope } from '@/types/trip';
import type { TripBoardRow } from '@/types/tripBoard';
import { formatBusinessStamp } from '@/utils/format/datetime';
import { SHEET_DAY_FORMAT, SHEET_TIME_FORMAT } from './sheetDate';
import { SHEET_MONEY_FORMAT } from './sheetMoney';
import { tripSheetCostHeadings } from './tripScheduleCostCells';
import {
  toTripSheetRows,
  tripSheetColumnWidths,
  tripSheetDayHeadings,
  tripSheetTimeHeadings,
  type Translate,
} from './tripScheduleSheet';

/**
 * Writing the board out as a real `.xlsx`.
 *
 * ★ SHEETJS IS LOADED ON DEMAND, and that is not a micro-optimisation. The
 * library is the largest thing this frontend could depend on, and the export is
 * a button most sessions never press — bundling it into the initial download
 * would make every page load pay for a feature used once a month. The dynamic
 * import puts it in its own chunk, fetched when somebody actually exports.
 *
 * ★ AND IT IS THE PUBLISHER'S BUILD, NOT THE NPM ONE. `xlsx` on the npm
 * registry stopped at 0.18.5 and carries advisories in its PARSE path; this is
 * installed from `cdn.sheetjs.com`, which is where SheetJS ships now. Nothing
 * here reads a file the user supplies — the export only ever writes — but
 * depending on a version that is known-vulnerable and unmaintained would be a
 * decision nobody made on purpose.
 *
 * ★ BUILT FROM ONE SNAPSHOT AND NOTHING ELSE. Every row comes from one
 * `/trip-schedules/export-snapshot` answer; nothing here reads the server, so
 * the file describes exactly the state that answer was read at (`readAt`).
 */

export interface TripScheduleExport {
  trips: readonly TripBoardRow[];
  t: Translate;
  /** The range the rows came from — it names the file and is stated in it. */
  range: { from: string; to: string };
  /** The APPLIED customer search the rows were narrowed by; `''` for every customer. */
  customer: string;
  /** When the server began the snapshot read (ISO 8601) — stated in the file, never "when the button was pressed". */
  readAt: string;
  /**
   * Does this viewer hold `trip.price.read`?
   *
   * ★ PASSED IN RATHER THAN READ HERE. This module is a pure builder with no
   * session and no hooks; the button that owns the click is where `can()`
   * lives. Passing it also makes the decision visible at the call site, which
   * is where somebody adding a second export would look.
   */
  includePrices: boolean;
  /**
   * Does this viewer hold `cost.export`? Same reasoning, same place: the server
   * has already sent `costSummary: null` to anybody else, and the builder drops
   * the cost block rather than export a column of blanks.
   */
  includeCosts: boolean;
  /** Which screen the rows are of — or both. It names the file and the sheet, and shapes the edges. */
  scope: TripExportScope;
  /** When the file is written — the caller's clock. A parameter so a test can fix it. */
  now?: Date;
}

/** What each scope's file is called, and what its data sheet is titled. */
const EXPORT_NAMES: Record<TripExportScope, { file: string; sheet: TranslationKey }> = {
  operational: { file: 'lich-xe', sheet: 'tripScheduleTitle' },
  history: { file: 'lich-su-chuyen', sheet: 'tripHistoryTitle' },
  all: { file: 'tong-hop-chuyen', sheet: 'exportCombinedSheet' },
};

/** `lich-xe_2026-09-01_2026-09-30.xlsx` — the range is in the name, so two exports never collide. */
export const tripScheduleFileName = (
  range: { from: string; to: string },
  scope: TripExportScope = 'operational',
): string => `${EXPORT_NAMES[scope].file}_${range.from}_${range.to}.xlsx`;

/**
 * Builds the workbook and hands it to the browser as a download.
 *
 * Returns the number of rows written, so the caller can say so. Throws if
 * SheetJS fails to load or to write — the caller turns that into a toast, and
 * says nothing about success, like every other failure on this screen.
 */
export async function downloadTripScheduleWorkbook(request: TripScheduleExport): Promise<number> {
  const { trips, t, range, includePrices, includeCosts, scope } = request;
  const XLSX = await import('xlsx');

  const visible = { prices: includePrices, costs: includeCosts };
  const rows = toTripSheetRows(trips, t, visible, scope);
  const sheet = XLSX.utils.json_to_sheet(rows);

  sheet['!cols'] = tripSheetColumnWidths(visible, scope).map((wch) => ({ wch }));

  // The heading row, as a filter — the first thing anybody does with an export
  // of a hundred trips is narrow it to one truck.
  if (sheet['!ref']) {
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    formatColumns(XLSX, sheet, cellFormats(t, visible));
  }

  const details = XLSX.utils.aoa_to_sheet(exportDetails(request));
  details['!cols'] = [{ wch: 44 }, { wch: 100 }];

  const book = XLSX.utils.book_new();
  // Sheet names are capped at 31 characters and may not contain : \ / ? * [ ],
  // which a date range cannot produce — but the range belongs in the file name
  // rather than here, where it would push against that cap.
  XLSX.utils.book_append_sheet(book, sheet, t(EXPORT_NAMES[scope].sheet).slice(0, 31));
  XLSX.utils.book_append_sheet(book, details, t('exportInfoSheet').slice(0, 31));

  XLSX.writeFile(book, tripScheduleFileName(range, scope));

  return rows.length;
}

/**
 * "Thông tin xuất" — what the data sheet holds and when it was read, as label
 * and value rows. Everything a reader needs to know the file's limits without
 * having seen the screen it came from.
 */
export function exportDetails({
  trips,
  t,
  range,
  customer,
  readAt,
  includePrices,
  includeCosts,
  scope,
  now = new Date(),
}: TripScheduleExport): string[][] {
  const hidden = [
    ...(includePrices ? [] : [t('exportInfoHiddenPrices')]),
    ...(includeCosts ? [] : [t('exportInfoHiddenCosts')]),
  ];
  const finished = trips.filter((trip) => trip.status === 'finished').length;
  const count =
    scope === 'all'
      ? `${trips.length} (${t('tripScheduleTitle')}: ${trips.length - finished} · ${t('tripHistoryTitle')}: ${finished})`
      : String(trips.length);

  return [
    [t('exportInfoScope'), t(TRIP_EXPORT_SCOPE_LABELS[scope])],
    [
      t('exportInfoPeriod'),
      `${displayCalendarDate(range.from)} – ${displayCalendarDate(range.to)} (${t('exportInfoPeriodBounds')})`,
    ],
    [t('colCustomer'), customer ? `${t('exportCustomerContains')} “${customer}”` : t('exportAllCustomers')],
    [t('exportInfoExcluded'), t('exportInfoExcludedArchived')],
    [t('exportInfoReadAt'), `${formatBusinessStamp(readAt)} (${t('exportInfoVietnamTime')})`],
    ['', t('exportInfoReadNote')],
    [t('exportInfoCreatedAt'), `${formatBusinessStamp(now.toISOString())} (${t('exportInfoClientClock')})`],
    [t('exportInfoTripCount'), count],
    ...(scope === 'all' ? [[t('exportColGroup'), t('exportInfoGroupNote')]] : []),
    ...(hidden.length > 0 ? [[t('exportInfoHidden'), hidden.join('; ')]] : []),
    ...(includePrices || includeCosts ? [[t('exportInfoMoney'), t('exportInfoMoneyNote')]] : []),
  ];
}

/**
 * Which display format each heading's cells take — only the headings this sheet
 * actually has, so a heading that drifted shows up as an unformatted column,
 * not a silent skip.
 */
const cellFormats = (t: Translate, { prices, costs }: { prices: boolean; costs: boolean }) =>
  new Map<unknown, string>([
    ...tripSheetDayHeadings(t).map((heading) => [heading, SHEET_DAY_FORMAT] as const),
    ...tripSheetTimeHeadings(t).map((heading) => [heading, SHEET_TIME_FORMAT] as const),
    ...[...(prices ? [t('colSellPrice'), t('colPurchasePrice')] : []), ...(costs ? tripSheetCostHeadings(t) : [])].map(
      (heading) => [heading, SHEET_MONEY_FORMAT] as const,
    ),
  ]);

/**
 * Puts each column's display format on every numeric cell under its heading —
 * the days, the two instants, the prices and the cost block.
 *
 * Found by heading text rather than by a hardcoded column letter: the columns
 * are built from translated headings, so their order is stated in one place
 * (`toTripSheetRows`) and reading it back is how this stays true when a column
 * is added in front of them.
 */
function formatColumns(
  XLSX: typeof import('xlsx'),
  sheet: import('xlsx').WorkSheet,
  formats: ReadonlyMap<unknown, string>,
): void {
  const bounds = XLSX.utils.decode_range(sheet['!ref'] as string);
  // ★ EVERY COLUMN IS VISITED, NEVER STOPPING AT THE FIRST MATCH: the money
  // columns are adjacent, and returning after one left the rest as bare digits.

  for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
    const headingCell = sheet[XLSX.utils.encode_cell({ r: bounds.s.r, c: column })] as
      | { v?: unknown }
      | undefined;
    const format = headingCell === undefined ? undefined : formats.get(headingCell.v);
    if (format === undefined) continue;

    for (let row = bounds.s.r + 1; row <= bounds.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
        | { t?: string; z?: string }
        | undefined;
      // Only the numeric ones. A missing figure or day has no cell at all, and
      // giving a blank a format would draw a value that is not there.
      if (cell?.t === 'n') cell.z = format;
    }
  }
}
