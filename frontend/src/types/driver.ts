import type { UserSummary } from './organization';
import type { TripCost } from './tripCost';

/**
 * What the Driver Portal receives, mirroring the backend response verbatim.
 *
 * ★ NOTHING HERE RENAMES, ROUNDS OR INVENTS A FIELD. A second definition of
 * what a trip is would be a second thing to keep in step with the API, and the
 * first divergence would be silent.
 *
 * ★ AND THE ABSENCES ARE THE INTERESTING PART. The server sends a WHITELIST —
 * no price, no cost, no hire amount, no margin, no `note` — so those fields
 * cannot be typed here because they never arrive. If a future field appears in
 * this file, it appeared in the server's whitelist first, on purpose.
 */

/** Whose lorry it is. `null` means nobody has classified it — never "company". */
export type VehicleOwnership = 'company' | 'outsourced';

/** A point on Earth, as the server stores it. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * What the handset said about where it was, as the server kept it. Four
 * fields that move together. EVIDENCE — the server measured it and reached
 * the verdict; the portal only ever sent the reading.
 */
export interface LocationEvidence extends Coordinates {
  /** The handset's own error estimate, metres. */
  accuracyM: number;
  /** The handset's clock at the fix. Diagnostic, like `deviceReportedAt`. */
  capturedAt: string;
}

/**
 * The four things a driver reports, in the order they happen.
 *
 * ★ THIS IS NOT A TRIP STATUS. The dispatch board keeps its own five values,
 * owned by Operations. These are execution facts, and every stage the portal
 * shows is DERIVED from them — see `utils/driverExecution`.
 */
export const EXECUTION_EVENT_TYPES = [
  'ARRIVED_PICKUP',
  'PICKUP_CONFIRMED',
  'ARRIVED_DELIVERY',
  'DELIVERY_CONFIRMED',
] as const;

export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

export interface ExecutionEvent {
  id: string;
  tripId: string;
  driverAssignmentId: string;
  type: ExecutionEventType;

  vehicleId: string | null;
  vehicleOwnership: VehicleOwnership | null;
  /** The plan as it stood WHEN the event was recorded. Never re-read. */
  scheduledAt: string | null;

  /** When it happened. */
  actualAt: string;
  /** When the server heard. Operational truth. */
  recordedAt: string;
  /** What the handset's own clock said. Diagnostic only — never displayed as fact. */
  deviceReportedAt: string | null;

  /** The reading sent with this milestone, if one was. */
  location: LocationEvidence | null;
  /** The SERVER's verdict on a geofenced milestone. `null` where none applied. */
  geofencePassed: boolean | null;
  distanceM: number | null;

  recordedBy: string;
  recordedByUser: UserSummary;

  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/**
 * What the driver states about the money on the trip.
 *
 * ★ ZERO EXPENSE ROWS IS NOT AN ANSWER. A trip with no lines is either a trip
 * that cost nothing or a driver who forgot, and only the driver can tell them
 * apart — so the portal MUST ask, and must never default this.
 */
export type ExpenseDeclaration = 'none' | 'expenses';

export type CompletionState = 'pending' | 'approved' | 'rejected';

export interface CompletionRequest {
  id: string;
  tripId: string;
  driverAssignmentId: string;
  /** 1 for the first ask, 2 after one rejection. Never reused. */
  attemptNo: number;
  expenseDeclaration: ExpenseDeclaration;
  state: CompletionState;

  submittedBy: string;
  submittedByUser: UserSummary;
  submittedAt: string;

  decidedBy: string | null;
  decidedAt: string | null;
  /** Required when rejected. The one thing the driver has to act on. */
  decisionReason: string | null;
}

/** Where the trip stands on accounting for its money. Derived by the server. */
export type ExpenseAccountability =
  | 'NOT_DECLARED'
  | 'DECLARED_NO_EXPENSE'
  | 'DECLARED_WITH_EXPENSE'
  | 'REJECTED_NEEDS_CORRECTION'
  | 'APPROVED_IMMUTABLE';

/** One trip as the driver sees it. */
export interface DriverTrip {
  tripId: string;
  scheduledOn: string;

  vehicle: { id: string; plate: string } | null;
  customer: { id: string; name: string } | null;

  pickupAddress: string | null;
  pickupContact: string | null;
  deliveryAddress: string | null;
  deliveryContact: string | null;
  cargoInfo: string | null;

  /**
   * Where each end is, when the office has entered it. `null` on the pickup
   * means the pickup cannot be confirmed yet — the server refuses it — so the
   * screen says so before the driver taps.
   */
  pickupLocation: Coordinates | null;
  deliveryLocation: Coordinates | null;

  scheduledPickupAt: string | null;
  scheduledDeliveryAt: string | null;

  /** The one field written FOR the driver. */
  driverInstructions: string | null;

  assignment: { id: string; assignedAt: string };
}

/**
 * Where a page of history stopped. Opaque to this app: it is handed back to the
 * server unchanged.
 *
 * ★ THE PAIR, NOT THE TIMESTAMP ALONE. One dispatch action can create several
 * turns in the same statement, so `assignedAt` is not unique — a cursor on it
 * by itself would repeat those rows or skip them.
 */
export interface DriverHistoryCursor {
  assignedAt: string;
  id: string;
}

/**
 * One page of finished trips, newest first.
 *
 * ★ NO TOTAL COUNT, AND THAT IS THE SERVER'S DECISION SHOWING THROUGH. "How
 * many trips have I run" is a figure pay is reconciled against; this screen
 * exists so a driver can look their own work up, not so it becomes a number
 * either side quotes.
 */
export interface DriverHistoryPage {
  trips: DriverTrip[];
  /** `null` when there is nothing older — the screen stops asking. */
  nextCursor: DriverHistoryCursor | null;
}

export interface DriverTripDetail extends DriverTrip {
  /** This trip's timeline. Voided events are already excluded by the server. */
  events: ExecutionEvent[];
  /** ★ Only the lines THIS driver declared. There is no total, on purpose. */
  expenses: TripCost[];
  accountability: ExpenseAccountability;
  /** The latest attempt, or `null` when none has been made. */
  completion: CompletionRequest | null;
  /**
   * ★ THE TRIP IS FINISHED — this turn is a record, opened from "Đã chạy xong"
   * or a past card. The screen draws no milestone and no completion for it
   * (`driverExecution`); the server refuses those regardless. Whether money may
   * still be written is `expensesOpen`, not this.
   */
  closed: boolean;
  /**
   * ★ MAY THE DRIVER DECLARE OR CORRECT A FIGURE ON THIS TURN NOW — THE
   * SERVER'S ANSWER, read as it is. True on live work whose money no
   * completion request is holding, and on a run recorded after the fact
   * ("Nhập chuyến cũ"), whose driver backfills what it cost. The handset
   * decides nothing about money itself.
   */
  expensesOpen: boolean;
  /**
   * ★ THIS TURN'S FUEL IS DECLARED ON THE LORRY, NOT AS A TRIP EXPENSE: live
   * work on a lorry with a daily fuel check. The expense form leaves `fuel` out;
   * the server refuses it either way. The server's answer, never re-derived.
   */
  fuelOnVehicle: boolean;
}

/** The lorry's answer for the business day: it was filled, or it was not. */
export type DailyFuelOutcome = 'fuel_added' | 'no_fuel';

/**
 * "Khai nhiên liệu đầu ca". ★ No lorry and no day: both are the server's
 * (the assignment's lorry, today in Asia/Ho_Chi_Minh). Amounts and liters are
 * decimal STRINGS for the reason `DeclareExpenseInput.amount` gives.
 */
export type DailyFuelDeclarationInput =
  | {
      outcome: 'fuel_added';
      amount: string;
      liters: string | null;
      odometerKm: number | null;
      note: string | null;
      clientRequestId: string;
    }
  | { outcome: 'no_fuel'; clientRequestId: string };

/** The check that stands for the lorry today — possibly another driver's. */
export interface DailyFuelCheck {
  businessDate: string;
  outcome: DailyFuelOutcome;
}

/**
 * Where the lorry's beginning-of-shift check stands today — the obligation and
 * its answer, never an amount. The server's word, never re-derived here.
 */
export type FuelObligation = 'NOT_REQUIRED' | 'REQUIRED_MISSING' | 'FUEL_ADDED' | 'NO_FUEL';

/** How far a turn has got: live milestones 0..4, and the first one still owed. */
export interface TurnProgress {
  reached: number;
  next: ExecutionEventType | null;
}

export interface DriverWorkdayTurn extends DriverTrip {
  /** The trip is finished — the turn is a record now. */
  closed: boolean;
  progress: TurnProgress;
}

/**
 * "Ca làm việc hôm nay" — the driver's lorries today, each with its turns.
 * Today is the server's business day; several lorries a day is normal.
 */
export interface DriverWorkday {
  businessDate: string;
  vehicles: Array<{
    vehicle: { id: string; plate: string };
    fuel: FuelObligation;
    /** The lorry's fuel is declared on it, so a fill may be recorded on it. */
    fuelOnVehicle: boolean;
    turns: DriverWorkdayTurn[];
  }>;
}

/**
 * "Ghi nhận đổ nhiên liệu" — a fill after the day's check. ★ No lorry and no
 * day: the turn names the lorry, the server's clock names the day.
 */
export interface FuelFillInput {
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  note: string | null;
  clientRequestId: string;
}

/** The driver's own fill, as recorded. Never the day's total. */
export interface DriverFuelTransaction {
  id: string;
  businessDate: string;
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  note: string | null;
  createdAt: string;
}
