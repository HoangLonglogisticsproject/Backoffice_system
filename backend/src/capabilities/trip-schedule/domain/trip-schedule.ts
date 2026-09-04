import type { UserSummary } from '../../../common/types/user-summary';
import type { VehicleOwnership } from './trip-execution';

/**
 * Hoàng Long's dispatch board, as data.
 *
 * PROJECT-OWNED. This capability replaces a shared workbook — one sheet per
 * month, one row per trip — and another deployment deletes it whole.
 */

/**
 * ★ THE ROW COLOUR FROM THE WORKBOOK, AS A VALUE.
 *
 * In the sheet this was the fill colour of the row, with a legend written at
 * the bottom (rows 71–75 of "Tháng 8-2026"). A colour cannot be filtered,
 * counted, or read at all by somebody working from a printout — so it is the
 * one field this model adds to the twelve columns dispatch already kept.
 *
 * The order below is the order of the legend, which is roughly the order work
 * moves through: nothing produced yet → produced, waiting for a truck → done.
 * The other two are exceptions that leave the line.
 */
export const TRIP_STATUSES = [
  /** ĐANG ĐỢI SX — the goods do not exist yet. */
  'awaiting_production',
  /** SX RỒI ĐANG ĐỢI XE — goods ready, no truck assigned. */
  'awaiting_vehicle',
  /** THÔNG TIN CẦN XÁC NHẬN LẠI — somebody has to ring the customer back. */
  'needs_confirmation',
  /** BOOK XE NGOÀI — subcontracted to an outside carrier. */
  'external_booking',
  /** ĐÃ XONG — delivered and closed. */
  'done',
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * ★ WHO IS DRIVING, AS A FILTER ON THE BOARD — not a status, and never a sixth one.
 *
 * A trip with no driver is not at a different STAGE of work; it is at the same
 * stage with a question still open against it. The five statuses describe the
 * cargo ("đang đợi SX", "đợi xe"); this describes the crew, and the two move
 * independently — a trip can be `awaiting_vehicle` with a driver already named,
 * and `needs_confirmation` with nobody on it.
 *
 * DERIVED, NEVER STORED. A trip is unassigned exactly when it has no `active`
 * row in `trip_driver_assignments`, and 0014 already makes that the single
 * answer to "who is driving". A column repeating it here would be a second
 * answer, wrong from the first moment the two disagree.
 */
export const TRIP_ASSIGNMENT_FILTERS = [
  /** Everything in the range, crewed or not — the board as it has always read. */
  'all',
  /** Waiting on a dispatcher: no active assignment. */
  'unassigned',
  /** Somebody is on it. */
  'assigned',
] as const;

export type TripAssignmentFilter = (typeof TRIP_ASSIGNMENT_FILTERS)[number];

/**
 * One row of the dispatch board.
 *
 * The eight free-text fields are free text ON PURPOSE. They are the parts of
 * the sheet that are genuinely prose — multi-line addresses, a driver's name
 * with their licence and lorry numbers underneath, carton counts written three
 * different ways. The two columns that were worth normalising, the plate and
 * the customer, became `vehicleId` and `customerId`; modelling the rest would
 * be modelling a guess.
 */
export interface TripSchedule {
  id: string;

  /**
   * The day on the board, as `YYYY-MM-DD`.
   *
   * ★ A STRING, NOT A `Date`. The column is `DATE` — a day on a wall calendar
   * with no timezone — and putting it through a `Date` gives it midnight UTC,
   * which is the previous day in Hồ Chí Minh. That would move a trip to the
   * wrong day of the board on the way out of the API, every time, for every
   * row. Kept as the text PostgreSQL rendered so nothing can shift it.
   */
  scheduledOn: string;

  /** `null` while the sheet would have said `ĐIỀN SAU` — no truck assigned yet. */
  vehicleId: string | null;
  /** `null` for an internal move with no customer behind it. */
  customerId: string | null;

  cargoInfo: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  pickupContact: string | null;
  deliveryContact: string | null;

  /**
   * Full instants, not times of day: the sheet writes `08H30` for pickup and
   * `09H00 SÁNG 04 AUG 2026` for the delivery of the same row, because delivery
   * routinely lands on a later day.
   */
  pickupAt: Date | null;
  deliveryAt: Date | null;

  /**
   * Where the two ends ARE, as opposed to how they are described.
   *
   * ★ NULL ON EVERY TRIP UNTIL OPERATIONS ENTERS THEM — GAP-14 was always a
   * data-collection job, not a code one. Each pair moves together (0019 says
   * so with a CHECK): a latitude without a longitude is nowhere. The pickup
   * pair is what the driver's PICKUP_CONFIRMED is measured against; a trip
   * without it cannot confirm a pickup, and the driver is told whose problem
   * that is.
   */
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;

  note: string | null;
  status: TripStatus;

  /**
   * Which master place each snapshot was copied from — provenance, not a
   * live reference. `null` on every trip typed before 0022 and on any end
   * entered as free text. Nothing reads the master row through these; the
   * snapshot columns above are what the board, the driver and the geofence
   * use.
   */
  pickupLocationId: string | null;
  deliveryLocationId: string | null;

  /** The one thing the workbook could never answer. */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A trip as a LIST READ returns it: the row, plus the three things it points at
 * spelled out.
 *
 * Separate from the entity so the write paths carry no join they do not need —
 * the same split as `AccountInvitation` / `AccountInvitationWithUser`, and for
 * the same reason: whoever just posted a trip already knows which vehicle they
 * chose, so the server does not go and read the plate back to them.
 */
export interface TripScheduleWithRefs extends TripSchedule {
  /** `null` exactly when `vehicleId` is. */
  vehicle: TripVehicleRef | null;
  /** `null` exactly when `customerId` is. */
  customer: TripCustomerRef | null;
  /** Who wrote the row. Present always — `createdBy` is NOT NULL. */
  createdByUser: UserSummary;
  /**
   * Who is driving it NOW — the active assignment, spelled out. `null` while
   * nobody is. The history behind it is its own read; this is the one fact
   * the board needs on every row.
   */
  driver: UserSummary | null;
  /** The master places the two snapshots came from, by name. `null` exactly when the id is. */
  pickupLocation: TripLocationRef | null;
  deliveryLocation: TripLocationRef | null;
}

/** The smallest useful projection of a place: enough to print, nothing more. */
export interface TripLocationRef {
  id: string;
  name: string;
}

/** The smallest useful projection of a vehicle: enough to print, nothing more. */
export interface TripVehicleRef {
  id: string;
  plate: string;
}

/** The same, for a customer. */
export interface TripCustomerRef {
  id: string;
  name: string;
}

export const CATALOGUE_STATUSES = ['active', 'archived'] as const;
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

/**
 * A lorry, as a row rather than as a string typed into a cell each time.
 *
 * ★ WHY THIS TABLE EXISTS. The workbook contains `50H44266` and `50H49266` —
 * two spellings of one truck — and `51D.65233` beside `51D65233`. Nothing can
 * be counted per vehicle while that is true, and no amount of care at data
 * entry fixes it, because the sheet offers no way to be careful. A foreign key
 * makes the misspelling unrepresentable instead of merely discouraged.
 */
export interface TripVehicle {
  id: string;
  /** As somebody typed it. Formatting is theirs; only matching is ours. */
  plate: string;
  note: string | null;
  status: CatalogueStatus;

  /**
   * Whose lorry it is.
   *
   * ★ `null` MEANS NOT YET CLASSIFIED, AND IT IS NOT A THIRD KIND OF LORRY.
   * 0013 added this column without a default on purpose: writing `company` onto
   * every existing row would have been the system inventing a fleet nobody
   * asserted. Until somebody classifies a lorry the honest answer is absence,
   * and no reader may substitute one.
   */
  ownership: VehicleOwnership | null;
  /** The carrier a hired lorry belongs to. Set exactly when `ownership` is `outsourced`. */
  carrierId: string | null;

  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A customer's place — a warehouse, a yard, a factory gate.
 *
 * ★ OWNED BY ONE CUSTOMER, AND THAT IS THE MODEL. A location is listed, chosen
 * and edited only under its customer; there is no company-wide pool of
 * places, and a trip for one customer cannot name another's. Coordinates are
 * OPTIONAL: a place is real before anybody has located it, and a trip may use
 * it — the driver's confirmation there is then refused as DESTINATION_MISSING
 * exactly as for a trip typed by hand.
 */
export interface TripLocation {
  id: string;
  customerId: string;
  name: string;
  address: string;
  contact: string | null;
  note: string | null;
  /** Both or neither. `null` means "not located yet", never "at 0,0". */
  latitude: number | null;
  longitude: number | null;
  status: CatalogueStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A customer, for the same reason: `VIỄN ĐẠT` and `VIẼN ĐẠT` are one company. */
export interface TripCustomer {
  id: string;
  name: string;
  note: string | null;
  status: CatalogueStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
