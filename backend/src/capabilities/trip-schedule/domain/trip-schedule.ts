import type { UserSummary } from '../../../common/types/user-summary';

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
 * ★ `done` IS TERMINAL. THAT IS THE WHOLE STATE MACHINE, AND DELIBERATELY SO.
 *
 * A trip that has been delivered and closed does not go back to waiting for a
 * truck; reopening one is a different operation, and one nobody has specified.
 * So the only transition this refuses is a move AWAY from `done`.
 *
 * ⚠ THE OTHER FOUR ARE NOT ORDERED, AND MUST NOT BE. The legend they come from
 * lists them in roughly the order work moves — nothing produced yet, then
 * produced and waiting for a truck, then done — but two of them leave that line
 * entirely: `external_booking` is a ROUTE (subcontracted out), not a stage, and
 * `needs_confirmation` is an exception reachable from anywhere, including from
 * a trip that was otherwise ready. Constraining moves between those four would
 * be inventing a workflow the workbook does not describe, and the first thing
 * it would break is a dispatcher correcting a mis-click.
 *
 * Setting `done` on a trip that is already `done` is allowed: it changes
 * nothing, so it is not a move away from anything, and refusing it would make a
 * retried request fail for no reason.
 */
export const isStatusChangeAllowed = (from: TripStatus, to: TripStatus): boolean =>
  from !== 'done' || to === 'done';

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

  note: string | null;
  status: TripStatus;

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
