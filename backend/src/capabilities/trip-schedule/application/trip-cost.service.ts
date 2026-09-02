import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
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
import type { TripCostEdit, VehicleOwnership } from '../domain/trip-execution';
import { TripVehicleRepository } from '../persistence/trip-catalogue.repository';
import { DriverAssignmentRepository } from '../persistence/trip-execution.repository';
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
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly costs: TripCostRepository,
    private readonly hires: OutsourceHireRepository,
    private readonly totals: TripCostTotalsRepository,
    private readonly assignments: DriverAssignmentRepository,
    private readonly vehicles: TripVehicleRepository,
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
    if (current?.tripId !== tripId) throw new NotFoundError('Cost line not found.');
    if (current.voidedAt) throw new ConflictError('That cost line has already been voided.');

    const voided = await this.costs.void(costId, input.by, reason, new Date());
    // The row existed and was live one statement ago, so an empty result here
    // is a concurrent void rather than a missing row — and the answer is the
    // same one the check above would have given.
    if (!voided) throw new ConflictError('That cost line has already been voided.');

    return voided;
  }

  // -------------------------------------------------- declared by a driver ----

  /**
   * A driver declares what they just spent.
   *
   * ★ NOT `createCost` WITH EXTRA ARGUMENTS. The two write different rows on
   * purpose: the backoffice one is final on arrival, this one is EDITABLE until
   * the trip is submitted, and it carries the assignment and the two snapshots
   * that make it auditable a year later. See `declare` in the repository.
   *
   * ★ THE RETRY IS ANSWERED, NOT REFUSED. A phone on a bad connection sends the
   * same declaration three times; the second and third find it already written
   * and get the original back. Only the pair that arrive simultaneously reach
   * `uq_trip_cost_client_request`, and one of them loses there.
   */
  async declareCost(input: {
    tripId: string;
    category: TripCostCategory;
    amount: string;
    note?: string | null;
    clientRequestId?: string | null;
    declaredBy: string;
  }): Promise<TripCost> {
    requireCategory(input.category);
    requireAmount(input.amount);

    const clientRequestId = blankToNull(input.clientRequestId);
    if (clientRequestId) {
      const already = await this.costs.findByClientRequestId(input.tripId, clientRequestId);
      if (already) return already;
    }

    return this.db.transaction(async (tx) => {
      const trip = await this.trips.lockActive(input.tripId, tx);
      if (!trip) throw new NotFoundError('Trip not found.');
      if (trip.status === 'done') throw new ConflictError('That trip is closed.');

      // ★ NO VEHICLE, NO EXPENSE — contract §4.1a, the operational ordering.
      // A figure declared before a lorry is assigned has nothing to attribute
      // itself to: the snapshot would be empty and the outsourced-category rule
      // below would have nothing to read.
      if (!trip.vehicleId) {
        throw new ConflictError('That trip has no vehicle yet, so there is nothing to spend on.');
      }

      const assignment = await this.assignments.lockActive(input.tripId, tx);
      if (!assignment) throw new ConflictError('That trip has no driver.');

      // A rule about DATA rather than about a role, so no permission tier can
      // express it: the guard knows who somebody IS, not which trip they are on.
      if (assignment.driverUserId !== input.declaredBy) {
        throw new ForbiddenError('Only the driver assigned to a trip may declare its expenses.');
      }

      const vehicleOwnership = await this.ownershipOf(trip.vehicleId, tx);

      // ★ SAID HERE AS WELL AS IN THE DATABASE, AND FOR A DIFFERENT AUDIENCE.
      // `trip_costs_outsourced_category` refuses the same row, but a CHECK
      // violation reaches a client as a 500. A hired lorry's fuel and tolls are
      // inside the one price agreed with its carrier, so claiming them again
      // here is the same money counted twice.
      if (vehicleOwnership === 'outsourced' && (input.category === 'fuel' || input.category === 'toll')) {
        throw new ValidationError(
          'Fuel and tolls are already inside the price agreed with the carrier for a hired lorry.',
        );
      }

      return this.costs.declare(
        {
          tripId: input.tripId,
          driverAssignmentId: assignment.id,
          category: input.category,
          amount: input.amount,
          note: blankToNull(input.note),
          vehicleId: trip.vehicleId,
          vehicleOwnership,
          clientRequestId,
          createdBy: input.declaredBy,
        },
        tx,
      );
    });
  }

  /**
   * Corrects a figure that has not been locked yet.
   *
   * ★ THIS IS THE METHOD 0012 SAID WOULD NEVER EXIST, AND THE REASON IT DOES.
   * That rule was written for a clerk entering an invoice, where a correction is
   * a void and a replacement. A driver mistyping a digit at a fuel station would
   * produce two rows and a void reason reading "typo" — noise that buries the
   * corrections that matter. So a DECLARED line is editable until it is
   * submitted, and every change is logged field by field.
   *
   * ★ AND THE EDIT LOG IS WRITTEN IN THE SAME TRANSACTION. A change recorded
   * without its log is a figure that moved and cannot be explained, which is
   * worse than not allowing the edit at all.
   */
  async editCost(
    tripId: string,
    costId: string,
    patch: { category?: TripCostCategory; amount?: string; note?: string | null },
    editedBy: string,
  ): Promise<TripCost> {
    if (patch.category !== undefined) requireCategory(patch.category);
    if (patch.amount !== undefined) requireAmount(patch.amount);

    return this.db.transaction(async (tx) => {
      const current = await this.costs.lockById(costId, tx);
      // Belonging to the trip in the route is checked, not assumed: a caller
      // holding one trip's id must not reach another trip's line by pairing it
      // with a foreign cost id.
      if (current?.tripId !== tripId) throw new NotFoundError('Cost line not found.');
      if (current.voidedAt) throw new ConflictError('That cost line has been voided.');

      if (current.source !== 'driver_portal') {
        throw new ConflictError('A backoffice cost line is corrected by voiding it, not by editing.');
      }
      if (current.state !== 'editable') {
        throw new ConflictError(
          current.state === 'locked'
            ? 'That trip has been submitted for completion, so its figures are frozen.'
            : 'That trip is closed and its figures are final.',
        );
      }
      if (current.createdBy !== editedBy) {
        throw new ForbiddenError('A driver may only correct the figures they declared.');
      }

      const values = {
        category: patch.category ?? current.category,
        amount: patch.amount ?? current.amount,
        note: 'note' in patch ? blankToNull(patch.note) : current.note,
      };

      const edits = ([
        { field: 'category' as const, from: current.category, to: values.category },
        { field: 'amount' as const, from: current.amount, to: values.amount },
        { field: 'note' as const, from: current.note, to: values.note },
      ]).filter((edit) => edit.from !== edit.to);

      // Nothing to do, and nothing to log. Answering with the row keeps a
      // repeated save harmless rather than filling the log with entries in
      // which nothing changed.
      if (edits.length === 0) return current;

      const updated = await this.costs.editEditable(costId, values, tx);
      // The row was locked two statements ago, so an empty result means a
      // concurrent submit froze it — which is a conflict, not a missing row.
      if (!updated) {
        throw new ConflictError('That trip was submitted for completion while you were editing.');
      }

      await this.costs.recordEdits(costId, edits, editedBy, tx);

      return updated;
    });
  }

  /** What was changed on one line, newest first. */
  async listCostEdits(tripId: string, costId: string): Promise<TripCostEdit[]> {
    const current = await this.costs.findById(costId);
    if (current?.tripId !== tripId) throw new NotFoundError('Cost line not found.');
    return this.costs.listEdits(costId);
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
    if (current?.tripId !== tripId) throw new NotFoundError('Hire not found.');
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

  /**
   * The lorry's ownership at the moment of writing.
   *
   * ★ `null` IS RETURNED AS `null`. 0013 leaves every existing lorry
   * unclassified on purpose, and reading that absence as `company` would let a
   * hired lorry's fuel through the rule above by assuming a fact nobody stated.
   * An unclassified lorry simply carries no snapshot, and the check does not
   * fire — which is the honest behaviour, and visible in the data as a null.
   */
  private async ownershipOf(
    vehicleId: string,
    tx: DatabaseQuery,
  ): Promise<VehicleOwnership | null> {
    const vehicle = await this.vehicles.findById(vehicleId, tx);
    return vehicle?.ownership ?? null;
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
