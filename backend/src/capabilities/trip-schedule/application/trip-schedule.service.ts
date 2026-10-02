import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { toOffsetPage, type OffsetPage } from '../../../common/pagination/offset-page';
import type { DateRangePageQuery } from '../../../common/pagination/date-range-page-query.dto';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripBoardOrder } from '../domain/trip-board';
import { optionalPoint } from '../domain/trip-location';
import {
  isRetiredStatus,
  type TripAssignmentFilter,
  type TripLifecycle,
  type TripSchedule,
  type TripScheduleWithRefs,
  type TripStatus,
} from '../domain/trip-schedule';
import {
  boardDayFor,
  calendarRefusal,
  deliversBeforePickup,
  instantMoved,
  type CalendarRefusal,
  type TripEntryMode,
} from '../domain/trip-timeline';
import {
  canTransition,
  initialLifecycle,
  isCompletionOnlyStatus,
  type InitialLifecycle,
  type TripStatusChange,
} from '../domain/trip-status-history';
import { TripEntryCrew, type CrewPair } from './trip-entry-crew';
import {
  TripCustomerRepository,
  TripLocationRepository,
} from '../persistence/trip-catalogue.repository';
import {
  TripScheduleRepository,
  type TripScheduleValues,
} from '../persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../persistence/trip-status-history.repository';

/**
 * What a caller may say when creating a trip. Everything is optional but a
 * DAY — a pickup instant, or the bare day when no hour is known yet — because
 * the workbook rows show that a trip is entered before it is fully known.
 *
 * ★ NO LORRY AND NO DRIVER HERE (ADR-0004). A trip is booked first; lorries and
 * their drivers are dispatched onto it afterwards, as assignments, through
 * `TripExecutionService`. There is no `vehicleId` on this input and nothing
 * writes `trip_schedules.vehicle_id` any more.
 */
export interface CreateTripInput {
  /**
   * The planned pickup date — "Ngày lấy hàng". Required unless `pickupAt` is
   * sent, whose business day it then is; the two may not disagree (see
   * `boardDayFor`). A trip booked before anybody knows the hour sends this alone.
   */
  scheduledOn?: string;
  /**
   * Why the trip is being entered (`TripEntryMode`) — the create INTENT, never
   * a status: `operational` books it, `historical` records a run that already
   * ended. The server decides the lifecycle from it (`initialLifecycle`).
   * Absent for in-process callers (fixtures, scripts): a booking, with no
   * calendar policy; the timeline rule binds them all the same.
   */
  entryMode?: TripEntryMode;
  /**
   * The lorries and drivers a RECORDED run went out with — historical intent
   * only: a closed trip takes no dispatch afterwards. A booking is crewed
   * through the dispatch routes once it exists (`TripEntryCrew`).
   */
  crew?: CrewPair[];
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
  /**
   * What the customer is charged and what the carrier is paid, as decimal
   * strings — `"4500000"` or `"4500000.00"`.
   *
   * ★ NEVER A NUMBER, AND NOT ROUNDED HERE. The columns are `NUMERIC(14,2)`;
   * the DTO refuses anything they cannot hold EXACTLY, including a third
   * decimal place, because PostgreSQL would round that rather than refuse it
   * and the caller would be told a figure was stored when a different one was.
   * Nothing in this service parses either of them.
   *
   * `null` clears the figure — a trip that turns out not to be chargeable is
   * unpriced, which is a state the column has, and most trips are never bought
   * from anybody at all. A zero is refused by 0026's CHECKs and by the DTO
   * before them.
   *
   * ⚠ WHO MAY SET THESE IS NOT DECIDED HERE. The controller refuses a body
   * carrying either key from a caller without `trip.price.read`, so this
   * service sees them only from somebody entitled to send them. It is not a
   * second gate and must not become one — a service that re-decides
   * authorization is a second place for the rule to drift.
   */
  sellPrice?: string | null;
  purchasePrice?: string | null;
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
 * discover it from a constraint violation. No `entryMode`: correcting a trip is
 * not entering one.
 */
export type UpdateTripInput = Omit<Partial<CreateTripInput>, 'entryMode' | 'crew'> & {
  scheduledOn?: string;
  status?: TripStatus;
};

/**
 * Reading the board: the range, the page, who is driving, and in what order.
 *
 * ★ MORE THAN `DateRangePageQuery`, AND NONE OF IT IS PAGINATION. The range is
 * what makes the offset envelope defensible (ADR-0003); `assignment` is an
 * ordinary filter on top of it and `sort`/`direction` only reorder the same
 * set. They are spelled out here rather than added to the shared DTO because
 * the other list that DTO serves — the operational board — has no business
 * gaining a driver filter or a sort it never asked for.
 */
export interface TripBoardQuery extends DateRangePageQuery, TripBoardOrder {
  assignment: TripAssignmentFilter;
  /** Lịch xe or Lịch sử chuyến — the same trips, split at `finished`. */
  lifecycle: TripLifecycle;
}

/** The fields a patch may CLEAR with `null` — everything but the day, the status and the intent. */
type NullableTripField = Exclude<keyof CreateTripInput, 'scheduledOn' | 'status' | 'entryMode' | 'crew'>;

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
    private readonly customers: TripCustomerRepository,
    private readonly history: TripStatusHistoryRepository,
    private readonly locations: TripLocationRepository,
    private readonly crew: TripEntryCrew,
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
    const filter = { assignment: query.assignment, lifecycle: query.lifecycle };
    const offset = (query.page - 1) * query.limit;

    const { items, total } = await this.trips.listPage(
      range,
      filter,
      { sort: query.sort, direction: query.direction },
      query.limit,
      offset,
    );

    // A page past the end comes back with no rows, and therefore with no
    // `COUNT(*) OVER()` to read. Counting separately in that case is what lets
    // a client holding a stale page number see the real `totalPages` and
    // recover, instead of being told the range is empty.
    const resolvedTotal =
      items.length === 0 && query.page > 1 ? await this.trips.countInRange(range, filter) : total;

    return toOffsetPage(items, resolvedTotal, query.page, query.limit);
  }

  async findById(id: string): Promise<TripScheduleWithRefs> {
    const trip = await this.trips.findById(id);
    if (!trip) throw new NotFoundError('Trip not found.');
    return trip;
  }

  /**
   * Adds a trip — a booking, or a run recorded after it ended (`entryMode`).
   *
   * ★ ONE PIPELINE FOR BOTH. The same catalogue, snapshot, timeline and day
   * rules (`prepareEntry`), the same transaction, the same first history row.
   * The intent decides only how the trip STARTS (`initialLifecycle`): the
   * caller says why it enters a trip, and never that the trip is closed.
   *
   * Anybody holding `trip.create` may do this — dispatch is a shared record,
   * and a trip that cannot be entered until an administrator is available is a
   * trip that gets entered in a WhatsApp message instead. `createdBy` comes
   * from the session, never from the body, so the row always says who wrote it.
   */
  async create(input: CreateTripInput & { createdBy: string }): Promise<TripSchedule> {
    // Pure, so a request that cannot start a trip is refused before any read.
    const start = startOf(input);

    return this.db.transaction(async (tx) => {
      const values = await this.prepareEntry(input, tx);
      const now = new Date();
      const row = { ...values, status: start.status, createdBy: input.createdBy };

      // ★ BORN CLOSED ONLY BY THE HISTORICAL INTENT: row, `finished` and the
      // closing stamp (who recorded it, when) in one statement. Every other
      // trip is born open and reaches `finished` only through approval.
      const created = start.closed
        ? await this.trips.createFinished(row, now, tx)
        : await this.trips.create(row, tx);

      // ★ THE HISTORY STARTS AT THE FIRST ROW, NOT THE FIRST CHANGE. Without
      // this the earliest recorded transition would be `X -> Y` with nothing
      // saying where X came from. A recorded run has this row and no other —
      // `null → finished`, marked — because it never moved along the board.
      await this.history.record(
        { tripId: created.id, from: null, to: created.status, reason: start.reason, changedBy: input.createdBy },
        tx,
      );

      if (start.closed) {
        await this.crew.recordEnded(
          created.id,
          input.crew ?? [],
          { by: input.createdBy, reason: start.reason, now },
          tx,
        );
      }
      return created;
    });
  }

  /**
   * A NEW trip's row, resolved and checked — every rule that does not depend
   * on how the trip starts: catalogue, snapshot, timeline, the one-day rule.
   *
   * ★ AND THE CALENDAR POLICY OF THE INTENT (`calendarRefusal`). A booking is
   * for work still to run, so a past day is refused and sent to "Nhập chuyến
   * cũ"; a recorded run has ended, so neither its day nor any hour it gives may
   * lie ahead. Create only: an overdue trip stays correctable, and nothing
   * re-books it on an edit.
   */
  private async prepareEntry(input: CreateTripInput, tx: DatabaseQuery): Promise<TripScheduleValues> {
    // No previous row, so every reference here is newly assigned and checked
    // against the catalogue — and both ends are snapshotted from their places.
    const values = await this.resolve(input, 'pending', tx, null, { pickup: true, delivery: true });

    const refused = calendarRefusal(input.entryMode, values, new Date());
    if (refused) {
      throw new ValidationError(CALENDAR_REFUSALS[refused.reason], { [refused.field]: refused.reason });
    }
    return values;
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
        // As SENT, not merged: `boardDayFor` needs to know whether the patch
        // named a day, and falls back to the stored one itself.
        scheduledOn: patch.scheduledOn,
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
        sellPrice: sent('sellPrice'),
        purchasePrice: sent('purchasePrice'),
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

      // ★ THE STORED ROW GOES WITH IT. `resolve` checks a reference, and the
      // timeline, only where this write CHANGES them, so retiring a customer
      // does not freeze every trip that ever named them — see `resolve`.
      const values = await this.resolve(merged, current.status, tx, current, resnapshot);

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
        await this.requireDispatchTransition(current, nextStatus, tx);
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

      await this.requireDispatchTransition(current, status, tx);

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
   * Four rules:
   *
   *   · nothing leaves `finished` — 0025's trigger says the same thing, but that
   *     one surfaces as a 500, so it is said here where it can be a 409
   *   · ★ nothing ENTERS `finished` through a plain move either
   *   · nothing moves to the retired `confirmed` (`isRetiredStatus`)
   *   · ★ nothing goes BACK to `pending` once a driver has reported
   *
   * The second is the important one. Closing a trip writes the status, who
   * closed it and the history together — `closeTrip`, reached by approval and
   * by the SuperAdmin's "Đã xác nhận" (`TripCompletionService.completeManually`,
   * which the status route calls for `finished`). A plain move that could also
   * write `finished` would be a way to close a trip that skipped the stamp and
   * the lock, and 0017 would then make the result permanent.
   *
   * ★ THE FOURTH KEEPS THE STATUS FROM CONTRADICTING THE RECORD. `pending` says
   * nothing has happened on the road; two things say otherwise, and neither
   * implies the other:
   *
   *   · a live milestone — a voided one does not count, so a trip whose only
   *     report was withdrawn may go back again
   *   · a completion request still standing (`pending` or `approved`) — one
   *     can be submitted with no milestone at all, and survives every
   *     milestone being withdrawn after it; a REJECTED one does not count
   *
   * Before either, sending a trip back stays a mis-click's way out. Both are
   * read under the caller's lock on the trip row, which a milestone and a
   * completion request both take before they write.
   */
  private async requireDispatchTransition(
    current: TripSchedule,
    to: TripStatus,
    tx: DatabaseQuery,
  ): Promise<void> {
    this.requireNotCompletionOnly(to);
    if (!canTransition(current.status, to)) throw new ConflictError('A completed trip cannot be reopened.');
    if (isRetiredStatus(to)) throw retiredStatus();
    if (to !== 'pending') return;
    if (await this.trips.hasLiveExecution(current.id, tx)) {
      throw new ConflictError(
        'A driver has already reported on this trip, so it cannot go back to pending.',
      );
    }
    if (await this.trips.hasOpenCompletion(current.id, tx)) {
      throw new ConflictError(
        'A driver has asked for this trip to be closed, so it cannot go back to pending.',
      );
    }
  }

  private requireNotCompletionOnly(status: TripStatus): void {
    if (!isCompletionOnlyStatus(status)) return;
    throw new ConflictError(COMPLETION_ONLY);
  }

  /**
   * Writes the history row for a board move.
   *
   * ★ NO `closed_at` BRANCH HERE, AND THAT IS THE POINT. This method can never
   * see a move to `finished`, because `requireDispatchTransition` refuses one
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
   * names an ARCHIVED customer — and putting a retired customer on tomorrow's
   * board is a mistake the database is happy to store. The check runs inside
   * the caller's transaction so a customer cannot be retired between the check
   * and the insert. (The lorry is no longer a column of this row — it is
   * dispatched as an assignment, and `TripExecutionService` checks it there.)
   *
   * ★ AND IT CHECKS ONLY WHAT IS BEING ASSIGNED. `previous` is the reference
   * the row already held — `null` on create, where everything is new. A
   * reference that is UNCHANGED is not re-checked, because it was already
   * accepted once and the row is a record of what happened, not a claim about
   * what is still available. Without that, archiving a catalogue row made
   * every trip that ever used it uneditable: the merged row still names it, so
   * correcting an unrelated note answered 409 and the history could never be
   * corrected again.
   *
   * ⚠ WHAT IT DOES NOT RELAX. Assigning a DIFFERENT archived row is still
   * refused, on create and on update alike — that is F-002, and it is the case
   * this check exists for. Clearing a reference stays legal and always was: the
   * `if (id)` guard below skips `null`.
   *
   * ★ THE TIMELINE FOLLOWS THE SAME RULE. Delivery must come after pickup, on
   * create and update alike — but only a write that MOVES either instant is
   * held to it. A row typed backwards before the rule existed stays editable
   * (an accountant pricing it must not be refused over a time they cannot
   * change); correcting either time is what has to make it right.
   */
  private async resolve(
    input: CreateTripInput,
    fallbackStatus: TripStatus,
    tx: DatabaseQuery,
    previous: TripSchedule | null,
    /** Which ends are copied afresh from their master place on this write. */
    resnapshot: { pickup: boolean; delivery: boolean },
  ): Promise<TripScheduleValues> {
    const pickupAt = input.pickupAt ?? null;
    const deliveryAt = input.deliveryAt ?? null;
    const timesMoved =
      instantMoved(pickupAt, previous?.pickupAt) || instantMoved(deliveryAt, previous?.deliveryAt);
    if (timesMoved && deliversBeforePickup(pickupAt, deliveryAt)) {
      throw new ValidationError('The delivery time must be after the pickup time.', {
        deliveryAt: 'NOT_AFTER_PICKUP',
      });
    }

    const board = boardDayFor({ pickupAt, scheduledOn: input.scheduledOn }, previous);
    if (!board.ok) {
      throw new ValidationError(
        board.reason === 'DAY_REQUIRED'
          ? 'A trip needs a pickup time or a day.'
          : 'The day of a trip is its pickup day; change the pickup time instead.',
        { scheduledOn: board.reason },
      );
    }

    const customerId = input.customerId ?? null;
    // `previous` is null on create, so `previous?.customerId` is `undefined` and
    // any id differs from it — the reference is checked, as it must be.
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
      scheduledOn: board.day,
      customerId,
      cargoInfo: blankToNull(input.cargoInfo),
      pickupAddress: pickup.address,
      deliveryAddress: delivery.address,
      pickupContact: pickup.contact,
      deliveryContact: delivery.contact,
      pickupAt,
      deliveryAt,
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      deliveryLatitude: delivery.latitude,
      deliveryLongitude: delivery.longitude,
      pickupLocationId: pickup.locationId,
      deliveryLocationId: delivery.locationId,
      // ★ `blankToNull` AND NOTHING ELSE. The shape was settled by the DTO,
      // which refuses anything `NUMERIC(14,2)` cannot hold exactly; padding
      // `"4500000"` to two decimal places here would be this service deciding
      // how PostgreSQL stores a numeric, which it already knows.
      sellPrice: blankToNull(input.sellPrice),
      purchasePrice: blankToNull(input.purchasePrice),
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
    // ⚠ A SHARED PLACE (0030, `customerId === null`) FAILS THIS, AND THAT IS THE
    // CURRENT STATE RATHER THAN A DECISION. Shared places exist in the catalogue
    // but are not offered on a trip yet — the trip form reads only the
    // per-customer list, so nothing can reach here with one. Offering them means
    // accepting `location.customerId === null` as well, and is its own change.
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

const COMPLETION_ONLY =
  'A trip is completed by approving its completion request, or by "Đã xác nhận" on the board — not by editing it.';

/**
 * How the create intent starts the trip, or the refusal — `initialLifecycle`
 * decides; this says it. `finished` asked of a booking is the 409 the board
 * gives; the other two are a body contradicting its own intent.
 */
const startOf = (input: CreateTripInput): Extract<InitialLifecycle, { ok: true }> => {
  const start = initialLifecycle(input.entryMode, {
    status: input.status,
    crewSupplied: (input.crew?.length ?? 0) > 0,
  });
  if (start.ok) return start;
  if (start.refusal === 'COMPLETION_ONLY') throw new ConflictError(COMPLETION_ONLY);
  if (start.refusal === 'RETIRED_STATUS') throw retiredStatus();
  throw start.refusal === 'STATUS_SET_BY_ENTRY'
    ? new ValidationError('A trip recorded after it ran is finished; it takes no status.', {
        status: start.refusal,
      })
    : new ValidationError('A booking is crewed through the dispatch routes once it exists.', {
        crew: start.refusal,
      });
};

/**
 * `confirmed` is written by nobody any more: "Đã xác nhận" is `finished`, which
 * the board reaches through the completion route. A 422, since the value itself
 * is what is wrong — the same answer on create, on a patch and on a board move.
 */
const retiredStatus = (): ValidationError =>
  new ValidationError('"confirmed" is retired: "Đã xác nhận" means the trip is done, which is "finished".', {
    status: 'RETIRED_STATUS',
  });

/** What each calendar refusal says — the field it concerns rides in `details`. */
const CALENDAR_REFUSALS: Record<CalendarRefusal['reason'], string> = {
  PAST_DAY: 'A new booking cannot run on a past day. Record a trip that already ran as a historical entry.',
  FUTURE_DAY: 'A trip recorded as already run cannot be dated after today.',
  FUTURE_INSTANT: 'A trip recorded as already run cannot pick up or deliver later than now.',
};

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
