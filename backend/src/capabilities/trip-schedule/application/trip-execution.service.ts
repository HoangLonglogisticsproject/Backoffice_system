import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain.error';
import { decodeCursor, toPage, type Page } from '../../../common/pagination/cursor';
import type { PageQuery } from '../../../common/pagination/page-query.dto';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripSchedule } from '../domain/trip-schedule';
import {
  isPickupEvent,
  missingPrerequisite,
  type DriverAssignment,
  type DriverTripHistoryRow,
  type ExecutionEvent,
  type ExecutionEventType,
} from '../domain/trip-execution';
import type { LocationEvidence } from '../domain/trip-location';
import { TripVehicleRepository } from '../persistence/trip-catalogue.repository';
import { VehicleDailyFuelCheckRepository } from '../persistence/vehicle-fuel-check.repository';
import { requireDailyFuelCheck } from './vehicle-fuel-gate';
import { requireEligibleDriver } from './dispatch-eligibility';
import { DispatchCrew, tell } from './dispatch-crew';
import {
  CompletionRequestRepository,
  DriverAssignmentRepository,
  ExecutionEventRepository,
} from '../persistence/trip-execution.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../persistence/trip-status-history.repository';
import { EXECUTION_STARTED_REASON } from '../domain/trip-status-history';
import type { UserSummary } from '../../../common/types/user-summary';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import { NotificationService } from '../../notification/application/notification.service';

/**
 * Who is driving what on a trip, and what they report.
 *
 * WHAT THIS OWNS (ADR-0004): that a trip carries any number of dispatch
 * assignments, each a lorry AND a driver; that one lorry is on a trip at most
 * once at a time; that a change before execution ends the turn rather than
 * erasing it, and that no change at all is possible once a turn has started;
 * and that an event is recorded against the assignment it belongs to — with
 * THAT assignment's lorry and the schedule copied beside it.
 *
 * It owns no authorization in the guard's sense: a permission was decided before
 * any method here ran. What it DOES own is the one rule the guard cannot
 * express, because it depends on data rather than on a role — that a driver
 * reports their OWN assignment.
 */
@Injectable()
export class TripExecutionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly assignments: DriverAssignmentRepository,
    private readonly events: ExecutionEventRepository,
    private readonly vehicles: TripVehicleRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationService,
    private readonly requests: CompletionRequestRepository,
    private readonly history: TripStatusHistoryRepository,
    private readonly fuelChecks: VehicleDailyFuelCheckRepository,
    private readonly crew: DispatchCrew,
  ) {}

  // ------------------------------------------------------------ assignment ----

  /**
   * Puts a lorry and its driver on a trip.
   *
   * ★ THE TRIP IS LOCKED FIRST, AND NOT BECAUSE THIS WRITES TO IT. The lock
   * serialises everything that changes a trip's operational shape — adding,
   * replacing, ending, closing — against each other, so the "is this trip
   * still open" check cannot be overtaken by a completion approving between
   * the check and the insert. Lock order everywhere: trip → assignment → the
   * rest.
   *
   * ★ THE CREWING ITSELF IS `DispatchCrew`, shared with an approved driver
   * request (0035), so the lorry and driver rules exist once — and putting a
   * turn on an open booking supersedes every driver's pending ask on it, in
   * this same transaction. There is no rule about the DRIVER: one person on
   * three lorries of one trip is dispatch, not a conflict.
   */
  async assign(
    tripId: string,
    input: { vehicleId: string; driverUserId: string },
    assignedBy: string,
  ): Promise<DriverAssignment> {
    const { assignment, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);
      return this.crew.crew(trip, input, assignedBy, tx);
    });

    this.notifications.deliver(told);
    return assignment;
  }

  /**
   * Swaps the driver on one lorry, before that turn has started.
   *
   * ★ END THEN INSERT, IN ONE TRANSACTION, AND NEVER AN UPDATE OF THE OLD ROW.
   * Overwriting `driver_user_id` would be two lines shorter and would destroy
   * the answer to "who was on this lorry when" — the question every event and
   * every declared figure points back at. The new turn keeps the lorry.
   *
   * ★ AND ONLY BEFORE EXECUTION. Once a driver has reported a milestone, the
   * pair is what happened and nobody swaps it (ADR-0004): there is no takeover,
   * no inherited timeline, no evidence recorded by one person under another's
   * name. `requireNotStarted` says so with a 409.
   *
   * The reason is mandatory. A driver change with no explanation is the record
   * somebody comes back to and cannot account for, the same argument 0012 makes
   * for a void.
   */
  async replaceDriver(
    tripId: string,
    assignmentId: string,
    driverUserId: string,
    input: { by: string; reason: string },
  ): Promise<DriverAssignment> {
    const reason = requireReason(input.reason);

    const { assignment, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const current = await this.lockActiveOnTrip(tripId, assignmentId, tx);
      if (current.driverUserId === driverUserId) {
        throw new ConflictError('That driver is already on this lorry.');
      }
      if (!current.vehicleId) {
        throw new ConflictError(
          'This assignment names no lorry (a pre-multi-vehicle row). End it and add the lorry and driver afresh.',
        );
      }

      await this.requireNotStarted(current, tx);
      await this.requireEligibleDriver(driverUserId, tx);

      const ended = await this.assignments.end(
        { id: current.id, endedBy: input.by, reason, now: new Date() },
        tx,
      );
      if (!ended) throw new ConflictError('That assignment has already ended.');

      const assignment = await this.assignments.assign(
        { tripId, vehicleId: current.vehicleId, driverUserId, assignedBy: input.by },
        tx,
      );

      // Both people learn, each about their own turn: the one leaving that
      // their turn ended, the one arriving that theirs began.
      const told = [
        await this.notifications.record(tell('TRIP_UNASSIGNED', trip, ended), tx),
        await this.notifications.record(tell('TRIP_ASSIGNED', trip, assignment), tx),
      ];
      return { assignment, told };
    });

    this.notifications.deliver(told);
    return assignment;
  }

  /** Takes one lorry (and its driver) off the trip, before that turn has started. */
  async endAssignment(
    tripId: string,
    assignmentId: string,
    input: { by: string; reason: string },
  ): Promise<DriverAssignment> {
    const reason = requireReason(input.reason);

    const { ended, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const current = await this.lockActiveOnTrip(tripId, assignmentId, tx);
      await this.requireNotStarted(current, tx);

      const ended = await this.assignments.end(
        { id: current.id, endedBy: input.by, reason, now: new Date() },
        tx,
      );
      if (!ended) throw new ConflictError('That assignment has already ended.');

      const told = [await this.notifications.record(tell('TRIP_UNASSIGNED', trip, ended), tx)];
      return { ended, told };
    });

    this.notifications.deliver(told);
    return ended;
  }

  /**
   * The assignment named in the route, locked, and PROVEN to be on the trip
   * named in the route. A caller holding one trip's id must not reach another
   * trip's assignment by pairing it with a foreign assignment id — so a row on
   * the wrong trip answers exactly as a row that does not exist.
   */
  private async lockActiveOnTrip(
    tripId: string,
    assignmentId: string,
    tx: DatabaseQuery,
  ): Promise<DriverAssignment> {
    const current = await this.assignments.lockActiveById(assignmentId, tx);
    if (current?.tripId !== tripId) {
      throw new NotFoundError('Assignment not found.');
    }
    return current;
  }

  /**
   * ★ "STARTED" IS ONE LIVE EXECUTION EVENT, AND NOTHING ELSE (ADR-0004). Not
   * an expense, not a completion request, not a column: the first milestone a
   * driver reports is the moment the pair of lorry and driver becomes what
   * happened, and dispatch can no longer rewrite it. Read under the trip lock,
   * so a tap landing between this check and the end cannot slip through — the
   * tap queues on the same lock.
   */
  private async requireNotStarted(assignment: DriverAssignment, tx: DatabaseQuery): Promise<void> {
    if (await this.events.hasLiveEvents(assignment.id, tx)) {
      throw new ConflictError(
        'That assignment has started execution, so its lorry and driver can no longer be changed.',
      );
    }
  }

  /**
   * Who a dispatcher may put on a trip: every live driver account, by name.
   *
   * ★ THE ONLY LIST OF PEOPLE THIS CAPABILITY EXPOSES, and it is id and name.
   * No email, no status other than the `active` the query already required.
   */
  async listEligibleDrivers(): Promise<UserSummary[]> {
    const drivers = await this.users.listActiveByAccountType('driver');
    return drivers.map((user) => ({ id: user.id, displayName: user.displayName }));
  }

  /**
   * One page of what a driver has been given, newest first.
   *
   * ★ 404 FOR SOMEBODY WHO IS NOT A DRIVER, rather than an empty page. An
   * employee has no assignments and never will, so an empty list would answer a
   * question that was never sensible — and would make a mistyped id look like a
   * driver who has simply not worked yet.
   *
   * ⚠ THE ACCOUNT'S STATUS IS NOT CHECKED, deliberately. A disabled driver's
   * history is exactly what somebody investigating a disabled driver came for.
   */
  async listDriverHistory(
    driverUserId: string,
    page: PageQuery,
  ): Promise<Page<DriverTripHistoryRow>> {
    const user = await this.users.findById(driverUserId);
    // `undefined?.accountType` is `undefined`, which is not `'driver'` — so one
    // test answers both "no such user" and "that user is not a driver", which is
    // deliberate: naming which would tell a caller an id they guessed exists.
    if (user?.accountType !== 'driver') throw new NotFoundError('Driver not found.');

    const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;
    const rows = await this.assignments.listHistoryForDriver(driverUserId, page.limit, cursor);

    return toPage(rows, page.limit);
  }

  /** A live driver account — the rule shared with historical entry, see `dispatch-eligibility`. */
  private requireEligibleDriver(driverUserId: string, tx: DatabaseQuery): Promise<void> {
    return requireEligibleDriver(this.users, driverUserId, tx);
  }

  async listAssignments(tripId: string): Promise<DriverAssignment[]> {
    await this.requireTrip(tripId);
    return this.assignments.listByTrip(tripId);
  }

  /** The trips a driver is on right now. The Driver Portal's home screen. */
  async listMyAssignments(driverUserId: string): Promise<DriverAssignment[]> {
    return this.assignments.listActiveForDriver(driverUserId);
  }

  // ----------------------------------------------------------------- events ----

  /**
   * Records something that happened on the road, against one assignment.
   *
   * ★ THE RETRY IS ANSWERED, NOT REFUSED. A driver on a bad connection taps once
   * and the request arrives three times. Two of those find the event already
   * written and get the ORIGINAL back — which is both true and useful. Only a
   * DIFFERENT event reusing the same `clientEventId` is a conflict, and the
   * unique index catches the pair that slip past this check simultaneously.
   *
   * ★ AND THE SNAPSHOTS ARE TAKEN UNDER THE LOCK, FROM THE ASSIGNMENT. The
   * lorry written beside the event is the assignment's, never the trip's
   * legacy column; the schedule is the trip's, read under `FOR UPDATE`.
   */
  async recordEvent(input: {
    assignmentId: string;
    type: ExecutionEventType;
    /**
     * ★ OPTIONAL, AND NO HTTP CALLER SUPPLIES IT.
     *
     * When absent — which is every request from the portal — the SERVER's clock
     * stamps it. The parameter exists so a test can pin a moment; the route's
     * DTO has no field for it at all, so there is no way for a handset to set
     * the value every delay in the system is measured from.
     */
    actualAt?: Date;
    /** The handset's own clock. Diagnostic only. */
    deviceReportedAt?: Date | null;
    /**
     * Where the handset said it was — OPTIONAL on every milestone today, and
     * sent by nothing: the geofence is off (DL-118, see `domain/trip-location`),
     * so no milestone requires a reading. One that arrives anyway is evidence
     * beside the event, with no verdict, because nothing measured it. Never a
     * verdict from the client either — the route's DTO has no field for
     * `geofencePassed` or a distance, and this input type has none.
     */
    location?: LocationEvidence | null;
    clientEventId: string;
    recordedBy: string;
  },
  /** The server's clock at the request — what the fuel gate's day is read from. Tests pin it. */
  serverNow = new Date(),
  ): Promise<ExecutionEvent> {
    const clientEventId = input.clientEventId.trim();
    if (clientEventId === '') {
      throw new ValidationError('An event needs a client event id, so a retry cannot duplicate it.');
    }

    // ★ AN IDEMPOTENCY KEY IDENTIFIES ONE INTENT, NOT ONE SLOT PER TRIP.
    //
    // Returning the stored event on a match is what makes a retry safe. But
    // matching on the key ALONE answered a DIFFERENT milestone with the old
    // one and a success status: a handset that reused a key — a bug, a stale
    // draft, a request rebuilt from a queue — was told its arrival had been
    // recorded when what came back was the confirmation from an hour ago.
    // The milestone was never written and nothing anywhere said so, which in a
    // record used to apportion delay is the worst way to lose a fact.
    //
    // So the key is only honoured for the intent it was minted for. A repeat
    // of the SAME milestone is the retry it was designed for; the same key
    // carrying a DIFFERENT one is a caller contradicting itself, and it is
    // refused rather than absorbed.
    //
    // ★ THE ASSIGNMENT NAMES THE TRIP; THE CLIENT DOES NOT. An unlocked read is
    // enough here — it only supplies the trip id for the two look-ups that
    // follow, and everything that decides is re-read under the locks below.
    // An assignment that is not active answers as not found: the guard already
    // refused it, and this reasoning holds either way — nothing may be
    // reported against a turn that has ended.
    const named = await this.assignments.findActiveById(input.assignmentId);
    if (!named) throw new NotFoundError('Assignment not found.');
    const tripId = named.tripId;

    // ⚠ CEILING: this read is outside the transaction, so two simultaneous
    // requests sharing a key can both miss it and the second meets the
    // `uq_trip_execution_event_client` unique index instead. No duplicate is
    // ever stored — the index is the real guarantee and this is the fast path
    // in front of it. It is deliberately not moved inside the lock: a retry
    // that arrives after the trip closed still has to be able to read back the
    // event it already wrote, and `lockOpenTrip` would refuse it first.
    const already = await this.events.findByClientEventId(tripId, clientEventId);
    if (already) return sameIntent(already, input);

    return this.db.transaction(async (tx) => {
      // ★ LOCKED WHATEVER ITS STATUS, AND THE KEY IS LOOKED UP BEFORE THE
      // STATUS IS JUDGED. A retry can queue behind the tap it repeats AND
      // behind the approval that then closed the trip; when it finally holds
      // the lock the trip is DONE and its event exists. The event is what it
      // is owed — refusing it as "closed" would tell a driver their pickup
      // was never recorded when it was. Only a key that matches NOTHING is
      // then measured against the status, and on a closed trip refused.
      const trip = await this.trips.lockActive(tripId, tx);
      if (!trip) throw new NotFoundError('Trip not found.');

      // ★ AND CHECKED AGAIN UNDER THE LOCK — THIS IS WHAT MAKES A RETRY SAFE.
      //
      // Three copies of one tap arrive together. All three run the read
      // above before any of them has committed, so all three miss. Then all
      // three queue on the trip row's `FOR UPDATE`: the first writes and
      // commits, and the other two resume ONLY after that commit. This read
      // runs after the lock is granted, so under READ COMMITTED it sees the
      // row the winner wrote, and the two retries are answered with it
      // rather than driven into `uq_trip_execution_event_client`. The lock
      // is what serialises them; the index stays as the last line for any
      // writer that bypasses this service.
      const written = await this.events.findByClientEventId(tripId, clientEventId, tx);
      if (written) return sameIntent(written, input);

      // Nothing to answer with, so this is a NEW milestone — and a closed trip
      // takes none. Same rule `lockOpenTrip` applies everywhere else.
      if (trip.status === 'finished') throw new ConflictError('That trip is closed.');

      // Re-read under its own lock (trip → assignment, the order everywhere):
      // the turn could have ended between the unlocked read and here.
      const assignment = await this.assignments.lockActiveById(input.assignmentId, tx);
      if (!assignment) throw new ConflictError('That assignment is no longer active.');
      if (!assignment.vehicleId) {
        throw new ConflictError('That assignment names no lorry, so nothing can be reported on it.');
      }

      // ★ A DRIVER REPORTS THEIR OWN ASSIGNMENT, AND NOBODY REPORTS IT FOR THEM.
      //
      // This is a rule about DATA — which turn this person holds — so no
      // permission tier can express it: the guard knows roles and departments,
      // not assignments. It lives here, at the only point where both the actor
      // and the assignment are in hand.
      if (assignment.driverUserId !== input.recordedBy) {
        throw new ForbiddenError('Only the driver on an assignment may report its progress.');
      }

      // ★ AN APPROVED TURN TAKES NO NEW MILESTONE (DL-108).
      //
      // Approval is the SuperAdmin saying "this turn's record is what
      // happened". A milestone reported afterwards would move a time the
      // reviewer already judged — and it would do so on a turn whose money has
      // just been made immutable. So the record closes with the approval,
      // PER ASSIGNMENT: another lorry's turn on the same trip is still that
      // driver's to report, and a REJECTED turn is reopened for exactly the
      // corrections a rejection asks for. Nothing here reads the trip's
      // status — a trip left open by a sibling turn does not reopen this one.
      //
      // Read under the trip lock, after the retry answer above: a phone
      // retrying a milestone it reported before the approval still gets the
      // row it wrote, because that lookup never reaches this line.
      const history = await this.requests.listByAssignment(assignment.id, tx);
      if (history.some((request) => request.state === 'approved')) {
        throw new ConflictError(
          'That assignment has been approved, so its execution record is final.',
        );
      }

      // ★ THE JOURNEY CANNOT BE SKIPPED, AND THIS IS WHERE THAT HOLDS — PER
      // ASSIGNMENT. What another lorry on the same trip has reported is not
      // this lorry's progress (ADR-0004): assignment A's pickup does not let
      // assignment B confirm one.
      //
      // Checked INSIDE the transaction, after the trip row is locked, so two
      // taps arriving together cannot both read the same incomplete state and
      // both pass. No database constraint could do this: "has an earlier
      // milestone been reported" is a predicate across OTHER rows, which a
      // row-level CHECK cannot see.
      //
      // Repeats are still allowed — a driver who leaves and comes back reports
      // an arrival twice, and that is a real fact rather than an error.
      const reported = await this.events.listByAssignment(assignment.id, false, tx);
      const missing = missingPrerequisite(
        input.type,
        reported.map((event) => event.type),
      );

      if (missing) {
        throw new ConflictError(
          `Report ${missing} before ${input.type}: the earlier step has no time recorded against it.`,
        );
      }

      // ★ THE LORRY'S DAILY FUEL CHECK HOLDS THE TURN'S START (0034) — its first
      // live milestone, and only that: a turn already on the road is not asked
      // again past midnight. Refused before anything is written, so the same
      // milestone retried after the declaration is simply new. Its day is the
      // SERVER's (`serverNow`), never `actualAt`; the lorry is held FOR SHARE so
      // its policy cannot change before this commits (trip → assignment → lorry).
      const actualAt = input.actualAt ?? serverNow;
      const vehicle = await this.vehicles.findForShare(assignment.vehicleId, tx);
      await requireDailyFuelCheck(
        this.fuelChecks,
        { vehicle, turnStarted: reported.length > 0, serverNow },
        tx,
      );

      // ★ NO VERDICT IS REACHED ABOUT WHERE THE HANDSET WAS (DL-118). The
      // geofence is off, so a reading that arrives is kept as EVIDENCE and
      // nothing measures it — `geofencePassed` and `distanceM` stay NULL, which
      // 0019's CHECK permits beside a stored position precisely for this.
      //
      // ⚠ THE CHECK WAS REMOVED FROM HERE RATHER THAN LEFT SWITCHED OFF. A
      // block that can never run reads as behaviour that happens and is never
      // exercised by a test. The rule, the thresholds, the refusal sentences
      // and the wiring that would go back in this spot all live in
      // `domain/trip-location.ts`, which documents the restore and is covered
      // by its own spec. Contract §11 keeps GPS [FUTURE]; this is where it
      // returns, between the fuel gate above and `events.record` below.
      //
      // ⚠ IDENTITY ASSURANCE AT DELIVERY IS THE SESSION AND THE ASSIGNMENT —
      // and nothing more. There is no reference photo, no biometric provider
      // and no liveness check anywhere in this deployment, so nothing here
      // pretends to one. If one arrives, this is the point at which its verdict
      // would be required before `DELIVERY_CONFIRMED` is written.
      const location = input.location ?? null;

      const event = await this.events.record(
        {
          tripId,
          driverAssignmentId: assignment.id,
          type: input.type,
          // ★ THE ASSIGNMENT'S LORRY, never `trip.vehicleId` (legacy, ADR-0004).
          vehicleId: assignment.vehicleId,
          // The lorry's ownership at the moment of writing, `null` while it is
          // unclassified — never read as `company` (0013).
          vehicleOwnership: vehicle?.ownership ?? null,
          // Pickup events are late against the pickup time and delivery events
          // against the delivery time. Comparing either with the other produces
          // a delay wrong by the length of the journey.
          scheduledAt: isPickupEvent(input.type) ? trip.pickupAt : trip.deliveryAt,
          // ★ THE SERVER'S CLOCK, unless a caller inside the process pinned one.
          actualAt,
          deviceReportedAt: input.deviceReportedAt ?? null,
          location,
          // Evidence with no verdict: nothing measured this reading. 0019's
          // CHECK allows exactly that shape — a position without a distance.
          geofencePassed: null,
          distanceM: null,
          clientEventId,
          recordedBy: input.recordedBy,
        },
        tx,
      );

      // ★ THE FIRST LIVE MILESTONE PUTS THE TRIP ON THE ROAD — `pending →
      // executing`, in this transaction, with its history row. The DRIVER
      // starts execution; the office never does (no board action exists for
      // it). Reached only by a NEW, ACCEPTED event: a retry was answered above
      // with the row it repeats, and a refused report threw before this line.
      // Idempotent by construction — `trip` was read under `FOR UPDATE`, so a
      // second first-event (another lorry, the same instant) queues on the lock
      // and finds `executing`. Withdrawing a milestone moves nothing back.
      //
      // Only from `pending`: the retired `confirmed` meant "done" and is the
      // normalization's to settle, not the road's.
      if (trip.status === 'pending') await this.startExecution(trip, input.recordedBy, tx);

      return event;
    });
  }

  /** `pending → executing`, recorded as the driver's doing. Inside the caller's transaction, under its lock. */
  private async startExecution(trip: TripSchedule, driverUserId: string, tx: DatabaseQuery): Promise<void> {
    const started = await this.trips.updateStatus(trip.id, 'executing', tx);
    if (!started) throw new Error('Locked trip disappeared while starting execution.');
    await this.history.record(
      {
        tripId: trip.id,
        from: trip.status,
        to: 'executing',
        reason: EXECUTION_STARTED_REASON,
        changedBy: driverUserId,
      },
      tx,
    );
  }

  async listEvents(tripId: string, includeVoided = false): Promise<ExecutionEvent[]> {
    await this.requireTrip(tripId);
    return this.events.listByTrip(tripId, includeVoided);
  }

  /**
   * Withdraws an event that should not have been recorded.
   *
   * The row survives with who withdrew it and why — 0017 denies `DELETE`
   * outright, and a timeline that can be quietly shortened proves nothing.
   *
   * ★ UNDER THE TRIP LOCK, like every new milestone. A completion request and
   * its approval read the execution under that lock (`requireCompleteExecution`),
   * so a withdrawal either lands before they read — and they see the step
   * missing — or after they commit. Never in between.
   */
  async voidEvent(
    tripId: string,
    eventId: string,
    input: { by: string; reason: string },
  ): Promise<ExecutionEvent> {
    const reason = requireReason(input.reason);

    return this.db.transaction(async (tx) => {
      if (!(await this.trips.lockActive(tripId, tx))) throw new NotFoundError('Trip not found.');

      const events = await this.events.listByTrip(tripId, true, tx);
      const current = events.find((event) => event.id === eventId);
      // Belonging to the trip in the route is checked by looking only within it:
      // a caller holding one trip's id must not be able to withdraw another's
      // event by pairing it with a foreign event id.
      if (!current) throw new NotFoundError('Event not found.');
      if (current.voidedAt) throw new ConflictError('That event has already been withdrawn.');

      const voided = await this.events.void(eventId, input.by, reason, new Date(), tx);
      if (!voided) throw new ConflictError('That event has already been withdrawn.');

      return voided;
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Locks the trip and refuses to touch a closed one.
   *
   * ★ CLOSED, NOT ARCHIVED. `lockActive` already skips archived rows. What this
   * adds is that a trip whose completion has been approved takes no further
   * operational writes: its figures are final, and an event or a driver change
   * arriving afterwards would describe a trip that is already accounted for.
   */
  private async lockOpenTrip(tripId: string, tx: DatabaseQuery): Promise<TripSchedule> {
    const trip = await this.trips.lockActive(tripId, tx);
    if (!trip) throw new NotFoundError('Trip not found.');
    if (trip.status === 'finished') throw new ConflictError('That trip is closed.');
    return trip;
  }

  private async requireTrip(tripId: string): Promise<void> {
    if (!(await this.trips.exists(tripId))) throw new NotFoundError('Trip not found.');
  }
}

/** A change with no reason is the record nobody can account for later. */
const requireReason = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === '') throw new ValidationError('That change needs a reason.');
  return trimmed;
};

/**
 * A stored event answers a retry of the SAME milestone; the same key carrying
 * a DIFFERENT one is a caller contradicting itself, and is refused.
 */
/**
 * ★ A STORED EVENT IS REUSED ONLY FOR THE ASSIGNMENT IT WAS WRITTEN FOR. The
 * key is unique per TRIP in the database (0015), but the caller was authorised
 * per ASSIGNMENT; answering assignment B's tap with assignment A's event would
 * hand one driver another driver's record and silently drop B's milestone.
 * Reuse the key on the same turn: the original. On another turn of the same
 * trip: refused, with nothing of the other turn disclosed.
 */
const sameIntent = (
  stored: ExecutionEvent,
  input: { assignmentId: string; type: ExecutionEventType },
): ExecutionEvent => {
  if (stored.driverAssignmentId !== input.assignmentId) {
    throw new ConflictError(
      'That client event id was already used on another assignment of this trip. Use a new id for each assignment.',
    );
  }
  if (stored.type !== input.type) {
    throw new ConflictError(
      `That client event id was already used to report ${stored.type}, so it cannot now report ${input.type}. Use a new id for a new milestone.`,
    );
  }
  return stored;
};
