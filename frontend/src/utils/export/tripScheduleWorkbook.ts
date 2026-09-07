import type { Language } from '@/types/translate';
import type { TripScheduleWithRefs } from '@/types/trip';
import {
  TRIP_SHEET_COLUMN_WIDTHS,
  toTripSheetRows,
  TRIP_SHEET_COLUMN_WIDTHS_WITHOUT_PRICES,
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
 */

/** How the price column is drawn: thousands separated, no decimals. VND has none. */
const MONEY_FORMAT = '#,##0';

export interface TripScheduleExport {
  trips: readonly TripScheduleWithRefs[];
  t: Translate;
  language: Language;
  /** The range the rows came from — it names the file and titles the sheet. */
  range: { from: string; to: string };
  /**
   * Does this viewer hold `trip.price.read`?
   *
   * ★ PASSED IN RATHER THAN READ HERE. This module is a pure builder with no
   * session and no hooks; the button that owns the click is where `can()`
   * lives. Passing it also makes the decision visible at the call site, which
   * is where somebody adding a second export would look.
   */
  includePrices: boolean;
}

/** `lich-xe_2026-09-01_2026-09-30.xlsx` — the range is in the name, so two exports never collide. */
export const tripScheduleFileName = (range: { from: string; to: string }): string =>
  `lich-xe_${range.from}_${range.to}.xlsx`;

/**
 * Builds the workbook and hands it to the browser as a download.
 *
 * Returns the number of rows written, so the caller can say so. Throws if
 * SheetJS fails to load — the caller turns that into a toast, like every other
 * failure on this screen.
 */
export async function downloadTripScheduleWorkbook({
  trips,
  t,
  language,
  range,
  includePrices,
}: TripScheduleExport): Promise<number> {
  const XLSX = await import('xlsx');

  const rows = toTripSheetRows(trips, t, language, includePrices);
  const sheet = XLSX.utils.json_to_sheet(rows);

  sheet['!cols'] = (
    includePrices ? TRIP_SHEET_COLUMN_WIDTHS : TRIP_SHEET_COLUMN_WIDTHS_WITHOUT_PRICES
  ).map((wch) => ({ wch }));

  // The heading row, as a filter — the first thing anybody does with an export
  // of a hundred trips is narrow it to one truck.
  if (sheet['!ref']) {
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    // Nothing to format when the columns are not there. Harmless either way —
    // the search below simply finds no heading — but skipping it says why.
    if (includePrices) formatPriceColumns(XLSX, sheet, t);
  }

  const book = XLSX.utils.book_new();
  // Sheet names are capped at 31 characters and may not contain : \ / ? * [ ],
  // which a date range cannot produce — but the range belongs in the file name
  // rather than here, where it would push against that cap.
  XLSX.utils.book_append_sheet(book, sheet, t('tripScheduleTitle').slice(0, 31));

  XLSX.writeFile(book, tripScheduleFileName(range));

  return rows.length;
}

/**
 * Puts the money format on every cell under either price heading.
 *
 * Found by heading text rather than by a hardcoded column letter: the columns
 * are built from translated headings, so their order is stated in one place
 * (`toTripSheetRows`) and reading it back is how this stays true when a column
 * is added in front of them.
 *
 * Called only when the sheet HAS those columns — a viewer without
 * `trip.price.read` gets neither — so a run that finds no heading means the
 * headings drifted, not that the reader was unauthorized.
 */
function formatPriceColumns(
  XLSX: typeof import('xlsx'),
  sheet: import('xlsx').WorkSheet,
  t: Translate,
): void {
  const bounds = XLSX.utils.decode_range(sheet['!ref'] as string);
  // ★ A SET, AND THE LOOP NO LONGER STOPS AT THE FIRST MATCH. There are two
  // money columns now and they are adjacent; returning after one left the
  // buying price as bare digits beside a formatted selling price.
  const headings = new Set<unknown>([t('colSellPrice'), t('colPurchasePrice')]);

  for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
    const headingCell = sheet[XLSX.utils.encode_cell({ r: bounds.s.r, c: column })] as
      | { v?: unknown }
      | undefined;
    if (headingCell === undefined || !headings.has(headingCell.v)) continue;

    for (let row = bounds.s.r + 1; row <= bounds.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
        | { t?: string; z?: string }
        | undefined;
      // Only the numeric ones. An unpriced trip has no cell at all, and giving
      // a blank a currency format would draw a zero that is not there.
      if (cell?.t === 'n') cell.z = MONEY_FORMAT;
    }
  }
}
