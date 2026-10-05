import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import { NotificationService } from '../../notification/application/notification.service';
import {
  eventKeys,
  type Notification,
  type NotificationInput,
  type NotificationType,
} from '../../notification/domain/notification';
import type { DriverAssignment } from '../domain/trip-execution';
import type { TripSchedule } from '../domain/trip-schedule';
import { TripVehicleRepository } from '../persistence/trip-catalogue.repository';
import { DriverAssignmentRepository } from '../persistence/trip-execution.repository';
import { AssignmentRequestSupersession } from './assignment-request-supersession';
import { requireDispatchableVehicle, requireEligibleDriver } from './dispatch-eligibility';

/**
 * ★ THE ONE PATH THAT PUTS A LORRY AND ITS DRIVER ON A LIVE TRIP. Direct
 * dispatch (`TripExecutionService.assign`) and an approved driver request
 * (`AssignmentRequestReviewService.approve`) both come through here, inside
 * their own transaction and AFTER their trip lock — so there is one set of
 * rules about who and what may be crewed, not two.
 *
 * Lock order: trip (the caller's) → the lorry's active turn on this trip →
 * insert → the pending asks on the trip. The same order every trip write
 * follows, so nothing here can deadlock against execution, fuel or completion.
 */
@Injectable()
export class DispatchCrew {
  constructor(
    private readonly assignments: DriverAssignmentRepository,
    private readonly vehicles: TripVehicleRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationService,
    private readonly supersession: AssignmentRequestSupersession,
  ) {}

  /**
   * Crews a LOCKED, open trip. `approving` names the request this crew answers:
   * it is left for its caller to mark approved, and every OTHER pending ask on
   * the trip is superseded — a booking with a turn on it is no longer open.
   */
  async crew(
    trip: TripSchedule,
    input: { vehicleId: string; driverUserId: string },
    assignedBy: string,
    tx: DatabaseQuery,
    approving: string | null = null,
  ): Promise<{ assignment: DriverAssignment; told: Array<Notification | null> }> {
    await requireDispatchableVehicle(this.vehicles, input.vehicleId, tx);
    // A readable 409 for a lorry already on this trip; the lock serialises two
    // operators adding the same one, and `uq_trip_active_vehicle_assignment`
    // catches the pair that still collide.
    if (await this.assignments.lockActiveByVehicle(trip.id, input.vehicleId, tx)) {
      throw new ConflictError(
        'That vehicle is already dispatched on this trip. Replace its driver or end that assignment instead.',
      );
    }
    await requireEligibleDriver(this.users, input.driverUserId, tx);

    const assignment = await this.assignments.assign(
      { tripId: trip.id, vehicleId: input.vehicleId, driverUserId: input.driverUserId, assignedBy },
      tx,
    );

    // ★ THE NOTIFICATION IS PART OF THE SAME TRANSACTION, keyed by the
    // assignment row, so it exists exactly when the assignment does.
    const told = [await this.notifications.record(tell('TRIP_ASSIGNED', trip, assignment), tx)];
    told.push(...(await this.supersession.supersede(trip, { by: assignedBy, reason: 'trip_assigned', except: approving }, tx)));
    return { assignment, told };
  }
}

/** What a driver is told about their own turn starting or ending. */
export const tell = (
  type: NotificationType,
  trip: TripSchedule,
  assignment: DriverAssignment,
): NotificationInput => ({
  recipientUserId: assignment.driverUserId,
  type,
  tripId: trip.id,
  tripScheduledOn: trip.scheduledOn,
  detail: assignment.vehicle?.plate ?? null,
  eventKey:
    type === 'TRIP_ASSIGNED' ? eventKeys.assigned(assignment.id) : eventKeys.unassigned(assignment.id),
});
