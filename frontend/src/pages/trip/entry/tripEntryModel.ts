import type { UpdateTripInput } from '@/api/tripSchedule';
import type { TripScheduleWithRefs, TripStatus } from '@/types/trip';
import { timesOf, timesPayload, type FormTimes } from '../components/tripFormTimes';

/**
 * The trip form's model: the values it holds, as inputs give them, and the
 * body they become. Pure — no React, no request.
 */

/**
 * Every field, as the form holds it: strings, because that is what inputs give.
 * The three temporal ones — date, hour, delivery — are `FormTimes`.
 */
export interface FormState extends FormTimes {
  customerId: string | null;
  cargoInfo: string;
  pickupAddress: string;
  deliveryAddress: string;
  pickupContact: string;
  deliveryContact: string;
  /** The customer's place for each end, or `null` for a hand-typed address. */
  pickupLocationId: string | null;
  deliveryLocationId: string | null;
  /**
   * The two agreed charges, as the PLAIN decimal strings the API takes —
   * `MoneyInput` keeps the commas between itself and the DOM, so nothing here
   * strips them.
   *
   * ⚠ BOTH STAY `''` FOR A VIEWER WHO MAY NOT SEE PRICES, and the submit path
   * drops the keys entirely rather than sending `null`. The server answers 403
   * to a body carrying either key from such a caller — deliberately, so that a
   * figure is never silently discarded — so sending "nothing to say here" as an
   * explicit clear would fail every save they attempt.
   */
  sellPrice: string;
  purchasePrice: string;
  note: string;
  status: TripStatus;
}

export const emptyForm = (): FormState => ({
  ...timesOf(null),
  customerId: null,
  cargoInfo: '',
  pickupAddress: '',
  deliveryAddress: '',
  pickupContact: '',
  deliveryContact: '',
  pickupLocationId: null,
  deliveryLocationId: null,
  sellPrice: '',
  purchasePrice: '',
  note: '',
  status: 'pending',
});

/** What a `CatalogueSelect` offers. Mirrors its own prop type. */
export interface Option {
  id: string;
  label: string;
}

/**
 * ★ THE ROW'S OWN REFERENCE IS NOT AN OPTION — IT IS THE CURRENT VALUE.
 *
 * The catalogue endpoints return ACTIVE rows only, which is right: a retired
 * truck must not be offered for tomorrow's work. But a trip entered before that
 * truck was retired still names it, and a `<select>` whose value matches none of
 * its options renders BLANK — so the plate vanished from the form, and touching
 * the control at all silently replaced a historical assignment with something
 * else.
 *
 * So the row's own current reference is appended when the catalogue no longer
 * carries it, marked as retired. It is reachable only from the trip that
 * already holds it: a new trip passes `current = null`, and another trip passes
 * its own. No archived row is ever offered as an ordinary choice.
 */
export const withCurrentReference = (
  options: Option[],
  current: Option | null,
  loaded: boolean,
  archivedLabel: string,
): Option[] => {
  if (!current || options.some((option) => option.id === current.id)) return options;
  // Still loading: keep the value selectable so nothing is lost, but do not
  // call it retired until the catalogue has actually said so.
  const label = loaded ? `${current.label} (${archivedLabel})` : current.label;
  return [...options, { id: current.id, label }];
};

export const formFor = (trip: TripScheduleWithRefs): FormState => ({
  ...timesOf(trip),
  customerId: trip.customerId,
  cargoInfo: trip.cargoInfo ?? '',
  pickupAddress: trip.pickupAddress ?? '',
  deliveryAddress: trip.deliveryAddress ?? '',
  pickupContact: trip.pickupContact ?? '',
  deliveryContact: trip.deliveryContact ?? '',
  pickupLocationId: trip.pickupLocationId,
  deliveryLocationId: trip.deliveryLocationId,
  // ★ THE SERVER'S `"4500000.00"` GOES IN AS IT CAME. Trimming the decimals
  // here would make opening a trip and saving it unchanged rewrite the figure,
  // and no reading of that is reassuring when the subject is money.
  //
  // ⚠ A VIEWER WITHOUT `trip.price.read` IS SENT `null` FOR BOTH, whatever the
  // trip actually holds, so these land as `''` — indistinguishable from an
  // unpriced trip, which is what the server intends. They never reach a field:
  // the form does not render one for them.
  sellPrice: trip.sellPrice ?? '',
  purchasePrice: trip.purchasePrice ?? '',
  note: trip.note ?? '',
  status: trip.status,
});

export type End = 'pickup' | 'delivery';

export type EndFlags = Record<End, boolean>;

export const NO_REFRESH: EndFlags = { pickup: false, delivery: false };

/** The form as it opens: the row's values, or an empty sheet for a new trip. */
export const initialForm = (trip: TripScheduleWithRefs | null): FormState =>
  trip ? formFor(trip) : emptyForm();

/**
 * ★ A NEW CUSTOMER MEANS NO PLACE, YET. The places on the form were the old
 * customer's; both are cleared in the same state change as the customer, so
 * no render — and no submit — can pair customer B with customer A's place.
 * The server refuses that pairing anyway; this keeps the form honest.
 */
export const withCustomer = (current: FormState, id: string | null): FormState =>
  current.customerId === id
    ? current
    : { ...current, customerId: id, pickupLocationId: null, deliveryLocationId: null };

/** `''` → `null`: on the PATCH path this is what makes clearing a field possible. */
export const blank = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** The row's own customer as an option, for `withCurrentReference`. `null` when it has none. */
export const currentCustomerOption = (trip: TripScheduleWithRefs | null): Option | null =>
  trip?.customer ? { id: trip.customer.id, label: trip.customer.name } : null;

/**
 * One end of the payload.
 *
 * ★ NO COORDINATE LEAVES THIS FORM. Each end names the customer's place, and
 * the server copies that place's address, contact and coordinates onto the
 * trip. The typed address and contact travel only for an end with no place —
 * the hand-typed path every trip took before places existed.
 *
 * ★ AN END WHOSE PLACE IS UNCHANGED IS NOT IN THE PATCH. The server copies a
 * place afresh only when the patch names it, and refuses to copy an archived
 * one — so an edit that leaves the place alone must not name it. Otherwise
 * correcting a note on a trip whose warehouse has since closed would be
 * refused, and on any other trip would quietly rewrite last week's snapshot
 * from today's master. Omitted, the trip's own copy stands.
 *
 * ★ UNLESS THE OFFICE REFRESHED THE PLACE FROM THIS FORM. Then naming it again
 * is exactly the request: the server copies it afresh, and the snapshot the
 * driver meets becomes the one the readiness pill already shows.
 */
export const endFields = (
  form: FormState,
  trip: TripScheduleWithRefs | null,
  end: End,
  refreshed: boolean,
): UpdateTripInput => {
  const [id, was, address, contact] =
    end === 'pickup'
      ? [form.pickupLocationId, trip?.pickupLocationId, form.pickupAddress, form.pickupContact]
      : [form.deliveryLocationId, trip?.deliveryLocationId, form.deliveryAddress, form.deliveryContact];
  if (id !== null && id === was && !refreshed) return {};
  return end === 'pickup'
    ? { pickupLocationId: id, pickupAddress: id ? null : blank(address), pickupContact: id ? null : blank(contact) }
    : { deliveryLocationId: id, deliveryAddress: id ? null : blank(address), deliveryContact: id ? null : blank(contact) };
};

/**
 * Everything the form sends. Every field it owns is always present, with
 * `''` as `null` — except the temporal ones, sent on a correction only when
 * touched (`timesPayload`), and the two prices, which are dropped entirely for a
 * viewer without the permission: the server REFUSES a body carrying either
 * from such a caller rather than ignoring it, so `'' → null` would turn every
 * save they make into a 403. For a viewer who holds it, `''` clears the
 * figure, because a price typed by mistake has to be removable.
 *
 * ★ AND NO STATUS. The form is not where a trip moves: a booking opens at the
 * server's `pending`, and Lịch xe moves it with named actions on their own
 * route. An absent key leaves the stored status exactly as it is.
 */
export const tripPayload = (
  form: FormState,
  trip: TripScheduleWithRefs | null,
  mayPrice: boolean,
  refreshed: EndFlags,
): UpdateTripInput => ({
  customerId: form.customerId,
  cargoInfo: blank(form.cargoInfo),
  ...endFields(form, trip, 'pickup', refreshed.pickup),
  ...endFields(form, trip, 'delivery', refreshed.delivery),
  ...timesPayload(form, trip),
  ...(mayPrice ? { sellPrice: blank(form.sellPrice), purchasePrice: blank(form.purchasePrice) } : {}),
  note: blank(form.note),
});
