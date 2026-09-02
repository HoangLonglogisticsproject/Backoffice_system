import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/errors/domain.error';
import type { DriverTrip, DriverTripDetail } from '../domain/driver-read-model';
import { accountabilityOf } from '../domain/trip-execution';
import { DriverTripReadModelRepository } from '../persistence/driver-read-model.repository';
import { TripCostRepository } from '../persistence/trip-cost.repository';
import {
  CompletionRequestRepository,
  ExecutionEventRepository,
} from '../persistence/trip-execution.repository';

/**
 * What the Driver Portal reads.
 *
 * ★ A SEPARATE SERVICE FROM THE ONES THAT WRITE, AND THAT IS THE WHOLE POINT.
 * `TripScheduleService` answers "what is on the board" for Operations, and its
 * answer is the whole row. Reusing it for the driver and trimming the result
 * afterwards is the blacklist mistake — it works until somebody adds a column.
 * This service can only assemble the fields `DriverTrip` declares, because the
 * repository it reads from cannot produce any others.
 *
 * ★ EVERY METHOD TAKES THE DRIVER'S ID, AND IT COMES FROM THE SESSION.
 * `ActiveAssignmentGuard` has already refused a caller who is not the assigned
 * driver, so the id passed here is redundant — deliberately. The queries filter
 * on it as well, so a route that ever loses its guard returns nothing rather
 * than somebody else's trip.
 */
@Injectable()
export class DriverPortalService {
  constructor(
    private readonly trips: DriverTripReadModelRepository,
    private readonly events: ExecutionEventRepository,
    private readonly costs: TripCostRepository,
    private readonly requests: CompletionRequestRepository,
  ) {}

  /** The trips this driver is on right now. */
  async listMyTrips(driverUserId: string): Promise<DriverTrip[]> {
    return this.trips.listForDriver(driverUserId);
  }

  /**
   * One trip, with everything the driver needs to work on it.
   *
   * ★ FOUR READS RATHER THAN ONE JOIN. A single statement would need three
   * `LEFT JOIN`s onto rows that are one-to-many, and the result would be a
   * cartesian product to unpick in JavaScript — three events and two expenses
   * arriving as six rows. Each list is bounded small (ADR-0002 §4), so four
   * indexed reads are both cheaper to run and far cheaper to read.
   *
   * ⚠ NOT ONE TRANSACTION, AND IT DOES NOT NEED TO BE. This is a screen, not a
   * decision: a figure that changes between two of these reads is a figure the
   * driver would have seen change a second later anyway. Every write path that
   * DOES depend on consistency takes its own lock.
   */
  async findMyTrip(tripId: string, driverUserId: string): Promise<DriverTripDetail> {
    const trip = await this.trips.findForDriver(tripId, driverUserId);
    // A trip that exists but belongs to somebody else answers exactly as a trip
    // that does not exist. The guard has already refused this caller, so
    // reaching here means the assignment ended between the two — but the
    // reasoning holds either way: "not found" tells them nothing about work
    // that is not theirs.
    if (!trip) throw new NotFoundError('Trip not found.');

    const [events, expenses, requests] = await Promise.all([
      this.events.listByTrip(tripId),
      this.costs.listDeclaredByDriver(tripId, driverUserId),
      this.requests.listByTrip(tripId),
    ]);

    return {
      ...trip,
      events,
      expenses,
      accountability: accountabilityOf(requests),
      // Newest attempt only. The full history is an Operations screen; a driver
      // needs the one they have to act on.
      completion: requests[0] ?? null,
    };
  }
}
