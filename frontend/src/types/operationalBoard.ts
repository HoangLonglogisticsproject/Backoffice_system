import type { UserSummary } from './organization';
import type { ExpenseAccountability, ExpenseDeclaration } from './driver';

/**
 * Where every trip actually stands, as the server derives it.
 *
 * ★ NOTHING HERE IS STORED, AND NOTHING HERE IS COMPUTED IN THE BROWSER. The
 * stage and both delay figures are decided on the server from the execution
 * events, the completion requests and ITS clock. A client that recomputed them
 * would be a second opinion measured against a different clock — and the two
 * would disagree for exactly the trips somebody is arguing about.
 *
 * ★ AND THERE IS NO MONEY IN THIS TYPE. `expenseDeclaration` is a `none` /
 * `expenses` WORD, never an amount. The server sends no total, no cost, no hire
 * price on this read at all.
 */

/**
 * The first unfinished step, in the order a trip progresses.
 *
 * ⚠ THIS IS NOT `trip_schedules.status`. That column keeps the five DISPATCH
 * values Operations owns. These are derived operational states and are never
 * written anywhere.
 */
export type OperationalStage =
  | 'NO_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'WAITING_PICKUP'
  | 'PICKUP_DELAYED'
  | 'AT_PICKUP'
  | 'IN_TRANSIT'
  | 'DELIVERY_DELAYED'
  | 'AT_DELIVERY'
  | 'AWAITING_COMPLETION'
  | 'COMPLETION_PENDING'
  | 'COMPLETION_REJECTED'
  | 'DONE';

export interface OperationalBoardRow {
  tripId: string;
  scheduledOn: string;

  vehicle: { id: string; plate: string } | null;
  customer: { id: string; name: string } | null;
  /** `null` when nobody is driving it — itself a finding. */
  driver: UserSummary | null;

  /** The plan. */
  scheduledPickupAt: string | null;
  scheduledDeliveryAt: string | null;

  /** What was reported, from the server's clock. */
  arrivedPickupAt: string | null;
  pickupConfirmedAt: string | null;
  arrivedDeliveryAt: string | null;
  deliveryConfirmedAt: string | null;

  stage: OperationalStage;

  /**
   * ★ MINUTES, FROM THE SERVER, AND NOT A VERDICT.
   *
   * No threshold decides these. "How late is too late" has never been agreed,
   * so the server reports the number and a person reads it. `null` means nothing
   * was planned — with no deadline there is nothing to be late against.
   */
  pickupDelayMinutes: number | null;
  deliveryDelayMinutes: number | null;

  /** What the driver STATED. Never inferred from the absence of rows. */
  expenseDeclaration: ExpenseDeclaration | null;
  accountability: ExpenseAccountability;
  completionAttempts: number;
  /** Why the latest attempt was sent back, while it is the latest. */
  completionRejectionReason: string | null;
}
