import { Injectable } from '@nestjs/common';
import type { DateRangePageQuery } from '../../../common/pagination/date-range-page-query.dto';
import {
  delayMinutes,
  stageOf,
  type OperationalBoardRow,
} from '../domain/operational-board';
import type { ExpenseAccountability } from '../domain/trip-execution';
import {
  OperationalBoardRepository,
  type OperationalBoardRecord,
} from '../persistence/operational-board.repository';

/**
 * What is actually happening out there, for the people who have to chase it.
 *
 * ★ THIS ANSWERS THE NINE QUESTIONS THE CONTRACT ASKS, AND IT STORES NOTHING TO
 * DO IT. Each one is a shape of the same row:
 *
 *   assigned but nothing reported          stage NO_DRIVER / DRIVER_ASSIGNED
 *   past pickup, no arrival                stage PICKUP_DELAYED
 *   arrived, not confirmed                 stage AT_PICKUP
 *   loaded, past delivery, no arrival      stage DELIVERY_DELAYED
 *   arrived at delivery, not confirmed     stage AT_DELIVERY
 *   delivered, no completion asked         stage AWAITING_COMPLETION
 *   waiting on a reviewer                  stage COMPLETION_PENDING
 *   sent back                              stage COMPLETION_REJECTED
 *   closed                                 stage DONE
 *
 * ★ AND `now` IS PASSED IN RATHER THAN READ INSIDE THE LOOP. Every row on a
 * page must be judged against the SAME instant, or a board of two hundred trips
 * computes "late" against two hundred slightly different clocks and two
 * refreshes disagree about a trip sitting exactly on its deadline.
 */
@Injectable()
export class OperationalBoardService {
  constructor(private readonly board: OperationalBoardRepository) {}

  /**
   * The board for a date range.
   *
   * Not paginated the way the dispatch list is: this is a working screen over a
   * bounded range, and the range is what keeps it bounded — the same argument
   * ADR-0003 makes, applied to a different read.
   */
  async list(query: DateRangePageQuery, now = new Date()): Promise<OperationalBoardRow[]> {
    const rows = await this.board.listInRange({ from: query.from, to: query.to });
    return rows.map((row) => toBoardRow(row, now));
  }

  /**
   * The completion review queue: every trip whose completion is still open.
   *
   * ★ DELIBERATELY NOT DATE-FILTERED. A request submitted on the 30th and
   * undecided on the 1st is today's work, not last month's — the trip's
   * schedule and the reviewer's workload are different axes, and filtering one
   * by the other made outstanding reviews vanish at a month boundary.
   *
   * Oldest first: the trip that has waited longest is the one to decide next.
   */
  async listUnresolvedCompletions(now = new Date()): Promise<OperationalBoardRow[]> {
    const rows = await this.board.listUnresolvedCompletions();
    return rows.map((row) => toBoardRow(row, now));
  }
}

const toBoardRow = (row: OperationalBoardRecord, now: Date): OperationalBoardRow => {
  const facts = {
    hasActiveDriver: row.driver_user_id !== null,
    scheduledPickupAt: row.pickup_at,
    scheduledDeliveryAt: row.delivery_at,
    arrivedPickupAt: row.arrived_pickup_at,
    pickupConfirmedAt: row.pickup_confirmed_at,
    arrivedDeliveryAt: row.arrived_delivery_at,
    deliveryConfirmedAt: row.delivery_confirmed_at,
    completion: (row.completion_state ?? 'none') as 'none' | 'pending' | 'approved' | 'rejected',
  };

  return {
    tripId: row.trip_id,
    scheduledOn: row.scheduled_on,
    vehicle:
      row.vehicle_id && row.vehicle_plate ? { id: row.vehicle_id, plate: row.vehicle_plate } : null,
    customer:
      row.customer_id && row.customer_name
        ? { id: row.customer_id, name: row.customer_name }
        : null,
    driver:
      row.driver_user_id && row.driver_display_name
        ? { id: row.driver_user_id, displayName: row.driver_display_name }
        : null,

    scheduledPickupAt: row.pickup_at,
    scheduledDeliveryAt: row.delivery_at,
    arrivedPickupAt: row.arrived_pickup_at,
    pickupConfirmedAt: row.pickup_confirmed_at,
    arrivedDeliveryAt: row.arrived_delivery_at,
    deliveryConfirmedAt: row.delivery_confirmed_at,

    stage: stageOf(facts, now),
    // ★ A NUMBER, NOT A VERDICT. No threshold is applied because none has been
    // agreed; "how late is too late" stays a human judgement made from this
    // figure rather than one this file makes on everybody's behalf.
    pickupDelayMinutes: delayMinutes(row.pickup_at, row.arrived_pickup_at, now),
    deliveryDelayMinutes: delayMinutes(row.delivery_at, row.arrived_delivery_at, now),

    expenseDeclaration: row.expense_declaration,
    accountability: accountabilityFrom(row),
    // `count(*)` comes back as a string from a bigint, so it is converted
    // explicitly rather than left to surprise a caller doing arithmetic.
    completionAttempts: Number(row.completion_attempts),
    // Only meaningful while the latest attempt is the rejected one.
    completionRejectionReason: row.completion_state === 'rejected' ? row.decision_reason : null,
  };
};

/**
 * The same five values `accountabilityOf` produces, read off the aggregated row.
 *
 * ★ NOT A SECOND RULE — THE SAME ONE, APPLIED TO A DIFFERENT SHAPE. The domain
 * function takes a list of requests, which this query has already collapsed to
 * the latest attempt plus a count. Re-fetching every attempt per row purely to
 * reuse that function would be an N+1 for a value already in hand.
 */
const accountabilityFrom = (row: OperationalBoardRecord): ExpenseAccountability => {
  if (row.completion_state === 'approved') return 'APPROVED_IMMUTABLE';
  if (row.completion_state === 'rejected') return 'REJECTED_NEEDS_CORRECTION';
  if (row.completion_state === null) return 'NOT_DECLARED';
  return row.expense_declaration === 'expenses' ? 'DECLARED_WITH_EXPENSE' : 'DECLARED_NO_EXPENSE';
};
