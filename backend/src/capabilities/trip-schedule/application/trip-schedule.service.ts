import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { toOffsetPage, type OffsetPage } from '../../../common/pagination/offset-page';
import type { DateRangePageQuery } from '../../../common/pagination/date-range-page-query.dto';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripSchedule, TripScheduleWithRefs, TripStatus } from '../domain/trip-schedule';
import {
  TripCustomerRepository,
  TripVehicleRepository,
} from '../persistence/trip-catalogue.repository';
import {
  TripScheduleRepository,
  type TripScheduleValues,
} from '../persistence/trip-schedule.repository';

/**
 * What a caller may say when creating a trip. Everything but the day is
 * optional, because the workbook rows show that a trip is entered before it is
 * fully known — a customer with no truck yet, a truck with no addresses yet.
 */
export interface CreateTripInput {
  scheduledOn: string;
  vehicleId?: string | null;
  customerId?: string | null;
  cargoInfo?: string | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  pickupContact?: string | null;
  deliveryContact?: string | null;
  pickupAt?: Date | null;
  deliveryAt?: Date | null;
  note?: string | null;
  status?: TripStatus;
}

/**
 * A patch. A key that is ABSENT is untouched; a key present as `null` clears
 * the column. The DTO in the controller is what makes that distinction
 * survive — see the comment there.
 *
 * `scheduledOn` and `status` are optional but never nullable: a trip with no
 * day is not on the board at all, and a trip with no status has no colour. The
 * columns are NOT NULL, and the type says so rather than leaving the service to
 * discover it from a constraint violation.
 */
export type UpdateTripInput = Partial<CreateTripInput> & {
  scheduledOn?: string;
  status?: TripStatus;
};

/**
 * Trims a text field, and treats a field that is only whitespace as empty.
 *
 * The workbook is full of cells that hold a space or a newline, because a
 * dispatcher tabbed through them. Those arrive as `" "` and would be stored as
 * a value that renders as nothing, sorts as something, and is not `null` — so
 * "has this been filled in" stops having an answer. One place to normalise it.
 */
const blankToNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * The dispatch board: the shared record that used to be a spreadsheet.
 *
 * WHAT THIS OWNS: that a trip points at catalogue rows which exist and are
 * still in service, that text arrives normalised, and that nothing is ever
 * deleted. It owns no authorization — `PermissionGuard` decided that before any
 * method here ran, and re-deciding it in a second place is how two answers
 * start to disagree.
 */
@Injectable()
export class TripScheduleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly vehicles: TripVehicleRepository,
    private readonly customers: TripCustomerRepository,
  ) {}

  /**
   * One page of the board.
   *
   * ★ THE RANGE IS ALREADY RESOLVED. `DateRangePageQuery` defaults it to the
   * current month and refuses a span over a year, so there is no unbounded read
   * to guard against here — which is the condition ADR-0003 attaches to using
   * offset pagination at all.
   */
  async list(query: DateRangePageQuery): Promise<OffsetPage<TripScheduleWithRefs>> {
    const range = { from: query.from, to: query.to };
    const offset = (query.page - 1) * query.limit;

    const { items, total } = await this.trips.listPage(range, query.limit, offset);

    // A page past the end comes back with no rows, and therefore with no
    // `COUNT(*) OVER()` to read. Counting separately in that case is what lets
    // a client holding a stale page number see the real `totalPages` and
    // recover, instead of being told the range is empty.
    const resolvedTotal =
      items.length === 0 && query.page > 1 ? await this.trips.countInRange(range) : total;

    return toOffsetPage(items, resolvedTotal, query.page, query.limit);
  }

  async findById(id: string): Promise<TripScheduleWithRefs> {
    const trip = await this.trips.findById(id);
    if (!trip) throw new NotFoundError('Trip not found.');
    return trip;
  }

  /**
   * Adds a row to the board.
   *
   * Anybody with a finished account may do this — dispatch is a shared record
   * and a trip that cannot be entered until an administrator is available is a
   * trip that gets entered in a WhatsApp message instead. `createdBy` comes
   * from the session, never from the body, so the row always says who wrote it.
   */
  async create(input: CreateTripInput & { createdBy: string }): Promise<TripSchedule> {
    return this.db.transaction(async (tx) => {
      // No previous row, so every reference here is newly assigned and every
      // one of them is checked against the catalogue.
      const values = await this.resolve(input, 'awaiting_production', tx, null);
      return this.trips.create({ ...values, createdBy: input.createdBy }, tx);
    });
  }

  /**
   * Corrects a row.
   *
   * Read-modify-write under `FOR UPDATE` rather than a computed `SET` list: the
   * patch has to be merged with the stored row SOMEWHERE, and doing it here —
   * in one readable place, inside the lock — beats assembling an UPDATE
   * statement out of whichever keys a caller happened to send.
   */
  async update(id: string, patch: UpdateTripInput): Promise<TripSchedule> {
    return this.db.transaction(async (tx) => {
      const current = await this.trips.lockActive(id, tx);
      if (!current) throw new NotFoundError('Trip not found.');

      // ★ `key in patch` RATHER THAN `patch.key !== undefined`, for the eight
      // nullable fields. The two differ for a key sent explicitly as `null`,
      // which is exactly how a client CLEARS a field — collapsing them would
      // make "remove the delivery address" indistinguishable from "leave it
      // alone", so the address could never be removed.
      //
      // The two non-nullable fields use `??`, because for them there is no
      // difference to preserve: `null` is not a value either column accepts.
      const merged: CreateTripInput = {
        scheduledOn: patch.scheduledOn ?? current.scheduledOn,
        vehicleId: 'vehicleId' in patch ? patch.vehicleId : current.vehicleId,
        customerId: 'customerId' in patch ? patch.customerId : current.customerId,
        cargoInfo: 'cargoInfo' in patch ? patch.cargoInfo : current.cargoInfo,
        pickupAddress: 'pickupAddress' in patch ? patch.pickupAddress : current.pickupAddress,
        deliveryAddress: 'deliveryAddress' in patch ? patch.deliveryAddress : current.deliveryAddress,
        pickupContact: 'pickupContact' in patch ? patch.pickupContact : current.pickupContact,
        deliveryContact: 'deliveryContact' in patch ? patch.deliveryContact : current.deliveryContact,
        pickupAt: 'pickupAt' in patch ? patch.pickupAt : current.pickupAt,
        deliveryAt: 'deliveryAt' in patch ? patch.deliveryAt : current.deliveryAt,
        note: 'note' in patch ? patch.note : current.note,
        status: patch.status ?? current.status,
      };

      // ★ THE ROW'S EXISTING REFERENCES GO WITH IT. `resolve` checks a
      // reference against the catalogue only where it CHANGES, so retiring a
      // truck does not freeze every trip that ever used it — see the comment
      // on `resolve`.
      const values = await this.resolve(merged, current.status, tx, {
        vehicleId: current.vehicleId,
        customerId: current.customerId,
      });

      const updated = await this.trips.replace(id, values, tx);
      // The row was locked two statements ago, so this cannot be a concurrent
      // archive — it is a programming error, and pretending otherwise would
      // hide it behind a plausible 404.
      if (!updated) throw new Error('Locked trip disappeared during update.');

      return updated;
    });
  }

  /** Moves a row along the board and touches nothing else. */
  async updateStatus(id: string, status: TripStatus): Promise<TripSchedule> {
    const updated = await this.trips.updateStatus(id, status);
    if (!updated) throw new NotFoundError('Trip not found.');
    return updated;
  }

  /**
   * Takes a row off the board.
   *
   * Not a delete: B13 forbids the runtime issuing one, and a day's dispatch
   * record is exactly the kind of history that gets asked about months later.
   * The row keeps its author, gains an archiver, and stops appearing in lists.
   */
  async archive(id: string, archivedBy: string): Promise<TripSchedule> {
    const archived = await this.trips.archive(id, archivedBy, new Date());
    // Already archived and never existed answer the same way, on purpose: from
    // outside, both mean "there is no such row on the board".
    if (!archived) throw new NotFoundError('Trip not found.');
    return archived;
  }

  /**
   * Turns a caller's input into the exact row to store.
   *
   * ★ THE CATALOGUE CHECK IS THE POINT OF THIS METHOD. A foreign key already
   * refuses an id that names nothing, but it says nothing about an id that
   * names an ARCHIVED truck — and putting a retired truck on tomorrow's board
   * is a mistake the database is happy to store. The check runs inside the
   * caller's transaction so a truck cannot be retired between the check and the
   * insert.
   *
   * ★ AND IT CHECKS ONLY WHAT IS BEING ASSIGNED. `previous` is the pair of
   * references the row already held — `null` on create, where everything is new.
   * A reference that is UNCHANGED is not re-checked, because it was already
   * accepted once and the row is a record of what happened, not a claim about
   * what is still available. Without that, archiving a truck made every trip
   * that ever used it uneditable: the merged row still names it, so correcting
   * an unrelated note answered 409 and the history could never be corrected
   * again. Retiring a truck is routine, so that was every historical row.
   *
   * ⚠ WHAT IT DOES NOT RELAX. Assigning a DIFFERENT archived row is still
   * refused, on create and on update alike — that is F-002, and it is the case
   * this check exists for. Clearing a reference stays legal and always was: the
   * `if (id)` guards below skip `null`, so "no truck yet" needs no catalogue at
   * all.
   */
  private async resolve(
    input: CreateTripInput,
    fallbackStatus: TripStatus,
    tx: DatabaseQuery,
    previous: { vehicleId: string | null; customerId: string | null } | null,
  ): Promise<TripScheduleValues> {
    const vehicleId = input.vehicleId ?? null;
    // `previous` is null on create, so `previous?.vehicleId` is `undefined` and
    // any id differs from it — every reference is checked, as it must be.
    if (vehicleId && vehicleId !== previous?.vehicleId) {
      const vehicle = await this.vehicles.findById(vehicleId, tx);
      if (!vehicle) throw new NotFoundError('Vehicle not found.');
      if (vehicle.status !== 'active') {
        throw new ConflictError('That vehicle has been retired from the catalogue.');
      }
    }

    const customerId = input.customerId ?? null;
    if (customerId && customerId !== previous?.customerId) {
      const customer = await this.customers.findById(customerId, tx);
      if (!customer) throw new NotFoundError('Customer not found.');
      if (customer.status !== 'active') {
        throw new ConflictError('That customer has been retired from the catalogue.');
      }
    }

    return {
      scheduledOn: input.scheduledOn,
      vehicleId,
      customerId,
      cargoInfo: blankToNull(input.cargoInfo),
      pickupAddress: blankToNull(input.pickupAddress),
      deliveryAddress: blankToNull(input.deliveryAddress),
      pickupContact: blankToNull(input.pickupContact),
      deliveryContact: blankToNull(input.deliveryContact),
      pickupAt: input.pickupAt ?? null,
      deliveryAt: input.deliveryAt ?? null,
      note: blankToNull(input.note),
      status: input.status ?? fallbackStatus,
    };
  }
}
