import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { NotificationService } from '../../notification/application/notification.service';
import { eventKeys } from '../../notification/domain/notification';
import {
  BOOKING_NOT_OPEN,
  type DispatchAssignmentRequest,
  type TripAssignmentRequest,
} from '../domain/trip-assignment-request';
import { OpenBookingRepository } from '../persistence/open-booking.repository';
import { TripAssignmentRequestRepository } from '../persistence/trip-assignment-request.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import { DispatchCrew } from './dispatch-crew';

/**
 * Dispatch deciding drivers' asks (`dispatch.write`, decided at the route).
 *
 * ★ APPROVAL IS DISPATCH, NOT A SECOND ENGINE. Approving puts the asking
 * driver on the trip with the lorry Dispatch chooses, through `DispatchCrew` —
 * the same rules, lock order and notification as a direct assignment — and
 * every other pending ask on the booking is superseded in that transaction.
 *
 * Lock order, everywhere here: trip → request → (crew: lorry turn → insert →
 * other asks). Two approvers, an approval and a direct dispatch, a withdrawal
 * and an approval — all queue on the trip row, and the second finds the first's
 * outcome: its request no longer pending (409), or the booking no longer open.
 */
@Injectable()
export class AssignmentRequestReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly bookings: OpenBookingRepository,
    private readonly requests: TripAssignmentRequestRepository,
    private readonly crew: DispatchCrew,
    private readonly notifications: NotificationService,
  ) {}

  /** Every ask still waiting — the "N tài xế xin nhận" on Lịch xe. */
  listPending(): Promise<DispatchAssignmentRequest[]> {
    return this.requests.listPending();
  }

  async listForTrip(tripId: string): Promise<DispatchAssignmentRequest[]> {
    if (!(await this.trips.exists(tripId))) throw new NotFoundError('Trip not found.');
    return this.requests.listByTrip(tripId);
  }

  /** Puts the asking driver on the booking with `vehicleId`. Phase 1: only while nobody is on it. */
  async approve(
    tripId: string,
    requestId: string,
    vehicleId: string,
    approvedBy: string,
  ): Promise<TripAssignmentRequest> {
    const { approved, told } = await this.db.transaction(async (tx) => {
      const trip = await this.trips.lockActive(tripId, tx);
      if (!trip) throw new NotFoundError('Trip not found.');
      const pending = await this.lockPendingOnTrip(tripId, requestId, tx);
      if (!(await this.bookings.findOpen(tripId, tx))) {
        throw new ValidationError('That booking is no longer open.', { booking: BOOKING_NOT_OPEN });
      }

      const { assignment, told } = await this.crew.crew(
        trip,
        { vehicleId, driverUserId: pending.driverUserId },
        approvedBy,
        tx,
        pending.id,
      );
      const approved = await this.requests.resolve(
        { id: pending.id, state: 'approved', by: approvedBy, now: new Date(), assignmentId: assignment.id },
        tx,
      );
      // Locked two statements ago and pending then; nothing else may resolve it.
      if (!approved) throw new Error(`trip_assignment_requests ${pending.id}: lost its pending state under lock`);
      return { approved, told };
    });

    this.notifications.deliver(told);
    return approved;
  }

  /** Declines one ask, optionally saying why. The booking stays open for others. */
  async reject(
    tripId: string,
    requestId: string,
    reason: string | null,
    rejectedBy: string,
  ): Promise<TripAssignmentRequest> {
    const why = reason?.trim() ? reason.trim() : null;
    const { rejected, told } = await this.db.transaction(async (tx) => {
      const trip = await this.trips.lockActive(tripId, tx);
      if (!trip) throw new NotFoundError('Trip not found.');
      const pending = await this.lockPendingOnTrip(tripId, requestId, tx);

      const rejected = await this.requests.resolve(
        { id: pending.id, state: 'rejected', by: rejectedBy, now: new Date(), reason: why },
        tx,
      );
      if (!rejected) throw new Error(`trip_assignment_requests ${pending.id}: lost its pending state under lock`);
      const told = await this.notifications.record(
        {
          recipientUserId: pending.driverUserId,
          type: 'ASSIGNMENT_REQUEST_REJECTED',
          tripId: trip.id,
          tripScheduledOn: trip.scheduledOn,
          detail: why,
          eventKey: eventKeys.requestRejected(pending.id),
        },
        tx,
      );
      return { rejected, told: [told] };
    });

    this.notifications.deliver(told);
    return rejected;
  }

  /**
   * The request named in the route, locked, PROVEN to be on the trip in the
   * route, and still pending. One on another trip answers as one that does not
   * exist, so a trip id cannot be paired with a foreign request.
   */
  private async lockPendingOnTrip(tripId: string, requestId: string, tx: DatabaseQuery): Promise<TripAssignmentRequest> {
    const request = await this.requests.lockById(requestId, tx);
    if (request?.tripId !== tripId) throw new NotFoundError('Request not found.');
    if (request.state !== 'pending') throw new ConflictError('That request has already been resolved.');
    return request;
  }
}
