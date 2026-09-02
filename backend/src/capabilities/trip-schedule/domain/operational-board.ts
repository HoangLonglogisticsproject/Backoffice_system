import type { UserSummary } from '../../../common/types/user-summary';
import type { ExpenseAccountability, ExpenseDeclaration } from './trip-execution';

/**
 * Where a trip actually stands, for the people who have to chase it.
 *
 * ★ EVERY VALUE HERE IS DERIVED, AND NOT ONE OF THEM IS STORED.
 *
 * `trip_schedules.status` keeps the five DISPATCH values 0011 gave it, owned by
 * Operations. What a manager wants to see is a different question — has the
 * driver arrived, is the paperwork in, who is sitting on it — and that is a
 * function of the execution events, the completion requests and the clock.
 *
 * Persisting it as a sixth status would create a column that has to be kept in
 * step with the three things it is computed from, and the stored copy is always
 * the one that goes stale. So it is computed on read, every time.
 */

/**
 * ★ ORDERED, AND THE ORDER IS THE TRIP'S PROGRESS.
 *
 * Each value is the FIRST unfinished step. A trip sitting at `AT_PICKUP` has
 * arrived and not yet confirmed loading; one at `DELIVERY_DELAYED` confirmed
 * loading, is past its delivery time, and has not arrived.
 */
export const OPERATIONAL_STAGES = [
  /** A lorry is on it, nobody is driving it. */
  'NO_DRIVER',
  /** A driver is on it and has reported nothing yet. */
  'DRIVER_ASSIGNED',
  /** Not yet due at the pickup. */
  'WAITING_PICKUP',
  /** ★ Past the planned pickup time with no arrival reported. */
  'PICKUP_DELAYED',
  /** Arrived; loading not confirmed. */
  'AT_PICKUP',
  /** Loaded and moving, not yet due. */
  'IN_TRANSIT',
  /** ★ Past the planned delivery time with no arrival reported. */
  'DELIVERY_DELAYED',
  /** Arrived at the delivery; handover not confirmed. */
  'AT_DELIVERY',
  /** Delivered, and nobody has asked for the trip to be closed. */
  'AWAITING_COMPLETION',
  /** Asked, waiting on a reviewer. */
  'COMPLETION_PENDING',
  /** Sent back. The driver has to correct something and ask again. */
  'COMPLETION_REJECTED',
  /** Approved and closed. */
  'DONE',
] as const;

export type OperationalStage = (typeof OPERATIONAL_STAGES)[number];

/**
 * The facts a stage is computed from. One row per trip, already aggregated.
 *
 * ★ `null` MEANS "NOT REPORTED", NEVER "DID NOT HAPPEN". A missing
 * `deliveryConfirmedAt` on a trip that plainly delivered is exactly the case
 * this board exists to surface.
 */
export interface OperationalFacts {
  hasActiveDriver: boolean;
  scheduledPickupAt: Date | null;
  scheduledDeliveryAt: Date | null;
  arrivedPickupAt: Date | null;
  pickupConfirmedAt: Date | null;
  arrivedDeliveryAt: Date | null;
  deliveryConfirmedAt: Date | null;
  completion: 'none' | 'pending' | 'approved' | 'rejected';
}

/**
 * Reads the stage off the facts.
 *
 * ★ NO SLA THRESHOLD ANYWHERE IN HERE, AND THAT IS DELIBERATE.
 *
 * "Delayed" means one thing only: the planned time has passed and the event has
 * not been reported. It is a COMPARISON, not a judgement. How many minutes late
 * is "a problem" is a business decision nobody has taken, so this file does not
 * take it — `delayMinutes` reports the number and lets a human decide.
 *
 * A trip with no planned time can never be delayed, because there is nothing to
 * be late against. That is honest rather than lenient: the answer to "is this
 * late" when nobody said when it was due is "unknown", and inventing a default
 * deadline would manufacture lateness out of missing data.
 */
export const stageOf = (facts: OperationalFacts, now: Date): OperationalStage => {
  if (facts.completion === 'approved') return 'DONE';
  if (facts.completion === 'pending') return 'COMPLETION_PENDING';
  if (facts.completion === 'rejected') return 'COMPLETION_REJECTED';

  if (facts.deliveryConfirmedAt) return 'AWAITING_COMPLETION';
  if (facts.arrivedDeliveryAt) return 'AT_DELIVERY';

  if (facts.pickupConfirmedAt) {
    return isPast(facts.scheduledDeliveryAt, now) ? 'DELIVERY_DELAYED' : 'IN_TRANSIT';
  }

  if (facts.arrivedPickupAt) return 'AT_PICKUP';

  if (!facts.hasActiveDriver) return 'NO_DRIVER';

  if (isPast(facts.scheduledPickupAt, now)) return 'PICKUP_DELAYED';

  // A driver is on it, the pickup is not yet due, and nothing has been
  // reported. `WAITING_PICKUP` and `DRIVER_ASSIGNED` are the same situation
  // seen from two sides; the schedule is what tells them apart.
  return facts.scheduledPickupAt ? 'WAITING_PICKUP' : 'DRIVER_ASSIGNED';
};

const isPast = (deadline: Date | null, now: Date): boolean =>
  deadline !== null && now.getTime() > deadline.getTime();

/**
 * How many minutes late, as a number and not as a verdict.
 *
 * Measured to the ACTUAL event when it was reported, and to NOW when it was
 * not — a trip three hours overdue and still unreported is more late with every
 * minute, and freezing the figure at zero would hide exactly that.
 *
 * Returns `null` when there is no planned time to measure against, and `0`
 * rather than a negative number when the event was early: "how late" has no
 * meaningful negative answer, and early arrivals are not what this board is for.
 */
export const delayMinutes = (
  scheduled: Date | null,
  actual: Date | null,
  now: Date,
): number | null => {
  if (!scheduled) return null;
  const reached = actual ?? now;
  return Math.max(0, Math.round((reached.getTime() - scheduled.getTime()) / 60_000));
};

/**
 * One row of the operational board.
 *
 * ★ THIS IS AN OPERATIONS AND MANAGEMENT VIEW, NOT A DRIVER VIEW. It names the
 * driver and shows how late they are, which is precisely the information the
 * driver's own read model must not carry about anybody else. It carries no
 * money either — the expense DECLARATION is a `none`/`expenses` word, never an
 * amount.
 */
export interface OperationalBoardRow {
  tripId: string;
  scheduledOn: string;

  vehicle: { id: string; plate: string } | null;
  customer: { id: string; name: string } | null;
  /** `null` when nobody is driving it — which is itself a finding. */
  driver: UserSummary | null;

  scheduledPickupAt: Date | null;
  scheduledDeliveryAt: Date | null;
  arrivedPickupAt: Date | null;
  pickupConfirmedAt: Date | null;
  arrivedDeliveryAt: Date | null;
  deliveryConfirmedAt: Date | null;

  stage: OperationalStage;
  /** Minutes past the planned pickup. `null` when nothing was planned. */
  pickupDelayMinutes: number | null;
  deliveryDelayMinutes: number | null;

  /** What the driver stated on the latest attempt. Never an amount. */
  expenseDeclaration: ExpenseDeclaration | null;
  accountability: ExpenseAccountability;
  completionAttempts: number;
  /** Why the latest attempt was sent back, when it was. */
  completionRejectionReason: string | null;
}
