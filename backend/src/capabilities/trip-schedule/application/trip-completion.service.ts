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
 * How a trip ends.
 *
 * A driver asks; a SuperAdmin decides; approval closes the trip permanently and
 * freezes its money. Three tables move together at that moment, and this is the
 * only place that moves them.
 *
 * ★ EVERY DECISION HERE IS ONE TRANSACTION, AND THAT IS THE WHOLE DESIGN.
 * Approving touches four things — the request, the trip's status, the trip's
 * closing stamp, and every cost line on it. Any subset of those committing
 * without the rest leaves a trip that is closed but still editable, or final but
 * with no record of who closed it. There is no compensating action available
 * afterwards, because 0017 makes `done` terminal.
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
   * The driver asks for the trip to be closed.
   *
   * ★ SUBMITTING LOCKS THE MONEY, IN THE SAME TRANSACTION. The figures under
   * review must not move while somebody is reviewing them — an approver looking
   * at a total that changes underneath is approving something that no longer
   * exists. Locking is TEMPORARY: a rejection reopens every line.
   *
   * ★ WHAT IS DELIBERATELY NOT CHECKED HERE: that the four execution events have
   * been reported. The ordinary flow reports them first, and a trip submitted
   * without them shows up as a stuck trip in the read model — but no rule says
   * the submission must be REFUSED, and inventing one would block a real trip
   * whose driver lost signal at the delivery point.
   */
  async submit(
    tripId: string,
    submittedBy: string,
    expenseDeclaration: ExpenseDeclaration,
  ): Promise<CompletionRequest> {
    return this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const assignment = await this.assignments.lockActive(tripId, tx);
      if (!assignment) {
        throw new ConflictError('That trip has no driver, so there is nothing to complete.');
      }
      if (assignment.driverUserId !== submittedBy) {
        throw new ConflictError('Only the driver assigned to a trip may ask for it to be closed.');
      }

      // A readable 409 for the ordinary double tap. `uq_trip_completion_pending`
      // is what actually holds the rule for two taps that arrive together.
      const pending = await this.requests.lockPending(tripId, tx);
      if (pending) throw new ConflictError('That trip already has a completion request waiting.');

      // ★ THE DECLARATION HAS TO AGREE WITH WHAT THE DRIVER ENTERED.
      //
      // Both halves come from the same person, so a disagreement is not a
      // difference of opinion — it is a mistake, and one that makes the two
      // read-model states below meaningless. Saying "nothing to claim" with
      // three fuel lines on the trip would leave a dashboard unable to say
      // which of the two the trip actually is.
      //
      // ⚠ THIS IS THE ONE PLACE WHERE A CHECK CROSSES TWO TABLES, so no CHECK
      // constraint can hold it — the database has no way to see the cost lines
      // from the request row. It is held here, inside the transaction, with the
      // trip locked so no line can arrive between the count and the insert.
      const live = await this.costs.listActiveByTrip(tripId, tx);
      if (expenseDeclaration === 'none' && live.length > 0) {
        throw new ConflictError(
          'This trip has expenses recorded on it. Withdraw them first, or declare that there were expenses.',
        );
      }
      if (expenseDeclaration === 'expenses' && live.length === 0) {
        throw new ConflictError(
          'No expenses have been recorded on this trip. Enter them first, or declare that there were none.',
        );
      }

      const request = await this.requests.submit(
        { tripId: trip.id, driverAssignmentId: assignment.id, submittedBy, expenseDeclaration },
        tx,
      );

      await this.costs.lockForTrip(tripId, submittedBy, new Date(), tx);

      return request;
    });
  }

  /**
   * The SuperAdmin approves, and the trip is over.
   *
   * Four writes, one transaction:
   *
   *   1. the request becomes `approved`
   *   2. every live cost line becomes `immutable`
   *   3. the trip's status becomes `done` — which 0017 makes irreversible
   *   4. the move is recorded, and the trip stamped with who closed it
   *
   * ★ ORDER MATTERS FOR ONE OF THEM. The money is frozen BEFORE the trip is
   * marked done, so there is no instant at which a closed trip still has an
   * editable figure on it.
   */
  async approve(tripId: string, decidedBy: string): Promise<CompletionRequest> {
    const { decided, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const pending = await this.requests.lockPending(tripId, tx);
      if (!pending) throw new ConflictError('That trip has no completion request waiting.');

      const decided = await this.requests.decide(
        { id: pending.id, state: 'approved', decidedBy, reason: null, now: new Date() },
        tx,
      );
      // The row was locked one statement ago, so an empty result is a second
      // approver that got there first rather than a missing row.
      if (!decided) throw new ConflictError('That request has already been decided.');

      await this.costs.finalizeForTrip(tripId, tx);

      const closed = await this.trips.updateStatus(tripId, 'done', tx);
      if (!closed) throw new Error('Locked trip disappeared during completion.');

      const now = new Date();
      await this.history.record(
        {
          tripId,
          from: trip.status,
          to: 'done',
          reason: 'Completion approved.',
          changedBy: decidedBy,
        },
        tx,
      );
      await this.trips.markClosed(tripId, decidedBy, now, tx);

      // The driver on the trip now — or, if nobody is, the one who asked.
      const driver = await this.assignments.findActive(tripId, tx);
      const told = await this.notifications.record(
        {
          recipientUserId: driver?.driverUserId ?? pending.submittedBy,
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
   * The SuperAdmin sends it back.
   *
   * ★ THE REASON IS MANDATORY, HERE AND IN THE DATABASE. A driver told only
   * "rejected" has nothing to act on. Two existing approval flows in this
   * codebase collect a reason in the UI and discard it in the API — documented
   * product debt this one deliberately does not repeat.
   *
   * ★ AND REJECTION REOPENS THE MONEY. The lines were frozen for the review, not
   * finalised by it: the driver has to be able to correct the figure that caused
   * the rejection. The trip's status is untouched, because it never moved.
   */
  async reject(
    tripId: string,
    input: { by: string; reason: string },
  ): Promise<CompletionRequest> {
    const reason = input.reason.trim();
    if (reason === '') {
      throw new ValidationError('Sending a completion back needs a reason the driver can act on.');
    }

    const { decided, told } = await this.db.transaction(async (tx) => {
      const trip = await this.lockOpenTrip(tripId, tx);

      const pending = await this.requests.lockPending(tripId, tx);
      if (!pending) throw new ConflictError('That trip has no completion request waiting.');

      const decided = await this.requests.decide(
        { id: pending.id, state: 'rejected', decidedBy: input.by, reason, now: new Date() },
        tx,
      );
      if (!decided) throw new ConflictError('That request has already been decided.');

      await this.costs.unlockForTrip(tripId, tx);

      // ★ WITH THE REASON. A driver told only "rejected" has nothing to act on
      // — the whole argument 0017 makes for the column this is read from.
      const driver = await this.assignments.findActive(tripId, tx);
      const told = await this.notifications.record(
        {
          recipientUserId: driver?.driverUserId ?? pending.submittedBy,
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

  /** Every attempt, newest first — including the rejected ones and why. */
  async listRequests(tripId: string): Promise<CompletionRequest[]> {
    if (!(await this.trips.exists(tripId))) throw new NotFoundError('Trip not found.');
    return this.requests.listByTrip(tripId);
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
   * approval ever, and 0017's trigger refuses to move a trip out of `done` — but
   * both of those surface as a 500. Said here, a second attempt is a 409 that
   * explains itself.
   */
  private async lockOpenTrip(tripId: string, tx: DatabaseQuery): Promise<TripSchedule> {
    const trip = await this.trips.lockActive(tripId, tx);
    if (!trip) throw new NotFoundError('Trip not found.');
    if (trip.status === 'done') throw new ConflictError('That trip is already closed.');
    return trip;
  }
}
