import { TRIP_STATUS_LABELS, type TripScheduleWithRefs } from '@/types/trip';
import type { Language, TranslationKey } from '@/types/translate';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay, formatDateTime } from '@/utils/format/datetime';

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
 * The price, as a NUMBER — the one place this app parses it, and deliberately.
 *
 * Everywhere else the agreed charge stays a string end to end, because
 * `NUMERIC(14,2)` through float64 is how a figure changes without anything on
 * the wire showing it did. A spreadsheet is the exception that earns it: a
 * column of text is a column nobody can sum, and summing this column is most of
 * why anybody exports the board at all.
 *
 * Safe for what this business actually charges — VND amounts are whole numbers,
 * and every integer below 2^53 survives the round trip exactly. An unpriced
 * trip is `null`, never `0`: an empty cell and a zero are different claims, and
 * `0` would drag any average taken over the column.
 */
const price = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Turns the trips into sheet rows.
 *
 * `startIndex` is 1-based and exists so the STT column counts the EXPORT, not
 * the page a row happened to arrive on — the export is one list, so its numbers
 * run 1..n whatever the page size was.
 */
export function toTripSheetRows(
  trips: readonly TripScheduleWithRefs[],
  t: Translate,
  language: Language,
  /**
   * Does this viewer hold `trip.price.read`?
   *
   * ★ DEFAULTS TO FALSE, WHICH IS THE FAIL-CLOSED DIRECTION. A caller that
   * forgets the argument exports a sheet with no money in it; the opposite
   * default would put both figures in a file somebody then emails on.
   */
  includePrices = false,
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
      // Formatted for reading, exactly as the board formats it — the catalogue
      // stores the plate as somebody typed it.
      [heading.vehicle]: trip.vehicle ? formatPlate(trip.vehicle.plate) : '',
      [heading.driver]: trip.driver?.displayName ?? '',
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
      ...(includePrices
        ? {
            [heading.sellPrice]: price(trip.sellPrice),
            [heading.purchasePrice]: price(trip.purchasePrice),
          }
        : {}),
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
 */
export const TRIP_SHEET_COLUMN_WIDTHS = [
  6, 12, 14, 20, 24, 30, 32, 20, 18, 32, 20, 18, 16, 14, 14, 40, 20,
];

/**
 * The same widths with the two price columns taken out.
 *
 * ★ DERIVED BY POSITION, WHICH IS FRAGILE AND SAYS SO. The widths are a
 * positional list against the key order in `toTripSheetRows`, so a column added
 * before the prices moves this slice. Deriving it beats keeping a second
 * hand-written array that goes stale silently — but if this list grows a third
 * variant, the widths should become a map keyed by heading instead.
 */
export const TRIP_SHEET_COLUMN_WIDTHS_WITHOUT_PRICES = [
  ...TRIP_SHEET_COLUMN_WIDTHS.slice(0, 13),
  ...TRIP_SHEET_COLUMN_WIDTHS.slice(15),
];
