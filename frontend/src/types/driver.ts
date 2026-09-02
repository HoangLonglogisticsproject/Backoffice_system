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

  scheduledPickupAt: string | null;
  scheduledDeliveryAt: string | null;

  /** The one field written FOR the driver. */
  driverInstructions: string | null;

  assignment: { id: string; assignedAt: string };
}

export interface DriverTripDetail extends DriverTrip {
  /** This trip's timeline. Voided events are already excluded by the server. */
  events: ExecutionEvent[];
  /** ★ Only the lines THIS driver declared. There is no total, on purpose. */
  expenses: TripCost[];
  accountability: ExpenseAccountability;
  /** The latest attempt, or `null` when none has been made. */
  completion: CompletionRequest | null;
}
