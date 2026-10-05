import { Injectable } from '@nestjs/common';
import type { DatabaseQuery } from '../../../common/types/database.port';
import { NotificationService } from '../../notification/application/notification.service';
import { eventKeys, type Notification } from '../../notification/domain/notification';
import type { SupersedeReason } from '../domain/trip-assignment-request';
import type { TripSchedule } from '../domain/trip-schedule';
import { TripAssignmentRequestRepository } from '../persistence/trip-assignment-request.repository';

/**
 * ★ NO STALE "ĐANG CHỜ DUYỆT". Whatever takes a booking out of "open" — a
 * turn put on it (direct dispatch or an approval), the trip closed, the trip
 * archived — ends every pending ask on it in the same transaction, and each
 * driver who asked is told. One place, so no path can forget it.
 *
 * Called INSIDE the caller's transaction, AFTER its trip lock (lock order:
 * trip → request). The rows it returns go to `deliver` after COMMIT.
 */
@Injectable()
export class AssignmentRequestSupersession {
  constructor(
    private readonly requests: TripAssignmentRequestRepository,
    private readonly notifications: NotificationService,
  ) {}

  async supersede(
    trip: Pick<TripSchedule, 'id' | 'scheduledOn'>,
    input: { by: string; reason: SupersedeReason; except?: string | null },
    tx: DatabaseQuery,
  ): Promise<Array<Notification | null>> {
    const superseded = await this.requests.supersedePending(
      { tripId: trip.id, by: input.by, reason: input.reason, now: new Date(), except: input.except ?? null },
      tx,
    );
    const told: Array<Notification | null> = [];
    for (const request of superseded) {
      told.push(
        await this.notifications.record(
          {
            recipientUserId: request.driverUserId,
            type: 'ASSIGNMENT_REQUEST_SUPERSEDED',
            tripId: trip.id,
            tripScheduledOn: trip.scheduledOn,
            detail: input.reason,
            eventKey: eventKeys.requestSuperseded(request.id),
          },
          tx,
        ),
      );
    }
    return told;
  }

  /** After COMMIT: push what was written. */
  deliver(told: ReadonlyArray<Notification | null>): void {
    this.notifications.deliver(told);
  }
}
