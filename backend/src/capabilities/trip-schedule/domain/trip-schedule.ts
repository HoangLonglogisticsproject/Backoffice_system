import type { UserSummary } from '../../../common/types/user-summary';
import type { VehicleOwnership } from './trip-execution';

/**
 * Hoàng Long's dispatch board, as data.
 *
 * PROJECT-OWNED. This capability replaces a shared workbook — one sheet per
 * month, one row per trip — and another deployment deletes it whole.
 */

/**
 * ★ WHERE A TRIP IS IN ITS LIFE — four states, IN ORDER.
 *
 * This replaces the five workbook colours 0011 recorded (ĐANG ĐỢI SX, SX RỒI
 * ĐANG ĐỢI XE, THÔNG TIN CẦN XÁC NHẬN LẠI, BOOK XE NGOÀI, ĐÃ XONG). Four of
 * those described the CARGO's readiness and one described the ROUTE; none said
 * where the RUN was. 0025 remaps every stored row.
 *
 * ⚠ THE ORDER IS THE LIFECYCLE, BUT IT IS NOT ENFORCED AS ONE. Only the last
 * step is a rule — see `canTransition` — because nobody has specified whether
 * a trip may go back from `executing` to `pending`, and refusing it here would
 * invent a rule the first mis-click cannot get around.
 */
export const TRIP_STATUSES = [
  /** CHỜ XỬ LÝ — booked; nothing about the run is settled yet. */
  'pending',
  /** ĐÃ XÁC NHẬN — the run is arranged: a lorry of ours, or a carrier booked. */
  'confirmed',
  /** ĐANG THỰC HIỆN — on the road. */
  'executing',
  /** HOÀN THÀNH — delivered and closed. Terminal; see `canTransition`. */
  'finished',
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * ★ THE FIVE WORDS THE BOARD USED BEFORE 0025, WHICH STILL EXIST IN ONE PLACE.
 *
 * `trip_status_history` is insert-only, undeletable evidence of moves people
 * made when these were the choices, and 0025 deliberately does NOT rewrite it —
 * the three waiting values all collapse to `pending`, so a real move would
 * become `pending` → `pending`, which 0017's CHECK refuses and whose row
 * cannot be deleted either.
 *
 * ⚠ SO ANY READER OF THE HISTORY MUST EXPECT THESE. Nothing may be written with
 * one — `trip_schedules.status` is CHECKed against `TRIP_STATUSES` alone.
 */
export const LEGACY_TRIP_STATUSES = [
  'awaiting_production',
  'awaiting_vehicle',
  'needs_confirmation',
  'external_booking',
  'done',
] as const;

export type LegacyTripStatus = (typeof LEGACY_TRIP_STATUSES)[number];

/**
 * ★ WHO IS DRIVING, AS A FILTER ON THE BOARD — not a status, and never a sixth one.
 *
 * A trip with no driver is not at a different STAGE of work; it is at the same
 * stage with a question still open against it. The four statuses describe where
 * the RUN is; this describes the crew, and the two move independently — a trip
 * can be `confirmed` with a driver already named, and `confirmed` with nobody
 * on it.
 *
 * DERIVED, NEVER STORED. A trip is unassigned exactly when it has no `active`
 * row in `trip_driver_assignments`, and assigned when it has at least one —
 * a trip with three lorries is as "assigned" as a trip with one. A column
 * repeating it here would be a second answer, wrong from the first moment the
 * two disagree.
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

  /**
   * @deprecated LEGACY (ADR-0004). The lorry is dispatched through
   * `trip_driver_assignments.vehicle_id`; nothing writes this column any more
   * and nothing reads it as dispatch truth. Still returned so a trip booked
   * with a lorry before 0027 and never crewed can be recognised and re-crewed.
   */
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

  /**
   * What the customer is charged for this run — `GIÁ CƯỚC BÁN` — as a decimal
   * string, e.g. `"4500000.00"`.
   *
   * ★ A `string`, NEVER A `number`. The column is `NUMERIC(14,2)` and `pg`
   * hands that type back as text precisely so nothing rounds it on the way
   * out. Parsing it into a float here would undo the reason the column has
   * that type. Nothing in this process adds two of these; totals are SQL's.
   *
   * ★ AND IT IS NOT A `trip_costs` ROW. That ledger records what a run COSTS
   * US — many lines, voided rather than edited, readable only under
   * `cost.read`. This is what we CHARGE, agreed once when the trip is booked,
   * and it is part of the booking a shift senior types.
   *
   * `null` MEANS TWO DIFFERENT THINGS ON THE WAY OUT, and only the caller
   * knows which: the trip is genuinely unpriced, OR this caller may not see
   * prices and `redactPrices` has blanked it. See that function for why the
   * two are deliberately not distinguished over HTTP.
   */
  sellPrice: string | null;

  /**
   * What we pay the carrier to run it — `GIÁ CƯỚC MUA` — same shape, same
   * rules, same two readings of `null`.
   *
   * ★ `null` ON MOST TRIPS AND THAT IS ORDINARY. A run on one of our own
   * lorries is not bought from anybody; there is no figure to record. Nothing
   * here treats an absent buying price as a fault.
   *
   * ⚠ NOT THE SAME FACT AS A `trip_outsource_hires` ROW, THOUGH THEY DESCRIBE
   * THE SAME LORRY. That table is the cost ledger's record of a hire — voided
   * rather than edited, sitting behind `cost.read` at 'global', carrying the
   * carrier's name and the paperwork it came from. This is the figure agreed
   * on the booking form, which the head arranging the run needs while
   * arranging it. Neither is derived from the other and nothing reconciles
   * them; if they ever should agree, that is a rule somebody has to state.
   */
  purchasePrice: string | null;

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
  /** `null` exactly when `customerId` is. */
  customer: TripCustomerRef | null;
  /** Who wrote the row. Present always — `createdBy` is NOT NULL. */
  createdByUser: UserSummary;
  /**
   * Who is on it NOW — every ACTIVE assignment, oldest first. Empty while
   * nobody is. The history behind it is its own read; this is what the board
   * needs on every row: which lorries, which drivers.
   */
  assignments: TripAssignmentRef[];
  /** The master places the two snapshots came from, by name. `null` exactly when the id is. */
  pickupLocation: TripLocationRef | null;
  deliveryLocation: TripLocationRef | null;
}

/**
 * One active dispatch assignment as the board shows it: the pair, and when it
 * was made. Everything else about a turn — who assigned it, how it ended — is
 * the assignment history's business.
 */
export interface TripAssignmentRef {
  id: string;
  /** `null` only on a row 0029 could not backfill; the UI flags it. */
  vehicle: TripVehicleRef | null;
  driver: UserSummary;
  assignedAt: Date;
  /**
   * Has this turn started executing — one live event reported? Once it has,
   * the pair is immutable (ADR-0004) and the board offers no swap or removal.
   * The server refuses those anyway; this lets the UI not offer a 409.
   */
  started: boolean;
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
