import type {
  CompletionRequest,
  ExecutionEvent,
  ExpenseAccountability,
} from './trip-execution';
import type { TripCost } from './trip-cost';

/**
 * What a driver is shown about a trip. An EXPLICIT WHITELIST, and nothing else.
 *
 * ★ WHY THIS TYPE EXISTS RATHER THAN A FILTER OVER `TripSchedule`.
 *
 * The contract promises a driver never sees commercial data. There are two ways
 * to keep that promise and only one of them survives contact with a changing
 * schema:
 *
 *   BLACKLIST   return the row, delete the sensitive fields
 *   WHITELIST   name every field that may leave, build a new object
 *
 * A blacklist is wrong the moment somebody adds a column. `trip_schedules` gains
 * a `margin` next year, nobody updates the filter, and the driver's phone starts
 * rendering it — silently, with no test failing, because the filter still
 * removes everything it was written to remove. A whitelist fails the other way:
 * a new column simply does not appear until somebody decides it should.
 *
 * ★ SO THIS IS A HAND-BUILT OBJECT, NOT A `Partial<TripSchedule>` AND NOT A
 * SPREAD WITH DELETIONS. Every field below was named on purpose, and the
 * repository's SELECT names the same list again — `SELECT *` is what a leak
 * looks like before it is a leak.
 *
 * ★ WHAT IS DELIBERATELY ABSENT, AND WHY EACH ONE:
 *
 *   note                 free text with no stated audience. The contract has not
 *                        said who writes it or what belongs in it, so it cannot
 *                        be shown to somebody the contract protects. See §16.
 *   status               the DISPATCH board's word, an Operations concept. A
 *                        driver acts on events and instructions, not on it.
 *   any money            no cost, no hire price, no total. Not filtered out —
 *                        the query never joins those tables at all.
 *   created_by, archived_*, closed_*   internal bookkeeping.
 *
 * ⚠ RESIDUAL RISK, STATED RATHER THAN HIDDEN. Five of the fields below are FREE
 * TEXT typed by Operations — cargo, two addresses, two contacts. Nothing stops
 * somebody typing a price into one of them, and no whitelist can. They are
 * included because a driver cannot deliver without them, and `driverInstructions`
 * exists precisely so there is one field that is driver-safe BY CONSTRUCTION
 * rather than by everybody remembering.
 */
export interface DriverTrip {
  tripId: string;

  /** The board day, as text. Never a `Date`: `new Date('2026-08-30')` is the
   * previous evening in Hồ Chí Minh. */
  scheduledOn: string;

  /** ★ THE PLATE, NOT THE VEHICLE ROW. No ownership, no carrier, no note — a
   * driver needs to know which lorry, not who we bought it from. */
  vehicle: { id: string; plate: string } | null;

  /** ★ THE NAME ONLY. Who to deliver to is operational; what they pay is not,
   * and no price column is joined here in any case. */
  customer: { id: string; name: string } | null;

  pickupAddress: string | null;
  pickupContact: string | null;
  deliveryAddress: string | null;
  deliveryContact: string | null;
  cargoInfo: string | null;

  /** Planned, not actual. The actual times live on the execution events. */
  scheduledPickupAt: Date | null;
  scheduledDeliveryAt: Date | null;

  /** ★ The one field written FOR the driver, and the only one guaranteed to
   * carry nothing else. */
  driverInstructions: string | null;

  assignment: { id: string; assignedAt: Date };
}

/**
 * One trip, opened.
 *
 * Everything in `DriverTrip`, plus the driver's own working state: what they
 * have reported, what they have declared, and where the completion stands.
 */
export interface DriverTripDetail extends DriverTrip {
  /** The driver's own timeline. Voided events excluded. */
  events: ExecutionEvent[];

  /**
   * ★ ONLY THE LINES THIS DRIVER DECLARED, AND NO TOTAL.
   *
   * Two separate rules, and both matter. A backoffice cost line is internal
   * accounting the contract keeps from the driver, so the query filters on
   * `source` AND on the author. And there is no total anywhere in this type,
   * because a trip's total INCLUDES the price agreed with a hired carrier —
   * which is exactly the commercial figure a driver must never see.
   */
  expenses: TripCost[];

  /** Derived, never stored. `NOT_DECLARED` ≠ `DECLARED_NO_EXPENSE`. */
  accountability: ExpenseAccountability;

  /**
   * The latest attempt, so the driver can see a rejection and act on it.
   *
   * `decisionReason` is included ON PURPOSE and is the point of showing this at
   * all: a driver told only "rejected" has nothing to correct.
   */
  completion: CompletionRequest | null;
}
