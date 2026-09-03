import type { UserSummary } from '../../../common/types/user-summary';
import type { LocationEvidence } from './trip-location';

/**
 * The operational half of a trip: who drove it, what happened, and how it ended.
 *
 * 0011 recorded what was PLANNED and 0012 recorded what it COST. Nothing
 * recorded what the lorry actually did, or who was in it. These are the types
 * for the three tables that close that gap.
 *
 * ★ THERE IS NO `Driver` TYPE HERE, AND THAT IS NOT AN OMISSION. A driver is a
 * user — the same account that signs in. What is modelled is the RELATIONSHIP
 * between a user and a trip over time, which is the thing that actually changes
 * and the thing every other record has to point at.
 */

/**
 * Whose lorry it is.
 *
 * ★ TWO VALUES, AND NO `unknown`. A lorry is ours or it is hired; the business
 * has no third kind. Where the classification has not been made yet the value is
 * ABSENT — `null` — which is a statement about our records rather than about the
 * lorry. Nothing may read `null` as `company`.
 */
export const VEHICLE_OWNERSHIPS = ['company', 'outsourced'] as const;
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIPS)[number];

/**
 * ★ THE FOUR THINGS A DRIVER REPORTS, AND THEY ARE NOT A TRIP STATUS.
 *
 * `trip_schedules.status` stays what 0011 made it: five DISPATCH values owned by
 * Operations. These four are execution facts, and the operational states the
 * business wants on a screen — waiting, delayed, in transit, and the rest — are
 * DERIVED by reading them. Persisting those as a second status column would
 * create two sources of truth, and the derived one would be the stale one.
 */
export const EXECUTION_EVENT_TYPES = [
  /** Đến điểm lấy hàng */
  'ARRIVED_PICKUP',
  /** Xác nhận lấy hàng */
  'PICKUP_CONFIRMED',
  /** Đến điểm giao hàng */
  'ARRIVED_DELIVERY',
  /** Xác nhận giao hàng */
  'DELIVERY_CONFIRMED',
] as const;

export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

/**
 * Which milestones must already stand before this one may be reported.
 *
 * ★ "NOTHING MAY BE SKIPPED", NOT "THIS MUST BE THE NEXT ONE".
 *
 * The difference matters. A driver who arrives, leaves and comes back reports
 * ARRIVED_PICKUP a second time — a genuine repeated milestone, and refusing it
 * would lose a real fact. What must never happen is confirming a pickup that
 * was never reported as reached, because every figure downstream then measures
 * against a step that has no time.
 *
 * So the rule is a PREFIX rule: every earlier milestone needs at least one
 * live reading, and the milestone being reported may repeat freely.
 *
 * ⚠ VOIDED READINGS DO NOT COUNT. Withdrawing an arrival puts the step back to
 * outstanding, and a confirmation after that is skipping again.
 */
export const missingPrerequisite = (
  type: ExecutionEventType,
  reported: readonly ExecutionEventType[],
): ExecutionEventType | null => {
  const position = EXECUTION_EVENT_TYPES.indexOf(type);
  const seen = new Set(reported);

  return EXECUTION_EVENT_TYPES.slice(0, position).find((earlier) => !seen.has(earlier)) ?? null;
};

/**
 * Which end of the trip an event belongs to.
 *
 * Used to pick WHICH planned time to snapshot beside the event: a pickup event
 * is late against `pickup_at`, a delivery event against `delivery_at`. Comparing
 * either against the wrong one produces a delay figure that is wrong by the
 * length of the journey.
 */
export const isPickupEvent = (type: ExecutionEventType): boolean =>
  type === 'ARRIVED_PICKUP' || type === 'PICKUP_CONFIRMED';

/** A driver's turn on a trip. Ended, never overwritten. */
export interface DriverAssignment {
  id: string;
  tripId: string;

  driverUserId: string;
  /** The driver, spelled out — a UUID cannot be shown to anybody. */
  driverUser: UserSummary;

  state: 'active' | 'ended';

  assignedBy: string;
  assignedAt: Date;

  /** All three are null together, or set together. */
  endedBy: string | null;
  endedAt: Date | null;
  endReason: string | null;
}

/**
 * Something that happened, as reported.
 *
 * ★ THREE CLOCKS, BECAUSE THEY ARE THREE DIFFERENT CLAIMS.
 *
 *   actualAt          when it happened
 *   recordedAt        when the SERVER heard — operational truth
 *   deviceReportedAt  what the handset's own clock said — DIAGNOSTIC ONLY
 *
 * A phone's clock can be wrong, off, or set deliberately. It is kept so a
 * disagreement can be investigated, and it is never what a figure is computed
 * from.
 */
export interface ExecutionEvent {
  id: string;
  tripId: string;
  driverAssignmentId: string;
  type: ExecutionEventType;

  /**
   * What was true when this was written, not what is true now.
   *
   * ★ NEVER RE-READ FROM THE TRIP. The trip's vehicle today may not be the
   * vehicle this event happened in, and `scheduledAt` copied at write time is
   * what stops Operations correcting a plan next week from rewriting whether
   * last week's trip was late.
   */
  vehicleId: string | null;
  vehicleOwnership: VehicleOwnership | null;
  scheduledAt: Date | null;

  actualAt: Date;
  recordedAt: Date;
  deviceReportedAt: Date | null;

  /**
   * Where the handset said it was, if it said. EVIDENCE, not proof — see
   * `trip-location.ts`. Absent on every event written before 0019 and on any
   * milestone reported without a reading.
   */
  location: LocationEvidence | null;
  /**
   * The SERVER's verdict and the figure behind it, on milestones that are
   * geofenced. Both `null` where no check applied. Never accepted from a
   * client: the route's DTO has no field for either.
   */
  geofencePassed: boolean | null;
  distanceM: number | null;

  recordedBy: string;
  recordedByUser: UserSummary;

  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/**
 * What the driver says about the trip's money.
 *
 * ★ THE WHOLE REASON THIS EXISTS: ZERO ROWS IS NOT AN ANSWER.
 *
 * A trip with no cost lines is either a trip that cost nothing, or a trip whose
 * driver forgot. Those are completely different facts and they look identical in
 * the data — so the driver is made to say which, and nothing infers it for them.
 * `none` is a claim somebody made; the absence of rows is not.
 */
export const EXPENSE_DECLARATIONS = ['none', 'expenses'] as const;
export type ExpenseDeclaration = (typeof EXPENSE_DECLARATIONS)[number];

/**
 * Where a trip stands on the question "has the money been accounted for".
 *
 * ★ DERIVED, NEVER STORED. Every value below is computed from the completion
 * requests and the cost lines that already exist. Persisting it would create a
 * sixth status to keep in step with the two things it is derived from, and the
 * stored copy is always the one that goes stale.
 *
 * ★ AND THE FIRST TWO ARE THE POINT. `NOT_DECLARED` and `DECLARED_NO_EXPENSE`
 * both show no money. One is an outstanding obligation and the other is a
 * finished trip, and a dashboard that renders them the same way is a dashboard
 * that hides exactly the trips somebody needs to chase.
 */
export const EXPENSE_ACCOUNTABILITY = [
  /** Nobody has asked for this trip to be closed yet. */
  'NOT_DECLARED',
  /** The driver stated there was nothing to claim. */
  'DECLARED_NO_EXPENSE',
  /** The driver stated there were expenses, and entered them. */
  'DECLARED_WITH_EXPENSE',
  /** Sent back. The driver has to correct something and ask again. */
  'REJECTED_NEEDS_CORRECTION',
  /** Approved. The figures are final and the trip is closed. */
  'APPROVED_IMMUTABLE',
] as const;

export type ExpenseAccountability = (typeof EXPENSE_ACCOUNTABILITY)[number];

/**
 * Reads a trip's accountability from its completion history.
 *
 * `requests` newest attempt first, which is the order the repository returns.
 *
 * ★ APPROVAL WINS OVER EVERYTHING, including a later attempt that should not
 * exist: `uq_trip_completion_approved` allows one approval ever, and once it is
 * there the trip is closed whatever else the history holds. Rejection is read
 * from the LATEST attempt only — an old rejection followed by a fresh pending
 * request is a trip being worked on, not a trip needing correction.
 */
export const accountabilityOf = (requests: readonly CompletionRequest[]): ExpenseAccountability => {
  if (requests.some((request) => request.state === 'approved')) return 'APPROVED_IMMUTABLE';

  const latest = requests[0];
  if (!latest) return 'NOT_DECLARED';

  if (latest.state === 'rejected') return 'REJECTED_NEEDS_CORRECTION';

  return latest.expenseDeclaration === 'expenses' ? 'DECLARED_WITH_EXPENSE' : 'DECLARED_NO_EXPENSE';
};

/** A driver asking for a trip to be closed. One row per attempt. */
export interface CompletionRequest {
  id: string;
  tripId: string;
  driverAssignmentId: string;

  /** 1 for the first ask, 2 after one rejection, and so on. Never reused. */
  attemptNo: number;

  /**
   * What the driver says about the money on this trip.
   *
   * ★ STATED, NOT INFERRED, AND RESTATED ON EVERY ATTEMPT. A resubmission is a
   * new row, so a driver correcting a rejected trip says where they stand again
   * rather than having last week's answer carried forward silently.
   */
  expenseDeclaration: ExpenseDeclaration;
  state: 'pending' | 'approved' | 'rejected';

  submittedBy: string;
  submittedByUser: UserSummary;
  submittedAt: Date;

  decidedBy: string | null;
  decidedAt: Date | null;
  /**
   * ★ REQUIRED WHEN REJECTED, AND THE DATABASE SAYS SO TOO.
   *
   * Two existing approval flows in this codebase collect a reason in the UI and
   * discard it in the API. A driver told only "rejected" has nothing to act on,
   * so here it is a column the row cannot exist without.
   */
  decisionReason: string | null;
}

/**
 * Where a cost line is in its life.
 *
 * ★ `locked` IS NOT `immutable`. Locking is temporary — a rejected completion
 * reopens every line back to `editable`. Only approval makes a figure permanent,
 * because approval is when the company commits to it.
 *
 * A backoffice line is born `immutable`: it never passes through a completion
 * request at all, which is exactly what 0012 has always done.
 */
export const TRIP_COST_STATES = ['editable', 'locked', 'immutable'] as const;
export type TripCostState = (typeof TRIP_COST_STATES)[number];

/**
 * Which channel typed a figure.
 *
 * ★ NOT DERIVABLE FROM `createdBy`. One person may hold both a portal login and
 * a backoffice login, so the author's id does not say whether a figure came off
 * a phone at a fuel station or out of an invoice on a desk — and those two are
 * reviewed differently.
 */
export const TRIP_COST_SOURCES = ['driver_portal', 'backoffice'] as const;
export type TripCostSource = (typeof TRIP_COST_SOURCES)[number];

/** One field of one cost line, changed. Append-only. */
export interface TripCostEdit {
  id: string;
  costId: string;
  field: 'category' | 'amount' | 'note';
  oldValue: string | null;
  newValue: string | null;
  editedBy: string;
  editedByUser: UserSummary;
  editedAt: Date;
}
