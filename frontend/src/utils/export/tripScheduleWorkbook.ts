import type { Language } from '@/types/translate';
import type { TripBoardRow } from '@/types/tripBoard';
import { SHEET_MONEY_FORMAT } from './sheetMoney';
import { tripSheetCostHeadings } from './tripScheduleCostCells';
import { toTripSheetRows, tripSheetColumnWidths, type Translate } from './tripScheduleSheet';

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

export interface TripScheduleExport {
  trips: readonly TripBoardRow[];
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
  /**
   * Does this viewer hold `cost.read`? Same reasoning, same place: the server
   * has already sent `costSummary: null` to anybody else, and the builder drops
   * the cost block rather than export a column of blanks.
   */
  includeCosts: boolean;
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
  includeCosts,
}: TripScheduleExport): Promise<number> {
  const XLSX = await import('xlsx');

  const visible = { prices: includePrices, costs: includeCosts };
  const rows = toTripSheetRows(trips, t, language, visible);
  const sheet = XLSX.utils.json_to_sheet(rows);

  sheet['!cols'] = tripSheetColumnWidths(visible).map((wch) => ({ wch }));

  // The heading row, as a filter — the first thing anybody does with an export
  // of a hundred trips is narrow it to one truck.
  if (sheet['!ref']) {
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    formatMoneyColumns(XLSX, sheet, moneyHeadings(t, visible));
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
 * The headings whose cells are money — only the ones this sheet actually has,
 * so a heading that drifted shows up as an unformatted column, not a silent skip.
 */
const moneyHeadings = (t: Translate, { prices, costs }: { prices: boolean; costs: boolean }) =>
  new Set<unknown>([
    ...(prices ? [t('colSellPrice'), t('colPurchasePrice')] : []),
    ...(costs ? tripSheetCostHeadings(t) : []),
  ]);

/**
 * Puts the money format on every numeric cell under a money heading — the two
 * prices and the cost block.
 *
 * Found by heading text rather than by a hardcoded column letter: the columns
 * are built from translated headings, so their order is stated in one place
 * (`toTripSheetRows`) and reading it back is how this stays true when a column
 * is added in front of them.
 *
 * Handed only the headings the sheet HAS — a viewer without `trip.price.read`
 * or `cost.read` gets no such column — so a heading found nowhere means the
 * headings drifted, not that the reader was unauthorized.
 */
function formatMoneyColumns(
  XLSX: typeof import('xlsx'),
  sheet: import('xlsx').WorkSheet,
  headings: ReadonlySet<unknown>,
): void {
  if (headings.size === 0) return;
  const bounds = XLSX.utils.decode_range(sheet['!ref'] as string);
  // ★ A SET, AND THE LOOP NEVER STOPS AT THE FIRST MATCH: the money columns
  // are adjacent, and returning after one left the rest as bare digits.

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
      if (cell?.t === 'n') cell.z = SHEET_MONEY_FORMAT;
    }
  }
}
