import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { toOffsetPage, type OffsetPage } from '../../../common/pagination/offset-page';
import type { DateRangePageQuery } from '../../../common/pagination/date-range-page-query.dto';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { optionalPoint } from '../domain/trip-location';
import type {
  TripAssignmentFilter,
  TripSchedule,
  TripScheduleWithRefs,
  TripStatus,
} from '../domain/trip-schedule';
import {
  canTransition,
  isCompletionOnlyStatus,
  type TripStatusChange,
} from '../domain/trip-status-history';
import {
  TripCustomerRepository,
  TripLocationRepository,
  TripVehicleRepository,
} from '../persistence/trip-catalogue.repository';
import {
  TripScheduleRepository,
  type TripScheduleValues,
} from '../persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../persistence/trip-status-history.repository';

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
  /**
   * ★ THE MASTER PLACE FOR EACH END. When present, the service COPIES that
   * place's address, contact and coordinates onto the trip inside the same
   * transaction — the row keeps its own snapshot, and editing the place
   * later never touches it. Must belong to `customerId`; anything else is
   * refused whatever the client sent.
   */
  pickupLocationId?: string | null;
  deliveryLocationId?: string | null;
  /**
   * ⚠ LEGACY, INTERNAL ONLY. No HTTP route accepts these any more — the DTO
   * has no field for them — so a dispatcher never types a coordinate. They
   * remain for callers inside the process (fixtures, scripts) that place a
   * trip without a master row, and they are REFUSED beside a location id for
   * the same end: the place is the authority, not the caller.
   */
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
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
 * Reading the board: the range, the page, and who is driving.
 *
 * ★ ONE MORE FIELD THAN `DateRangePageQuery`, AND IT IS NOT PAGINATION. The
 * range is what makes the offset envelope defensible (ADR-0003); `assignment`
 * is an ordinary filter on top of it, and it is spelled out here rather than
 * added to the shared DTO because the other list that DTO serves — the
 * operational board — has no business gaining a driver filter it never asked
 * for.
 */
export interface TripBoardQuery extends DateRangePageQuery {
  assignment: TripAssignmentFilter;
}

/** The fields a patch may CLEAR with `null` — everything but the day and the status. */
type NullableTripField = Exclude<keyof CreateTripInput, 'scheduledOn' | 'status'>;

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
    private readonly history: TripStatusHistoryRepository,
    private readonly locations: TripLocationRepository,
  ) {}

  /**
   * One page of the board.
   *
   * ★ THE RANGE IS ALREADY RESOLVED. `DateRangePageQuery` defaults it to the
   * current month and refuses a span over a year, so there is no unbounded read
   * to guard against here — which is the condition ADR-0003 attaches to using
   * offset pagination at all.
   *
   * ★ AND THE CREW FILTER IS APPLIED IN SQL, NOT AFTER. `assignment` narrows the
   * statement, so the page, the total and `totalPages` all describe the SAME
   * set. Handing back a page and letting the caller drop the crewed rows from it
   * would leave "20 of 137" printed over four rows — the exact lie ADR-0003 says
   * this envelope exists to avoid.
   */
  async list(query: TripBoardQuery): Promise<OffsetPage<TripScheduleWithRefs>> {
    const range = { from: query.from, to: query.to };
    const offset = (query.page - 1) * query.limit;

    const { items, total } = await this.trips.listPage(
      range,
      query.assignment,
      query.limit,
      offset,
    );

    // A page past the end comes back with no rows, and therefore with no
    // `COUNT(*) OVER()` to read. Counting separately in that case is what lets
    // a client holding a stale page number see the real `totalPages` and
    // recover, instead of being told the range is empty.
    const resolvedTotal =
      items.length === 0 && query.page > 1
        ? await this.trips.countInRange(range, query.assignment)
        : total;

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
      // one of them is checked against the catalogue — and both ends are
      // snapshotted from their places, when places were named.
      const values = await this.resolve(input, 'awaiting_production', tx, null, {
        pickup: true,
        delivery: true,
      });

      // ★ A TRIP CANNOT BE BORN CLOSED. `status` is an optional field of the
      // create body, so without this a single POST produces a trip that is
      // permanently done, with no completion request, no approver, no frozen
      // figures and — because 0017 makes `done` terminal — no way back.
      this.requireNotCompletionOnly(values.status);

      const created = await this.trips.create({ ...values, createdBy: input.createdBy }, tx);

      // ★ THE HISTORY STARTS AT THE FIRST ROW, NOT THE FIRST CHANGE. Without
      // this the earliest recorded transition would be `X -> Y` with nothing
      // saying where X came from, and "which status did this trip open on"
      // would be answerable only by assuming the default never moved.
      await this.history.record(
        { tripId: created.id, from: null, to: created.status, reason: null, changedBy: input.createdBy },
        tx,
      );

      return created;
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
  async update(id: string, patch: UpdateTripInput, changedBy: string): Promise<TripSchedule> {
    return this.db.transaction(async (tx) => {
      const current = await this.trips.lockActive(id, tx);
      if (!current) throw new NotFoundError('Trip not found.');

      // ★ `key in patch` RATHER THAN `patch.key !== undefined`, for the twelve
      // nullable fields. The two differ for a key sent explicitly as `null`,
      // which is exactly how a client CLEARS a field — collapsing them would
      // make "remove the delivery address" indistinguishable from "leave it
      // alone", so the address could never be removed. `sent` is that rule,
      // written once.
      //
      // The two non-nullable fields use `??`, because for them there is no
      // difference to preserve: `null` is not a value either column accepts.
      // The cast only tells the checker what `in` already guarantees: a key
      // that is present is typed as the patch has it, and an absent one comes
      // from the stored row.
      const sent = <K extends NullableTripField>(key: K): CreateTripInput[K] =>
        (key in patch ? patch[key] : current[key]) as CreateTripInput[K];

      const merged: CreateTripInput = {
        scheduledOn: patch.scheduledOn ?? current.scheduledOn,
        vehicleId: sent('vehicleId'),
        customerId: sent('customerId'),
        cargoInfo: sent('cargoInfo'),
        pickupAddress: sent('pickupAddress'),
        deliveryAddress: sent('deliveryAddress'),
        pickupContact: sent('pickupContact'),
        deliveryContact: sent('deliveryContact'),
        pickupAt: sent('pickupAt'),
        deliveryAt: sent('deliveryAt'),
        pickupLatitude: sent('pickupLatitude'),
        pickupLongitude: sent('pickupLongitude'),
        deliveryLatitude: sent('deliveryLatitude'),
        deliveryLongitude: sent('deliveryLongitude'),
        pickupLocationId: sent('pickupLocationId'),
        deliveryLocationId: sent('deliveryLocationId'),
        note: sent('note'),
        status: patch.status ?? current.status,
      };

      // ★ A SNAPSHOT IS RETAKEN ONLY WHEN THE PLACE IS NAMED IN THE PATCH.
      // Naming a place (or clearing it) means "copy that place now"; a patch
      // that touches only the note leaves last week's snapshot exactly as it
      // was, which is what makes a trip a record and the master a template.
      // ★ AND A CHANGE OF CUSTOMER RE-EXAMINES EVERY PLACE STILL NAMED. A place
      // belongs to one customer, so a trip moved from customer A to customer
      // B cannot keep A's warehouse on it — silently or otherwise. Each end
      // that still names a place is looked up afresh against the NEW customer
      // and refused if it is not theirs; the caller clears or replaces the
      // places in the same patch. An end with no place (typed by hand) is not
      // touched by the customer change.
      const customerChanged = merged.customerId !== current.customerId;
      const resnapshot = {
        pickup: 'pickupLocationId' in patch || (customerChanged && merged.pickupLocationId !== null),
        delivery:
          'deliveryLocationId' in patch || (customerChanged && merged.deliveryLocationId !== null),
      };
      // The row's stored pair is last time's snapshot, not something the
      // caller sent. When the place is named afresh it is copied from the
      // place — or cleared, when the place is cleared — never carried over.
      if (resnapshot.pickup) {
        merged.pickupLatitude = null;
        merged.pickupLongitude = null;
      }
      if (resnapshot.delivery) {
        merged.deliveryLatitude = null;
        merged.deliveryLongitude = null;
      }

      // ★ THE ROW'S EXISTING REFERENCES GO WITH IT. `resolve` checks a
      // reference against the catalogue only where it CHANGES, so retiring a
      // truck does not freeze every trip that ever used it — see the comment
      // on `resolve`.
      const values = await this.resolve(
        merged,
        current.status,
        tx,
        { vehicleId: current.vehicleId, customerId: current.customerId },
        resnapshot,
      );

      // ★ THE PATCH ROUTE CAN MOVE THE STATUS TOO, AND IT IS THE EASIER PATH
      // TO FORGET. `status` is a field of the create schema, so a general edit
      // carrying one is a board move wearing different clothes — and if only
      // the dedicated route recorded history, this one would be a silent way
      // around it.
      // `merged.status` is built as `patch.status ?? current.status` above, so
      // it is always set — the fallback restates that for the type rather than
      // asserting it away.
      const nextStatus = merged.status ?? current.status;
      if (nextStatus !== current.status) {
        this.requireDispatchTransition(current.status, nextStatus);
      }

      const updated = await this.trips.replace(id, values, tx);
      // The row was locked two statements ago, so this cannot be a concurrent
      // archive — it is a programming error, and pretending otherwise would
      // hide it behind a plausible 404.
      if (!updated) throw new Error('Locked trip disappeared during update.');

      if (updated.status !== current.status) {
        await this.recordMove(current, updated.status, null, changedBy, tx);
      }

      return updated;
    });
  }

  /**
   * Moves a row along the board.
   *
   * ★ A TRANSACTION NOW, WHERE IT USED TO BE ONE STATEMENT. The status and the
   * history entry have to be written together or not at all: a move that was
   * applied but not recorded is exactly the hole this method used to have, and
   * it is unrecoverable — nothing left behind says the move happened.
   *
   * ★ AND THE ROW IS LOCKED FIRST, so `from` in the history is the status the
   * move actually started from. Reading it outside the lock lets a concurrent
   * move slip in between, and the history then records a transition that never
   * occurred.
   */
  async updateStatus(
    id: string,
    status: TripStatus,
    changedBy: string,
    reason: string | null = null,
  ): Promise<TripSchedule> {
    return this.db.transaction(async (tx) => {
      const current = await this.trips.lockActive(id, tx);
      if (!current) throw new NotFoundError('Trip not found.');

      // Setting the status it already holds is not a move. Answering with the
      // row rather than an error keeps a retried request harmless, and writing
      // no history keeps the log free of entries where nothing changed — which
      // the `trip_status_history_actually_changed` CHECK would refuse anyway.
      if (current.status === status) return current;

      this.requireDispatchTransition(current.status, status);

      const updated = await this.trips.updateStatus(id, status, tx);
      if (!updated) throw new Error('Locked trip disappeared during status change.');

      await this.recordMove(current, status, reason, changedBy, tx);

      return updated;
    });
  }

  /** A trip's board history, newest first. */
  async statusHistory(id: string): Promise<TripStatusChange[]> {
    if (!(await this.trips.exists(id))) throw new NotFoundError('Trip not found.');
    return this.history.listByTrip(id);
  }

  /**
   * Refuses a move the DISPATCH BOARD is not allowed to make.
   *
   * Two rules, and they close the board off from `done` in both directions:
   *
   *   · nothing leaves `done` — 0017's trigger says the same thing, but that
   *     one surfaces as a 500, so it is said here where it can be a 409
   *   · ★ and nothing on the board ENTERS `done` either
   *
   * The second is the important one. Completing a trip freezes its money,
   * stamps who closed it and writes the history, all in one transaction —
   * `TripCompletionService.approve` is where that happens, and it reaches the
   * status column through the repository rather than through here. A status
   * route that could also write `done` would be a second way to close a trip
   * that skipped every one of those steps, and 0017 would then make the result
   * permanent.
   */
  private requireDispatchTransition(from: TripStatus, to: TripStatus): void {
    this.requireNotCompletionOnly(to);
    if (canTransition(from, to)) return;
    throw new ConflictError('A completed trip cannot be reopened.');
  }

  private requireNotCompletionOnly(status: TripStatus): void {
    if (!isCompletionOnlyStatus(status)) return;
    throw new ConflictError(
      'A trip is completed by approving its completion request, not by setting its status.',
    );
  }

  /**
   * Writes the history row for a board move.
   *
   * ★ NO `closed_at` BRANCH HERE, AND THAT IS THE POINT. This method can never
   * see a move to `done`, because `requireDispatchTransition` refuses one
   * before any write happens. Closing a trip — status, stamp and history
   * together — belongs to `TripCompletionService.approve` and nowhere else, so
   * a second implementation of it here would be a second answer waiting to
   * drift from the first.
   */
  private async recordMove(
    current: TripSchedule,
    to: TripStatus,
    reason: string | null,
    changedBy: string,
    tx: DatabaseQuery,
  ): Promise<void> {
    await this.history.record(
      { tripId: current.id, from: current.status, to, reason, changedBy },
      tx,
    );
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
    /** Which ends are copied afresh from their master place on this write. */
    resnapshot: { pickup: boolean; delivery: boolean },
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

    const pickup = await this.snapshotEnd(
      'pickup',
      {
        locationId: input.pickupLocationId ?? null,
        address: input.pickupAddress,
        contact: input.pickupContact,
        latitude: input.pickupLatitude,
        longitude: input.pickupLongitude,
      },
      customerId,
      resnapshot.pickup,
      tx,
    );
    const delivery = await this.snapshotEnd(
      'delivery',
      {
        locationId: input.deliveryLocationId ?? null,
        address: input.deliveryAddress,
        contact: input.deliveryContact,
        latitude: input.deliveryLatitude,
        longitude: input.deliveryLongitude,
      },
      customerId,
      resnapshot.delivery,
      tx,
    );

    return {
      scheduledOn: input.scheduledOn,
      vehicleId,
      customerId,
      cargoInfo: blankToNull(input.cargoInfo),
      pickupAddress: pickup.address,
      deliveryAddress: delivery.address,
      pickupContact: pickup.contact,
      deliveryContact: delivery.contact,
      pickupAt: input.pickupAt ?? null,
      deliveryAt: input.deliveryAt ?? null,
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      deliveryLatitude: delivery.latitude,
      deliveryLongitude: delivery.longitude,
      pickupLocationId: pickup.locationId,
      deliveryLocationId: delivery.locationId,
      note: blankToNull(input.note),
      status: input.status ?? fallbackStatus,
    };
  }

  /**
   * One end of the trip, as it will be stored.
   *
   * ★ THE PLACE IS THE AUTHORITY. When a location is named, its address,
   * contact and coordinates are COPIED here, inside the caller's transaction,
   * and any coordinates the caller sent for the same end are refused — a body
   * carrying place A's id and place B's numbers is a body contradicting
   * itself. The place must be this customer's and still in use.
   *
   * When no place is named, the end is what the caller typed (the path every
   * trip before 0022 took), and any coordinates come from the legacy input
   * only — never from a place. When `retake` is false, nothing is copied at
   * all: the merged row already carries last time's snapshot, and only a
   * patch that names the place asks for a fresh one.
   */
  private async snapshotEnd(
    end: 'pickup' | 'delivery',
    input: {
      locationId: string | null;
      address?: string | null;
      contact?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    },
    customerId: string | null,
    retake: boolean,
    tx: DatabaseQuery,
  ): Promise<EndSnapshot> {
    const typed = {
      address: blankToNull(input.address),
      contact: blankToNull(input.contact),
      ...coordinatePair(end, input.latitude, input.longitude),
    };

    if (!input.locationId) {
      return { ...typed, locationId: null };
    }

    if (!retake) {
      // Unchanged reference: the snapshot on the row — coordinates included —
      // stands, exactly as an unchanged vehicle is not re-checked against the
      // catalogue. Only a patch that names the place asks for a fresh copy.
      return { ...typed, locationId: input.locationId };
    }

    if (typed.latitude !== null || typed.longitude !== null) {
      throw new ValidationError(
        `The ${end} end names a location and also carries coordinates. The location is the source; send one or the other.`,
        { [`${end}LocationId`]: 'Conflicting coordinates.' },
      );
    }

    const location = await this.locations.findById(input.locationId, tx);
    if (!location) throw new NotFoundError(`${capitalise(end)} location not found.`);
    if (customerId === null || location.customerId !== customerId) {
      throw new ValidationError(
        `The ${end} location does not belong to this trip's customer. Clear or replace it when changing the customer.`,
        { [`${end}LocationId`]: 'Not one of this customer’s places.' },
      );
    }
    if (location.status !== 'active') {
      throw new ConflictError(`The ${end} location has been archived.`);
    }

    return {
      locationId: location.id,
      address: location.address,
      contact: location.contact,
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }
}

/** One end of a trip as it will be stored: the snapshot, and where it came from. */
interface EndSnapshot {
  locationId: string | null;
  address: string | null;
  contact: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * A point, or no point. Never half of one.
 *
 * ★ REFUSED HERE AND AGAIN BY 0019's CHECK. A latitude with no longitude is not
 * a location that is partly known; it is a value a geofence check would have to
 * invent the other half of. The range is checked too, so a caller gets a
 * sentence rather than a constraint name.
 */
const coordinatePair = (
  end: 'pickup' | 'delivery',
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number | null; longitude: number | null } => {
  const point = optionalPoint(latitude, longitude);
  if (!point.ok) {
    throw new ValidationError(
      point.reason === 'HALF_A_POINT'
        ? `The ${end} location needs both a latitude and a longitude, or neither.`
        : `The ${end} location is not a place on Earth.`,
      { [`${end}Latitude`]: point.reason },
    );
  }
  return { latitude: point.latitude, longitude: point.longitude };
};

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
