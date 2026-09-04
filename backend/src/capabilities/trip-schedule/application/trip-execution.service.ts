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
  type VehicleOwnership,
} from '../domain/trip-execution';
import {
  checkMilestoneLocation,
  type Coordinates,
  type LocationEvidence,
  type LocationRejection,
} from '../domain/trip-location';
import { TripVehicleRepository } from '../persistence/trip-catalogue.repository';
import {
  DriverAssignmentRepository,
  ExecutionEventRepository,
} from '../persistence/trip-execution.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import type { UserSummary } from '../../../common/types/user-summary';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import { NotificationService } from '../../notification/application/notification.service';
import {
  eventKeys,
  type NotificationInput,
  type NotificationType,
} from '../../notification/domain/notification';

/**
 * Who is driving a trip, and what they report.
 *
 * WHAT THIS OWNS: that a trip has at most one driver at a time, that a driver
 * change ends the previous turn rather than erasing it, and that an event is
 * recorded against the assignment that was live when it happened — with the
 * vehicle and the schedule copied beside it.
 *
 * It owns no authorization in the guard's sense: a permission was decided before
 * any method here ran. What it DOES own is the one rule the guard cannot
 * express, because it depends on data rather than on a role — that a driver
 * reports their OWN trip.
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
  ) {}

  // ------------------------------------------------------------ assignment ----

  /**
   * Puts a driver on a trip.
   *
   * ★ THE TRIP IS LOCKED FIRST, AND NOT BECAUSE THIS WRITES TO IT. The lock
   * serialises everything that changes a trip's operational shape — assigning,
   * replacing, closing — against each other, so the "is this trip still open"
   * check cannot be overtaken by a completion approving between the check and
   * the insert.
   *
   * ★ AND THE ONE-ACTIVE-DRIVER RULE IS STILL LEFT TO THE INDEX. The check below
   * exists to produce a readable 409; `uq_trip_active_driver_assignment` is what
   * makes the rule true, including for two callers that both passed the check.
   */
  async assign(
    tripId: string,
    driverUserId: string,
    assignedBy: string,
  ): Promise<DriverAssignment> {
    const { assignment, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const current = await this.assignments.lockActive(tripId, tx);
      if (current) {
        throw new ConflictError(
          'That trip already has a driver. Replace the current one instead of adding a second.',
        );
      }

      await this.requireEligibleDriver(driverUserId, tx);
      const assignment = await this.assignments.assign({ tripId, driverUserId, assignedBy }, tx);

      // ★ THE NOTIFICATION IS PART OF THE SAME TRANSACTION, keyed by the
      // assignment row, so it exists exactly when the assignment does and
      // exactly once. Pushing to the phone happens after COMMIT, below.
      const told = [await this.notifications.record(tell('TRIP_ASSIGNED', trip, assignment), tx)];
      return { assignment, told };
    });

    this.notifications.deliver(told);
    return assignment;
  }

  /**
   * Swaps the driver.
   *
   * ★ END THEN INSERT, IN ONE TRANSACTION, AND NEVER AN UPDATE OF THE OLD ROW.
   * Overwriting `driver_user_id` would be two lines shorter and would destroy
   * the answer to "who was driving when this expense was recorded" — which is
   * the question every event and every declared figure points back at.
   *
   * The reason is mandatory. A driver change with no explanation is the record
   * somebody comes back to and cannot account for, the same argument 0012 makes
   * for a void.
   */
  async replaceDriver(
    tripId: string,
    driverUserId: string,
    input: { by: string; reason: string },
  ): Promise<DriverAssignment> {
    const reason = requireReason(input.reason);

    const { assignment, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const current = await this.assignments.lockActive(tripId, tx);
      if (!current) throw new ConflictError('That trip has no driver to replace.');

      if (current.driverUserId === driverUserId) {
        throw new ConflictError('That driver is already assigned to this trip.');
      }

      await this.requireEligibleDriver(driverUserId, tx);
      const ended = await this.assignments.end(
        { tripId, endedBy: input.by, reason, now: new Date() },
        tx,
      );
      if (!ended) throw new ConflictError('That trip has no driver to replace.');

      const assignment = await this.assignments.assign(
        { tripId, driverUserId, assignedBy: input.by },
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

  /** Takes the driver off without naming a replacement. */
  async endAssignment(tripId: string, input: { by: string; reason: string }): Promise<DriverAssignment> {
    const reason = requireReason(input.reason);

    const { ended, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const ended = await this.assignments.end(
        { tripId, endedBy: input.by, reason, now: new Date() },
        tx,
      );
      if (!ended) throw new ConflictError('That trip has no driver to remove.');

      const told = [await this.notifications.record(tell('TRIP_UNASSIGNED', trip, ended), tx)];
      return { ended, told };
    });

    this.notifications.deliver(told);
    return ended;
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
    if (!user || user.accountType !== 'driver') throw new NotFoundError('Driver not found.');

    const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;
    const rows = await this.assignments.listHistoryForDriver(driverUserId, page.limit, cursor);

    return toPage(rows, page.limit);
  }

  /**
   * ★ ELIGIBILITY IS THREE FACTS ABOUT THE ACCOUNT, AND NOTHING SPECULATIVE.
   * The person exists, they are a driver account, and the account is live.
   * There is no rule about how many trips a driver may hold or when — the
   * business has not defined one, and inventing it here would block real
   * dispatch on a guess.
   */
  private async requireEligibleDriver(driverUserId: string, tx: DatabaseQuery): Promise<void> {
    const user = await this.users.findById(driverUserId, tx);
    if (!user) throw new NotFoundError('Driver not found.');
    if (user.accountType !== 'driver') {
      throw new ValidationError('Only a driver account can be assigned to a trip.', {
        driverUserId: 'This account is not a driver account.',
      });
    }
    if (user.status !== 'active') {
      throw new ConflictError('That driver account is disabled and cannot be assigned.');
    }
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
   * Records something that happened on the road.
   *
   * ★ THE RETRY IS ANSWERED, NOT REFUSED. A driver on a bad connection taps once
   * and the request arrives three times. Two of those find the event already
   * written and get the ORIGINAL back — which is both true and useful. Only a
   * DIFFERENT event reusing the same `clientEventId` is a conflict, and the
   * unique index catches the pair that slip past this check simultaneously.
   *
   * ★ AND THE THREE SNAPSHOTS ARE TAKEN UNDER THE LOCK. Reading the trip's
   * vehicle after the lock is released would store what the trip says a moment
   * later, which is not what was validated.
   */
  async recordEvent(input: {
    tripId: string;
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
     * Where the handset said it was. REQUIRED for PICKUP_CONFIRMED, where the
     * server measures it against the trip's pickup point; kept as evidence on
     * any other milestone that carries one. Never a verdict — the route's DTO
     * has no field for `geofencePassed` or a distance, so a client cannot send
     * one, and this input type has none either.
     */
    location?: LocationEvidence | null;
    clientEventId: string;
    recordedBy: string;
  }): Promise<ExecutionEvent> {
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
    // ⚠ CEILING: this read is outside the transaction, so two simultaneous
    // requests sharing a key can both miss it and the second meets the
    // `uq_trip_execution_event_client` unique index instead. No duplicate is
    // ever stored — the index is the real guarantee and this is the fast path
    // in front of it. It is deliberately not moved inside the lock: a retry
    // that arrives after the trip closed still has to be able to read back the
    // event it already wrote, and `lockOpenTrip` would refuse it first.
    const already = await this.events.findByClientEventId(input.tripId, clientEventId);
    if (already) {
      if (already.type !== input.type) {
        throw new ConflictError(
          `That client event id was already used to report ${already.type}, so it cannot now report ${input.type}. Use a new id for a new milestone.`,
        );
      }
      return already;
    }

    return this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(input.tripId, tx);

      const assignment = await this.assignments.lockActive(input.tripId, tx);
      if (!assignment) {
        throw new ConflictError('That trip has no driver, so there is nothing to report against.');
      }

      // ★ A DRIVER REPORTS THEIR OWN TRIP, AND NOBODY REPORTS IT FOR THEM.
      //
      // This is a rule about DATA — which trip this person is on — so no
      // permission tier can express it: the guard knows roles and departments,
      // not assignments. It lives here, at the only point where both the actor
      // and the assignment are in hand.
      if (assignment.driverUserId !== input.recordedBy) {
        throw new ForbiddenError('Only the driver assigned to a trip may report its progress.');
      }

      // ★ THE JOURNEY CANNOT BE SKIPPED, AND THIS IS WHERE THAT HOLDS.
      //
      // Checked INSIDE the transaction, after the trip row is locked, so two
      // taps arriving together cannot both read the same incomplete state and
      // both pass. No database constraint could do this: "has an earlier
      // milestone been reported" is a predicate across OTHER rows, which a
      // row-level CHECK cannot see.
      //
      // Repeats are still allowed — a driver who leaves and comes back reports
      // an arrival twice, and that is a real fact rather than an error.
      const reported = await this.events.listByTrip(input.tripId, false, tx);
      const missing = missingPrerequisite(
        input.type,
        reported.map((event) => event.type),
      );

      if (missing) {
        throw new ConflictError(
          `Report ${missing} before ${input.type}: the earlier step has no time recorded against it.`,
        );
      }

      // ★ THE GEOFENCE IS DECIDED HERE, UNDER THE LOCK, FROM THE TRIP'S OWN
      // COORDINATES. The browser sent a reading; it did not send a verdict, and
      // could not have — see the DTO. What the trip says its pickup or delivery
      // point is was read a moment ago under `FOR UPDATE`, so Operations
      // correcting the point mid-request cannot make this measure against a
      // stale one. The same rule, the same radius, at both ends of the trip.
      //
      // ⚠ IDENTITY ASSURANCE AT DELIVERY IS THE SESSION, THE ASSIGNMENT AND
      // THE POSITION — and nothing more today. There is no reference photo, no
      // biometric provider and no liveness check anywhere in this deployment,
      // so nothing here pretends to one. If one arrives, this is the point at
      // which its verdict would be required before `DELIVERY_CONFIRMED` is
      // written, beside the location verdict.
      //
      // Freshness is measured against the HANDSET's send time when it gave
      // one: `capturedAt` and `deviceReportedAt` come off the same clock, so
      // a phone that is an hour wrong is wrong on both and the age is right.
      // Neither stamp touches `actual_at`, which stays the server's.
      const location = input.location ?? null;
      let geofencePassed: boolean | null = null;
      let distanceM: number | null = null;

      const destination = geofencedPointOf(trip, input.type);
      if (destination !== undefined) {
        const verdict = checkMilestoneLocation(
          destination,
          location,
          input.deviceReportedAt ?? new Date(),
        );
        if (!verdict.passed) {
          throw new ValidationError(LOCATION_REFUSALS[verdict.reason], { location: verdict.reason });
        }
        geofencePassed = true;
        distanceM = verdict.distanceM;
      }

      return this.events.record(
        {
          tripId: input.tripId,
          driverAssignmentId: assignment.id,
          type: input.type,
          vehicleId: trip.vehicleId,
          vehicleOwnership: await this.ownershipOf(trip.vehicleId, tx),
          // Pickup events are late against the pickup time and delivery events
          // against the delivery time. Comparing either with the other produces
          // a delay wrong by the length of the journey.
          scheduledAt: isPickupEvent(input.type) ? trip.pickupAt : trip.deliveryAt,
          // ★ THE SERVER'S CLOCK, unless a caller inside the process pinned one.
          actualAt: input.actualAt ?? new Date(),
          deviceReportedAt: input.deviceReportedAt ?? null,
          location,
          geofencePassed,
          distanceM,
          clientEventId,
          recordedBy: input.recordedBy,
        },
        tx,
      );
    });
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
   */
  async voidEvent(
    tripId: string,
    eventId: string,
    input: { by: string; reason: string },
  ): Promise<ExecutionEvent> {
    const reason = requireReason(input.reason);

    const events = await this.events.listByTrip(tripId, true);
    const current = events.find((event) => event.id === eventId);
    // Belonging to the trip in the route is checked by looking only within it:
    // a caller holding one trip's id must not be able to withdraw another's
    // event by pairing it with a foreign event id.
    if (!current) throw new NotFoundError('Event not found.');
    if (current.voidedAt) throw new ConflictError('That event has already been withdrawn.');

    const voided = await this.events.void(eventId, input.by, reason, new Date());
    if (!voided) throw new ConflictError('That event has already been withdrawn.');

    return voided;
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
    if (trip.status === 'done') throw new ConflictError('That trip is closed.');
    return trip;
  }

  /**
   * The lorry's ownership at the moment of writing.
   *
   * ★ RETURNS `null` FREELY, AND NOTHING DOWNSTREAM SUBSTITUTES A VALUE. A trip
   * may have no vehicle yet, and a vehicle may not have been classified yet —
   * 0013 leaves every existing lorry unclassified on purpose. Both are honest
   * absences, and turning either into `company` would be the system asserting
   * something nobody said.
   */
  private async ownershipOf(
    vehicleId: string | null,
    tx: DatabaseQuery,
  ): Promise<VehicleOwnership | null> {
    if (!vehicleId) return null;
    const vehicle = await this.vehicles.findById(vehicleId, tx);
    return vehicle?.ownership ?? null;
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

const pointOf = (latitude: number | null, longitude: number | null): Coordinates | null =>
  latitude !== null && longitude !== null ? { latitude, longitude } : null;

/**
 * Which point a milestone is measured against.
 *
 * `undefined` for the two ARRIVALS, which are not geofenced: arriving is what
 * the driver says on the way in, and the check happens at the confirmation
 * that follows. `null` for a confirmation whose point Operations has not
 * entered yet — refused, and named as the office's problem.
 */
const geofencedPointOf = (
  trip: TripSchedule,
  type: ExecutionEventType,
): Coordinates | null | undefined => {
  if (type === 'PICKUP_CONFIRMED') return pointOf(trip.pickupLatitude, trip.pickupLongitude);
  if (type === 'DELIVERY_CONFIRMED') return pointOf(trip.deliveryLatitude, trip.deliveryLongitude);
  return undefined;
};

/** A notification about one turn on one trip, addressed to the driver of that turn. */
const tell = (
  type: NotificationType,
  trip: TripSchedule,
  assignment: DriverAssignment,
): NotificationInput => ({
  recipientUserId: assignment.driverUserId,
  type,
  tripId: trip.id,
  tripScheduledOn: trip.scheduledOn,
  eventKey:
    type === 'TRIP_ASSIGNED' ? eventKeys.assigned(assignment.id) : eventKeys.unassigned(assignment.id),
});

/**
 * One sentence per refusal, for whoever reads the API directly. The portal
 * switches on the CODE in `details.location`, never on these words, so they
 * can be edited without breaking a screen.
 */
const LOCATION_REFUSALS: Record<LocationRejection, string> = {
  DESTINATION_MISSING:
    'This trip has no coordinates for that point yet, so it cannot be confirmed against them. Ask Operations to enter the location.',
  LOCATION_REQUIRED: 'Confirming this milestone needs the handset’s current position.',
  INVALID_COORDINATES: 'The position sent is not a place on Earth.',
  ACCURACY_INSUFFICIENT:
    'The handset is not sure enough where it is. Move to open sky and try again.',
  LOCATION_STALE: 'That position is too old. Capture a fresh one and try again.',
  OUTSIDE_GEOFENCE: 'That position is not at the point being confirmed.',
};
