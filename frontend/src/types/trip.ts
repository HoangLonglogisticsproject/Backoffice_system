import type { UserSummary } from './organization';

/**
 * The dispatch board (contract §21).
 *
 * These mirror the backend response verbatim. Nothing here renames a field,
 * flattens a nested object, or invents a convenience property — a second
 * definition of what a trip is would be a second thing to keep in step with the
 * API, and the first divergence would be silent.
 */

/**
 * ★ FIVE VALUES, AND THEY USED TO BE ROW COLOURS.
 *
 * In the spreadsheet this replaces, the state of a trip was the fill colour of
 * its row, with a legend written at the bottom of each monthly sheet. The
 * labels below are the legend, translated in `translate.ts` rather than here.
 */
export type TripStatus =
  | 'awaiting_production'
  | 'awaiting_vehicle'
  | 'needs_confirmation'
  | 'external_booking'
  | 'done';

/** In the order the legend lists them, which is roughly the order work moves. */
export const TRIP_STATUSES: readonly TripStatus[] = [
  'awaiting_production',
  'awaiting_vehicle',
  'needs_confirmation',
  'external_booking',
  'done',
];

/**
 * The statuses a dispatcher may CHOOSE. Everything above is what a trip may BE.
 *
 * ★ `done` IS MISSING ON PURPOSE, AND IT IS NOT A UI PREFERENCE. A trip is
 * finished by APPROVING ITS COMPLETION REQUEST — the server refuses `done` from
 * the board and from trip creation alike, and a database trigger makes it
 * permanent once set. Offering it in a dropdown would offer a control whose
 * only possible outcome is a 409.
 *
 * ⚠ The other four stay UNORDERED. `external_booking` is a ROUTE rather than a
 * stage and `needs_confirmation` is an exception reachable from anywhere, so
 * constraining moves between them would invent a workflow the business has not
 * described — and the first thing it would break is a dispatcher correcting a
 * mis-click.
 */
export const DISPATCH_SELECTABLE_STATUSES: readonly TripStatus[] = TRIP_STATUSES.filter(
  (status) => status !== 'done',
);

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

  /** `null` until a truck is assigned — a real state, written `ĐIỀN SAU` in the sheet. */
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
  /** `null` exactly when `vehicleId` is. */
  vehicle: TripVehicleRef | null;
  /** `null` exactly when `customerId` is. */
  customer: TripCustomerRef | null;
  /** Who entered the row — the one question the spreadsheet could not answer. */
  createdByUser: UserSummary;
  /** Who is driving it NOW — the active assignment. `null` while nobody is. */
  driver: UserSummary | null;
  /** The master places behind the two snapshots, by name. */
  pickupLocation: TripLocationRef | null;
  deliveryLocation: TripLocationRef | null;
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
