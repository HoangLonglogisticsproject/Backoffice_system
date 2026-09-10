import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  accountabilityOf,
  type CompletionRequest,
  type ExpenseAccountability,
  type ExpenseDeclaration,
} from '../domain/trip-execution';
import type { TripSchedule } from '../domain/trip-schedule';
import { TripCostRepository } from '../persistence/trip-cost.repository';
import {
  CompletionRequestRepository,
  DriverAssignmentRepository,
} from '../persistence/trip-execution.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../persistence/trip-status-history.repository';
import { NotificationService } from '../../notification/application/notification.service';
import { eventKeys } from '../../notification/domain/notification';

/**
 * How a turn ends, and how the trip ends after it.
 *
 * ★ TWO DIFFERENT THINGS (ADR-0004). A driver asks for THEIR ASSIGNMENT to be
 * closed; a SuperAdmin decides; approval freezes THAT assignment's money. The
 * TRIP closes — status, stamp, history — only when every active assignment on
 * it has been approved, and it closes inside the transaction of the approval
 * that made that true. Approving one lorry of three changes nothing about the
 * trip and nothing about the other two drivers' figures.
 *
 * ★ EVERY DECISION HERE IS ONE TRANSACTION, AND THAT IS THE WHOLE DESIGN.
 * Approving the last turn touches four things — the request, the trip's
 * status, the trip's closing stamp, and the assignment's cost lines. Any subset
 * of those committing without the rest leaves a trip that is closed but still
 * editable, or final but with no record of who closed it. There is no
 * compensating action available afterwards, because 0025 makes `finished`
 * terminal.
 */
@Injectable()
export class TripCompletionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly assignments: DriverAssignmentRepository,
    private readonly requests: CompletionRequestRepository,
    private readonly costs: TripCostRepository,
    private readonly history: TripStatusHistoryRepository,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * The driver asks for their assignment to be closed.
   *
   * ★ SUBMITTING LOCKS THIS ASSIGNMENT'S MONEY, IN THE SAME TRANSACTION. The
   * figures under review must not move while somebody is reviewing them — an
   * approver looking at a total that changes underneath is approving something
   * that no longer exists. Locking is TEMPORARY: a rejection reopens every
   * line. And it is THIS turn's lines only: another driver's lorry on the same
   * trip keeps typing (ADR-0004).
   *
   * ★ WHAT IS DELIBERATELY NOT CHECKED HERE: that the four execution events have
   * been reported. The ordinary flow reports them first, and a turn submitted
   * without them shows up as stuck in the read model — but no rule says the
   * submission must be REFUSED, and inventing one would block a real trip whose
   * driver lost signal at the delivery point.
   */
  async submit(
    assignmentId: string,
    submittedBy: string,
    expenseDeclaration: ExpenseDeclaration,
  ): Promise<CompletionRequest> {
    // Unlocked, and only for the trip id: everything that decides is re-read
    // under the locks below, in the order trip → assignment → request → cost.
    const named = await this.assignments.findActiveById(assignmentId);
    if (!named) throw new NotFoundError('Assignment not found.');

    return this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(named.tripId, tx);

      const assignment = await this.assignments.lockActiveById(assignmentId, tx);
      if (!assignment) throw new ConflictError('That assignment is no longer active.');
      if (assignment.driverUserId !== submittedBy) {
        throw new ConflictError('Only the driver on an assignment may ask for it to be closed.');
      }

      // A readable 409 for the ordinary double tap.
      // `uq_assignment_completion_pending` is what actually holds the rule for
      // two taps that arrive together.
      const pending = await this.requests.lockPendingByAssignment(assignment.id, tx);
      if (pending) throw new ConflictError('That assignment already has a completion request waiting.');

      // ★ THE DECLARATION HAS TO AGREE WITH WHAT THE DRIVER ENTERED ON THIS TURN.
      //
      // Both halves come from the same person, so a disagreement is not a
      // difference of opinion — it is a mistake, and one that makes the two
      // read-model states below meaningless. Saying "nothing to claim" with
      // three fuel lines on the turn would leave a dashboard unable to say
      // which of the two it actually is.
      //
      // ⚠ THIS IS THE ONE PLACE WHERE A CHECK CROSSES TWO TABLES, so no CHECK
      // constraint can hold it — the database has no way to see the cost lines
      // from the request row. It is held here, inside the transaction, with the
      // trip locked so no line can arrive between the count and the insert.
      const live = await this.costs.listActiveByAssignment(assignment.id, tx);
      if (expenseDeclaration === 'none' && live.length > 0) {
        throw new ConflictError(
          'This assignment has expenses recorded on it. Withdraw them first, or declare that there were expenses.',
        );
      }
      if (expenseDeclaration === 'expenses' && live.length === 0) {
        throw new ConflictError(
          'No expenses have been recorded on this assignment. Enter them first, or declare that there were none.',
        );
      }

      const request = await this.requests.submit(
        { tripId: trip.id, driverAssignmentId: assignment.id, submittedBy, expenseDeclaration },
        tx,
      );

      await this.costs.lockForAssignment(assignment.id, submittedBy, new Date(), tx);

      return request;
    });
  }

  /**
   * The SuperAdmin approves one turn — and, if it was the last one open, the
   * trip is over.
   *
   * One transaction, in this order:
   *
   *   1. the trip is locked (`FOR UPDATE`) — the serialisation point for every
   *      approval on the trip, so two approvers of two different turns run one
   *      after the other and the second sees what the first wrote
   *   2. the request is locked and must still be `pending`
   *   3. the request becomes `approved`
   *   4. THIS assignment's live cost lines become `immutable` — nobody else's
   *   5. the trip is asked whether any ACTIVE assignment is still unapproved
   *   6. if none is: status `finished` (0025 makes it irreversible), one history
   *      row, the closing stamp — exactly once, because only the transaction
   *      that observed the last approval reaches this branch
   *
   * ★ ORDER MATTERS FOR ONE OF THEM. The money is frozen BEFORE the trip is
   * marked done, so there is no instant at which a closed trip still has an
   * editable figure on an approved turn.
   */
  async approve(tripId: string, requestId: string, decidedBy: string): Promise<CompletionRequest> {
    const { decided, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const pending = await this.lockPendingOnTrip(tripId, requestId, tx);

      const decided = await this.requests.decide(
        { id: pending.id, state: 'approved', decidedBy, reason: null, now: new Date() },
        tx,
      );
      // The row was locked one statement ago, so an empty result is a second
      // approver that got there first rather than a missing row.
      if (!decided) throw new ConflictError('That request has already been decided.');

      await this.costs.finalizeForAssignment(pending.driverAssignmentId, tx);

      if (!(await this.requests.hasUnapprovedActiveAssignment(tripId, tx))) {
        await this.finishTrip(trip, decidedBy, tx);
      }

      // ★ THE PERSON WHO ASKED, read off the request. Never "whoever is on the
      // trip now": with several turns on one trip that is several people, and
      // with none it is nobody.
      const told = await this.notifications.record(
        {
          recipientUserId: pending.submittedBy,
          type: 'COMPLETION_APPROVED',
          tripId,
          tripScheduledOn: trip.scheduledOn,
          eventKey: eventKeys.completionApproved(pending.id),
        },
        tx,
      );

      return { decided, told };
    });

    this.notifications.deliver([told]);
    return decided;
  }

  /**
   * The SuperAdmin sends one turn back.
   *
   * ★ THE REASON IS MANDATORY, HERE AND IN THE DATABASE. A driver told only
   * "rejected" has nothing to act on. Two existing approval flows in this
   * codebase collect a reason in the UI and discard it in the API — documented
   * product debt this one deliberately does not repeat.
   *
   * ★ AND REJECTION REOPENS THIS ASSIGNMENT'S MONEY. The lines were frozen for
   * the review, not finalised by it: the driver has to be able to correct the
   * figure that caused the rejection. The trip's status is untouched, because
   * it never moved; the other turns on the trip are untouched, because they
   * were never this request's.
   */
  async reject(
    tripId: string,
    requestId: string,
    input: { by: string; reason: string },
  ): Promise<CompletionRequest> {
    const reason = input.reason.trim();
    if (reason === '') {
      throw new ValidationError('Sending a completion back needs a reason the driver can act on.');
    }

    const { decided, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const pending = await this.lockPendingOnTrip(tripId, requestId, tx);

      const decided = await this.requests.decide(
        { id: pending.id, state: 'rejected', decidedBy: input.by, reason, now: new Date() },
        tx,
      );
      if (!decided) throw new ConflictError('That request has already been decided.');

      await this.costs.unlockForAssignment(pending.driverAssignmentId, tx);

      // ★ WITH THE REASON, TO THE PERSON WHO ASKED. A driver told only
      // "rejected" has nothing to act on — the whole argument 0017 makes for
      // the column this is read from.
      const told = await this.notifications.record(
        {
          recipientUserId: pending.submittedBy,
          type: 'COMPLETION_REJECTED',
          tripId,
          tripScheduledOn: trip.scheduledOn,
          detail: reason,
          eventKey: eventKeys.completionRejected(pending.id),
        },
        tx,
      );

      return { decided, told };
    });

    this.notifications.deliver([told]);
    return decided;
  }

  /** Every attempt on the trip, across all its assignments, newest first — including the rejected ones and why. */
  async listRequests(tripId: string): Promise<CompletionRequest[]> {
    if (!(await this.trips.exists(tripId))) throw new NotFoundError('Trip not found.');
    return this.requests.listByTrip(tripId);
  }

  /**
   * The request named in the route, locked, PROVEN to be on the trip in the
   * route, and still pending. A request on another trip answers exactly as a
   * request that does not exist: a caller holding one trip's id must not reach
   * another trip's review by pairing it with a foreign request id.
   */
  private async lockPendingOnTrip(
    tripId: string,
    requestId: string,
    tx: DatabaseQuery,
  ): Promise<CompletionRequest> {
    const request = await this.requests.lockById(requestId, tx);
    if (request?.tripId !== tripId) {
      throw new NotFoundError('Completion request not found.');
    }
    if (request.state !== 'pending') {
      throw new ConflictError('That request has already been decided.');
    }
    return request;
  }

  /**
   * Closes the trip: status, history, stamp — together, once.
   *
   * ★ THE ONLY WRITER OF `finished` IN THE CODEBASE, as it has always been.
   * Reached only from `approve`, under the trip lock, after the last active
   * assignment's approval was written — so two approvals racing on two turns
   * of one trip arrive here one at a time, and only the one that observed
   * "nothing left unapproved" gets in. `markClosed` is `WHERE closed_at IS
   * NULL` as a second line.
   */
  private async finishTrip(trip: TripSchedule, decidedBy: string, tx: DatabaseQuery): Promise<void> {
    const closed = await this.trips.updateStatus(trip.id, 'finished', tx);
    if (!closed) throw new Error('Locked trip disappeared during completion.');

    await this.history.record(
      {
        tripId: trip.id,
        from: trip.status,
        to: 'finished',
        reason: 'All assignments approved.',
        changedBy: decidedBy,
      },
      tx,
    );
    await this.trips.markClosed(trip.id, decidedBy, new Date(), tx);
  }

  /**
   * Where the trip stands on accounting for its money.
   *
   * ★ COMPUTED ON READ, NEVER STORED. It is a function of the completion
   * history and nothing else, so a stored copy could only ever disagree with
   * the rows it was derived from.
   */
  async accountability(tripId: string): Promise<ExpenseAccountability> {
    return accountabilityOf(await this.listRequests(tripId));
  }

  /**
   * Locks the trip and refuses a closed one.
   *
   * ★ THIS IS WHAT MAKES APPROVAL TERMINAL IN THE APPLICATION. The database says
   * the same thing twice more — `uq_trip_completion_approved` allows one
   * approval ever, and 0025's trigger refuses to move a trip out of `finished` — but
   * both of those surface as a 500. Said here, a second attempt is a 409 that
   * explains itself.
   */
  private async lockOpenTrip(tripId: string, tx: DatabaseQuery): Promise<TripSchedule> {
    const trip = await this.trips.lockActive(tripId, tx);
    if (!trip) throw new NotFoundError('Trip not found.');
    if (trip.status === 'finished') throw new ConflictError('That trip is already closed.');
    return trip;
  }
}
