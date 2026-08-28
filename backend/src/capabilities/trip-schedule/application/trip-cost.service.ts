import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import {
  isRecordableAmount,
  TRIP_COST_CATEGORIES,
  type OutsourceHire,
  type TripCost,
  type TripCostCategory,
  type TripCostTotals,
} from '../domain/trip-cost';
import {
  OutsourceHireRepository,
  TripCostRepository,
  TripCostTotalsRepository,
} from '../persistence/trip-cost.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';

/**
 * A trip's money.
 *
 * WHAT THIS OWNS: that a figure belongs to a trip that exists, that it is an
 * amount PostgreSQL can hold exactly, that a record is withdrawn rather than
 * edited, and that a withdrawal says why. It owns no authorization — the guard
 * decided that before any method here ran.
 *
 * ★ NO TRANSACTION IS OPENED ANYWHERE IN THIS FILE, and that is not an
 * omission. Every operation is a single statement against a single table. The
 * one thing that looks like a read-modify-write — voiding — is not: the UPDATE
 * carries `voided_at IS NULL` in its own WHERE clause, so two callers racing to
 * void the same line cannot both succeed, and the loser gets no row back. A
 * transaction around it would add a lock and change nothing.
 *
 * ★ AND THERE IS NO `update` METHOD, ON PURPOSE. A financial record is
 * immutable once written: correcting a wrong figure means voiding it, with a
 * reason, and creating a new one. The repository offers no way to change an
 * amount, a category or a trip either, so the rule is not merely unenforced
 * here — it is unspellable.
 */
@Injectable()
export class TripCostService {
  constructor(
    private readonly trips: TripScheduleRepository,
    private readonly costs: TripCostRepository,
    private readonly hires: OutsourceHireRepository,
    private readonly totals: TripCostTotalsRepository,
  ) {}

  // ---------------------------------------------------------------- costs ----

  /**
   * Records what running our own lorry cost.
   *
   * `createdBy` comes from the session, never from the body — a body that names
   * its own author is a body that can name somebody else's.
   */
  async createCost(input: {
    tripId: string;
    category: TripCostCategory;
    amount: string;
    note?: string | null;
    createdBy: string;
  }): Promise<TripCost> {
    await this.requireTrip(input.tripId);
    requireCategory(input.category);
    requireAmount(input.amount);

    return this.costs.create({
      tripId: input.tripId,
      category: input.category,
      amount: input.amount,
      note: blankToNull(input.note),
      createdBy: input.createdBy,
    });
  }

  /**
   * A trip's cost lines, and what they come to.
   *
   * @param includeVoided the withdrawn lines as well. Off by default, because
   * the only screen that wants them is the one auditing a correction — but the
   * total NEVER includes them either way.
   */
  async listCosts(
    tripId: string,
    includeVoided = false,
  ): Promise<{ items: TripCost[]; total: string }> {
    await this.requireTrip(tripId);

    const items = includeVoided
      ? await this.costs.listByTrip(tripId)
      : await this.costs.listActiveByTrip(tripId);

    return { items, total: (await this.totals.forTrip(tripId)).costs };
  }

  /**
   * Withdraws a line.
   *
   * ★ THE LINE MUST BELONG TO THE TRIP IN THE ROUTE. Without this, a caller
   * holding one trip's id could withdraw a line from any other trip by pairing
   * it with a foreign line id — the route would read as authorised and the
   * wrong month's total would change.
   */
  async voidCost(
    tripId: string,
    costId: string,
    input: { by: string; reason: string },
  ): Promise<TripCost> {
    const reason = requireReason(input.reason);

    const current = await this.costs.findById(costId);
    if (!current || current.tripId !== tripId) throw new NotFoundError('Cost line not found.');
    if (current.voidedAt) throw new ConflictError('That cost line has already been voided.');

    const voided = await this.costs.void(costId, input.by, reason, new Date());
    // The row existed and was live one statement ago, so an empty result here
    // is a concurrent void rather than a missing row — and the answer is the
    // same one the check above would have given.
    if (!voided) throw new ConflictError('That cost line has already been voided.');

    return voided;
  }

  // ------------------------------------------------------- outsource hires ----

  async createHire(input: {
    tripId: string;
    carrierName: string;
    agreedAmount: string;
    amountIncludesVat?: boolean;
    documentRef?: string | null;
    note?: string | null;
    createdBy: string;
  }): Promise<OutsourceHire> {
    await this.requireTrip(input.tripId);
    requireAmount(input.agreedAmount);

    const carrierName = input.carrierName.trim();
    if (carrierName === '') throw new ValidationError('A hire needs the carrier it was agreed with.');

    return this.hires.create({
      tripId: input.tripId,
      carrierName,
      agreedAmount: input.agreedAmount,
      amountIncludesVat: input.amountIncludesVat ?? false,
      documentRef: blankToNull(input.documentRef),
      note: blankToNull(input.note),
      createdBy: input.createdBy,
    });
  }

  async listHires(
    tripId: string,
    includeVoided = false,
  ): Promise<{ items: OutsourceHire[]; total: string }> {
    await this.requireTrip(tripId);

    const items = includeVoided
      ? await this.hires.listByTrip(tripId)
      : await this.hires.listActiveByTrip(tripId);

    return { items, total: (await this.totals.forTrip(tripId)).hires };
  }

  async voidHire(
    tripId: string,
    hireId: string,
    input: { by: string; reason: string },
  ): Promise<OutsourceHire> {
    const reason = requireReason(input.reason);

    const current = await this.hires.findById(hireId);
    if (!current || current.tripId !== tripId) throw new NotFoundError('Hire not found.');
    if (current.voidedAt) throw new ConflictError('That hire has already been voided.');

    const voided = await this.hires.void(hireId, input.by, reason, new Date());
    if (!voided) throw new ConflictError('That hire has already been voided.');

    return voided;
  }

  // -------------------------------------------------------------- totals ----

  /**
   * What a trip has cost, in one answer.
   *
   * The three figures are added by PostgreSQL in a single statement. A caller
   * must never add `costs` and `hires` itself: they are decimal strings, and
   * `+` on them in JavaScript either concatenates or silently goes through a
   * float — which is the whole reason the columns are `NUMERIC`.
   */
  async summary(tripId: string): Promise<TripCostTotals> {
    await this.requireTrip(tripId);
    return this.totals.forTrip(tripId);
  }

  // ---------------------------------------------------------------------------

  /**
   * The trip has to exist. It does NOT have to be live.
   *
   * ★ ARCHIVED TRIPS STILL TAKE MONEY. Cost is a later workflow with a
   * different approver, so a figure routinely arrives after dispatch has closed
   * and archived the row. Refusing it would lose a real expense to a lifecycle
   * it has nothing to do with — which is also why nothing here reads `status`.
   */
  private async requireTrip(tripId: string): Promise<void> {
    if (!(await this.trips.exists(tripId))) throw new NotFoundError('Trip not found.');
  }
}

/**
 * Refuses an amount `NUMERIC(14,2)` cannot hold exactly, or one that is not
 * positive.
 *
 * The database says the same thing with a CHECK, and that one reaches a client
 * as a 500 — which is why the check is repeated here, where it can be a 422
 * naming the field. Note what it does NOT do: parse the value. A `Number()`
 * here would be the very rounding the column exists to avoid.
 */
const requireAmount = (value: string): void => {
  if (isRecordableAmount(value)) return;
  throw new ValidationError(
    'An amount must be greater than zero, with at most 2 decimal places and 12 digits before them.',
  );
};

/**
 * Refuses a heading the workbook does not have.
 *
 * The zod enum in the controller already catches an HTTP caller, and the
 * database says the same thing a third time with a CHECK — but that one reaches
 * a client as a 500, and the service is reachable from a script or another
 * module that never passes through zod. Reads the list from the domain rather
 * than repeating it, so a sixth heading cannot be added in one place and missed
 * in another.
 */
const requireCategory = (value: TripCostCategory): void => {
  if (TRIP_COST_CATEGORIES.includes(value)) return;
  throw new ValidationError(
    `A cost line needs one of: ${TRIP_COST_CATEGORIES.join(', ')}.`,
  );
};

/** A withdrawal with no reason is the record nobody can explain later. */
const requireReason = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === '') throw new ValidationError('Voiding a financial record needs a reason.');
  return trimmed;
};

/** A cell holding only a space is not a value. Same rule as the trip fields. */
const blankToNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};
