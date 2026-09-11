import type { UserSummary } from './organization';
import type { TranslationKey } from './translate';

/**
 * The dispatch board (contract §21).
 *
 * These mirror the backend response verbatim. Nothing here renames a field,
 * flattens a nested object, or invents a convenience property — a second
 * definition of what a trip is would be a second thing to keep in step with the
 * API, and the first divergence would be silent.
 */

/**
 * ★ WHERE A TRIP IS IN ITS LIFE — four states, IN ORDER.
 *
 * These replace the five workbook row colours the board carried until 0025
 * (ĐANG ĐỢI SX, SX RỒI ĐANG ĐỢI XE, THÔNG TIN CẦN XÁC NHẬN LẠI, BOOK XE NGOÀI,
 * ĐÃ XONG). Four of those described the CARGO and one described the ROUTE;
 * none of them said where the RUN itself was.
 *
 * ⚠ "BOOK XE NGOÀI" IS NOT AMONG THEM, AND THAT FACT DID NOT VANISH WITH IT.
 * Whether a run is subcontracted is carried by the vehicle's `ownership` and by
 * the outsource-hire records — not by the board's colour. Do not re-add it here
 * as a fifth status: it is not a stage of the same journey.
 */
export type TripStatus = 'pending' | 'confirmed' | 'executing' | 'finished';

/**
 * In lifecycle order.
 *
 * ⚠ THE ORDER IS NOT A RULE. The server allows every pairing except leaving
 * `finished`, so a dispatcher can send a trip back when they mis-clicked.
 * Nothing here may narrow that into a wizard.
 */
export const TRIP_STATUSES: readonly TripStatus[] = [
  'pending',
  'confirmed',
  'executing',
  'finished',
];

/**
 * What each status is CALLED, once — the legend, as translation keys.
 *
 * ★ HERE RATHER THAN BESIDE THE COLOURS, because two things now need the name
 * without needing the palette: the badge that renders it and the mutation that
 * says "Chờ xe → Đang giao" in its receipt. `TRIP_STATUS_STYLES` reads this map
 * instead of restating it — the labels drifting into a second copy is a mistake
 * this file has already made once, in the trip form.
 */
export const TRIP_STATUS_LABELS: Record<TripStatus, TranslationKey> = {
  pending: 'tripPending',
  confirmed: 'tripConfirmed',
  executing: 'tripExecuting',
  finished: 'tripFinished',
};

/**
 * The statuses a dispatcher may CHOOSE. Everything above is what a trip may BE.
 *
 * ★ `finished` IS MISSING ON PURPOSE, AND IT IS NOT A UI PREFERENCE. A trip is
 * finished by APPROVING ITS COMPLETION REQUEST — the server refuses `finished`
 * from the board and from trip creation alike, and 0025's trigger makes it
 * permanent once set. Offering it in a dropdown would offer a control whose
 * only possible outcome is a 409.
 *
 * ⚠ AND THE OTHER THREE STAY UNORDERED DESPITE READING AS A SEQUENCE. The
 * server allows any move among them, which is what lets a dispatcher send a
 * trip back from `executing` to `pending` after a mis-click. Turning this
 * list's order into a permitted-transitions rule would invent a workflow the
 * business has not described.
 */
export const DISPATCH_SELECTABLE_STATUSES: readonly TripStatus[] = TRIP_STATUSES.filter(
  (status) => status !== 'finished',
);

/**
 * ★ WHO IS DRIVING, AS A FILTER — `?assignment=` on `GET /trip-schedules`.
 *
 * NOT a fifth status, and the board's tabs depend on the difference. The four
 * statuses describe where the RUN is; this describes the CREW, and the two move
 * independently — a trip can be `confirmed` with a driver already named, and
 * `confirmed` with nobody on it.
 *
 * ★ AND IT IS THE SERVER'S FILTER, NOT THE BROWSER'S. A page is not the result
 * set: dropping the crewed rows from a fetched page would hide trips without
 * saying so and leave `total` describing a different list from the one on
 * screen. Every value here is sent as a query parameter.
 */
export type TripAssignmentFilter = 'all' | 'unassigned' | 'assigned';

/** In the order the tabs show them: the whole board, then the two halves. */
export const TRIP_ASSIGNMENT_FILTERS: readonly TripAssignmentFilter[] = [
  'all',
  'unassigned',
  'assigned',
];

export type CatalogueStatus = 'active' | 'archived';

/** A trip as the WRITE paths return it: ids, no joined names. */
export interface TripSchedule {
  id: string;

  /**
   * ★ `"2026-08-04"`, AND IT MUST STAY A STRING.
   *
   * The column is a `DATE` — a day on a wall calendar, with no timezone.
   * `new Date('2026-08-04')` is midnight UTC, so `.toISOString().slice(0, 10)`
   * gives back `2026-08-03` for anyone west of UTC and the trip moves to the
   * wrong day of the board. Format it for display with the helpers in
   * `utils/format/datetime`, and send back exactly the string that came in.
   */
  scheduledOn: string;

  /**
   * @deprecated LEGACY (ADR-0004). Lorries are dispatched as assignments —
   * see `TripScheduleWithRefs.assignments` — and the server no longer writes
   * this column. Still sent for a trip booked with a lorry before the change
   * and never crewed, so the board can say "re-dispatch this one".
   */
  vehicleId: string | null;
  customerId: string | null;

  cargoInfo: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  pickupContact: string | null;
  deliveryContact: string | null;

  /**
   * ISO instants, unlike `scheduledOn`, and they may fall on a LATER day than
   * it: the sheet writes `08H30` for pickup and `09H00 SÁNG 04 AUG 2026` for
   * the delivery of the same row, because delivery routinely runs overnight.
   */
  pickupAt: string | null;
  deliveryAt: string | null;

  /**
   * Where the two ends ARE. Each pair is both-or-neither, and `null` on every
   * row until Operations enters it — the pickup pair is what a driver's
   * PICKUP_CONFIRMED is measured against on the server.
   */
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;

  /**
   * ★ WHAT THE CUSTOMER IS CHARGED — `GIÁ CƯỚC BÁN` — AS A DECIMAL STRING,
   * e.g. `"4500000.00"`.
   *
   * ⚠ NEVER `Number(sellPrice)`. The column is `NUMERIC(14,2)` and the server
   * sends it as text for the same reason every figure in `tripCost.ts` is
   * text: binary floating point cannot hold a decimal exactly. Render it with
   * `formatMoney`, which never parses.
   *
   * ★ `null` MEANS TWO THINGS AND THIS SCREEN CANNOT TELL THEM APART. Either
   * the trip is genuinely unpriced, or the viewer may not see prices and the
   * server blanked it. That is deliberate on the server's side — a distinct
   * marker would disclose THAT a figure exists to somebody who may not read it
   * — so never render `null` as "not yet priced" to a viewer without
   * `trip.price.read`. Gate the whole column on the permission instead.
   */
  sellPrice: string | null;

  /**
   * ★ WHAT WE PAY THE CARRIER — `GIÁ CƯỚC MUA` — same shape, same two
   * readings of `null`.
   *
   * `null` on most trips as an ordinary fact: a run on one of our own lorries
   * is not bought from anybody.
   *
   * ⚠ NOT THE SAME FACT AS A HIRE IN `tripCost.ts`. That file holds the cost
   * LEDGER — what a run cost us, behind `cost.read`, fetched only when the
   * money dialog opens. This is the figure agreed on the booking form. Nothing
   * reconciles the two and neither is derived from the other.
   */
  purchasePrice: string | null;

  note: string | null;
  status: TripStatus;

  /**
   * Which of the customer's places each snapshot was copied from — provenance,
   * not a live reference. `null` on trips typed before places existed and on
   * any end entered as free text. The snapshot fields above are what every
   * screen renders.
   */
  pickupLocationId: string | null;
  deliveryLocationId: string | null;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A trip as the two READ paths return it.
 *
 * Separate interface, matching the convention `DepartmentMembershipWithUser`
 * already sets: the joined names ride only on GETs, so a type that promised
 * them everywhere would lie about what a POST returns.
 */
export interface TripScheduleWithRefs extends TripSchedule {
  /** `null` exactly when `customerId` is. */
  customer: TripCustomerRef | null;
  /** Who entered the row — the one question the spreadsheet could not answer. */
  createdByUser: UserSummary;
  /**
   * ★ WHO IS ON IT NOW — every ACTIVE assignment, oldest first (ADR-0004).
   * Empty while nobody is. A trip carries any number of lorries, each with its
   * own driver, and the same driver may appear twice on two lorries.
   */
  assignments: TripAssignmentRef[];
  /** The master places behind the two snapshots, by name. */
  pickupLocation: TripLocationRef | null;
  deliveryLocation: TripLocationRef | null;
}

/** One active dispatch assignment as the board shows it: the pair, and when it was made. */
export interface TripAssignmentRef {
  id: string;
  /** `null` only on a pre-multi-vehicle row the migration could not backfill; the board flags it. */
  vehicle: TripVehicleRef | null;
  driver: UserSummary;
  assignedAt: string;
  /**
   * The driver has reported a milestone on this turn. From then on the pair is
   * immutable (ADR-0004): no swap, no removal. The server refuses those anyway;
   * this lets the panel not offer a button whose only outcome is a 409.
   */
  started: boolean;
}

export interface TripLocationRef {
  id: string;
  name: string;
}

/**
 * One of a customer's places. Always read and written under its customer;
 * there is no company-wide list. Coordinates are optional — "not located
 * yet" is a real state the screens say out loud.
 */
export interface TripLocation {
  id: string;
  customerId: string;
  name: string;
  address: string;
  contact: string | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  status: CatalogueStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripVehicleRef {
  id: string;
  plate: string;
}

export interface TripCustomerRef {
  id: string;
  name: string;
}

/**
 * A lorry in the catalogue.
 *
 * ★ WHY THERE IS A CATALOGUE AT ALL. The spreadsheet had the plate typed into
 * the cell every time, and it accumulated `50H44266` beside `50H49266` for one
 * truck, and `51D.65233` beside `51D65233` for another. The form must therefore
 * offer a CHOICE from this list, never a free-text box — the server's
 * normalisation catches punctuation and case but cannot catch a genuinely
 * different spelling of a Vietnamese name.
 */
export interface TripVehicle {
  /** As somebody typed it. Display this, match on nothing. */
  plate: string;
  id: string;
  note: string | null;
  status: CatalogueStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripCustomer {
  name: string;
  id: string;
  note: string | null;
  status: CatalogueStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
