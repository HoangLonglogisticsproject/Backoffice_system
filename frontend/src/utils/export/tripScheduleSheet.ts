import { TRIP_STATUS_LABELS } from '@/types/trip';
import type { Language, TranslationKey } from '@/types/translate';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay, formatDateTime } from '@/utils/format/datetime';
import type { TripBoardRow } from '@/types/tripBoard';
import { sheetMoney } from './sheetMoney';
import {
  TRIP_SHEET_COST_WIDTHS,
  tripSheetCostCells,
  tripSheetCostHeadings,
} from './tripScheduleCostCells';

/**
 * The dispatch board as rows a spreadsheet can hold.
 *
 * ★ THE SHAPE OF THE SCREEN, NOT THE SHAPE OF THE TABLE. `LỊCH XE - CHI PHÍ
 * XE.xlsx` is what this app replaced, and an export people open next to the
 * board has to be recognisable as the same thing: the same columns, the same
 * order, the same words. A dump of the API payload — ids, timestamps, nulls —
 * would be a different document that happens to share a data source.
 *
 * ★ SEPARATED FROM THE WRITER ON PURPOSE. This module knows nothing about
 * SheetJS or about downloading; it turns trips into plain objects, which is the
 * half worth testing. `buildTripScheduleWorkbook` does the binary half.
 *
 * ★ AND IT TAKES `t` RATHER THAN CALLING A HOOK. Building a file is not
 * rendering, so this must be callable from an event handler and from a test
 * without a React tree around it.
 */

/** What the caller must hand over to translate a column heading or a status. */
export type Translate = (key: TranslationKey) => string;

/**
 * One trip, in the order the columns appear on the board.
 *
 * Keys are the translated HEADINGS rather than field names: SheetJS writes the
 * first row from the keys of the first object, so the heading row and the cell
 * order are the same fact stated once.
 */
export type TripSheetRow = Record<string, string | number | null>;

/**
 * The two ends of a trip, flattened.
 *
 * The board renders address, contact and time stacked in one cell (`Leg`),
 * which reads well and sorts terribly. A spreadsheet's job is the opposite, so
 * each part gets its own column — three that can be filtered instead of one
 * that cannot.
 */
const leg = (
  address: string | null,
  contact: string | null,
  at: string | null,
  language: Language,
): [string, string, string] => [
  address ?? '',
  contact ?? '',
  // A full date and time, not just the hour, for the same reason the board
  // shows one: delivery routinely falls on a day after the trip's own.
  at ? formatDateTime(at, language) : '',
];

/**
 * Which money this viewer may see — the two keys the board's own columns are
 * gated on. ★ EVERY FLAG DEFAULTS TO FALSE, the fail-closed direction: a caller
 * that forgets one exports a sheet without that money, never with it.
 */
export interface SheetVisibility {
  /** `trip.price.read` — "Giá cước bán" and "Giá cước mua". */
  prices?: boolean;
  /** `cost.read` — the cost block. */
  costs?: boolean;
}

/**
 * Turns the trips into sheet rows.
 *
 * `startIndex` is 1-based and exists so the STT column counts the EXPORT, not
 * the page a row happened to arrive on — the export is one list, so its numbers
 * run 1..n whatever the page size was.
 */
export function toTripSheetRows(
  trips: readonly TripBoardRow[],
  t: Translate,
  language: Language,
  { prices = false, costs = false }: SheetVisibility = {},
): TripSheetRow[] {
  const heading = {
    index: t('colIndex'),
    date: t('colDate'),
    vehicle: t('colVehicle'),
    driver: t('colDriver'),
    customer: t('colCustomer'),
    cargo: t('colCargo'),
    pickup: t('colPickup'),
    delivery: t('colDelivery'),
    status: t('colStatus'),
    sellPrice: t('colSellPrice'),
    purchasePrice: t('colPurchasePrice'),
    note: t('colNote'),
    createdBy: t('colCreatedBy'),
    contact: t('exportColContact'),
    at: t('exportColTime'),
  };
  // Built once for the export, not once per row.
  const costHeadings = costs ? tripSheetCostHeadings(t) : [];

  return trips.map((trip, position) => {
    const [pickupAddress, pickupContact, pickupAt] = leg(
      trip.pickupAddress,
      trip.pickupContact,
      trip.pickupAt,
      language,
    );
    const [deliveryAddress, deliveryContact, deliveryAt] = leg(
      trip.deliveryAddress,
      trip.deliveryContact,
      trip.deliveryAt,
      language,
    );

    return {
      [heading.index]: position + 1,
      [heading.date]: formatCalendarDay(trip.scheduledOn, language),
      // ★ ONE ROW PER TRIP, WHATEVER THE CREW (ADR-0004). A trip with three
      // lorries stays one line, its plates and its drivers joined with `;` —
      // a sheet that grew a row per lorry would count trips wrong in every
      // column total somebody adds later. Formatted for reading, exactly as
      // the board formats it; the same driver on two lorries is named once.
      [heading.vehicle]: trip.assignments
        .map((turn) => (turn.vehicle ? formatPlate(turn.vehicle.plate) : ''))
        .filter(Boolean)
        .join('; '),
      [heading.driver]: [...new Set(trip.assignments.map((turn) => turn.driver.displayName))].join('; '),
      [heading.customer]: trip.customer?.name ?? '',
      [heading.cargo]: trip.cargoInfo ?? '',
      [heading.pickup]: pickupAddress,
      [`${heading.pickup} — ${heading.contact}`]: pickupContact,
      [`${heading.pickup} — ${heading.at}`]: pickupAt,
      [heading.delivery]: deliveryAddress,
      [`${heading.delivery} — ${heading.contact}`]: deliveryContact,
      [`${heading.delivery} — ${heading.at}`]: deliveryAt,
      // The label a dispatcher reads, not the enum. An unknown sixth status
      // from the server falls back to its raw value — visibly wrong beats
      // blank, the same rule the badge follows.
      [heading.status]: TRIP_STATUS_LABELS[trip.status]
        ? t(TRIP_STATUS_LABELS[trip.status])
        : trip.status,
      // ★ BOTH COLUMNS ARE OMITTED ENTIRELY FOR A VIEWER WHO MAY NOT SEE
      // PRICES, exactly as the board drops them. The server has already blanked
      // the values, so keeping the headings would export two columns of empty
      // cells that read as "nothing is priced" — a claim about the data rather
      // than about the reader.
      ...(prices
        ? {
            [heading.sellPrice]: sheetMoney(trip.sellPrice),
            [heading.purchasePrice]: sheetMoney(trip.purchasePrice),
          }
        : {}),
      // ★ THE COST BLOCK: omitted, like the prices, for a viewer without
      // `cost.read` — the server sent them no figure. Beside the prices because
      // that is where money is read; after "Giá cước mua" and never summed with
      // it, since an outsourced hire may be the very same carrier payment.
      ...(costs ? tripSheetCostCells(trip.costSummary, costHeadings) : {}),
      [heading.note]: trip.note ?? '',
      [heading.createdBy]: trip.createdByUser.displayName,
    };
  });
}

/**
 * How wide each column opens, in characters.
 *
 * Guessed once here rather than measured from the data: auto-fitting to the
 * longest cell makes the address columns swallow the screen, and the point of
 * the widths is that the sheet is readable the moment it opens.
 *
 * ★ COMPOSED FROM THE SAME SEGMENTS, IN THE SAME ORDER, AS A ROW — the columns
 * everybody gets, the two prices, the cost block, then the note and the author.
 * This replaces a list cut by position to drop the prices, which a second
 * optional block would have turned into four hand-kept variants.
 * `tripScheduleSheet.costs.spec` pins that the widths always match the columns.
 */
const LEADING_WIDTHS = [6, 12, 14, 20, 24, 30, 32, 20, 18, 32, 20, 18, 16];
const PRICE_WIDTHS = [14, 14];
const TRAILING_WIDTHS = [40, 20];

export const tripSheetColumnWidths = ({ prices = false, costs = false }: SheetVisibility = {}): number[] => [
  ...LEADING_WIDTHS,
  ...(prices ? PRICE_WIDTHS : []),
  ...(costs ? TRIP_SHEET_COST_WIDTHS : []),
  ...TRAILING_WIDTHS,
];
