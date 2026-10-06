import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { businessToday } from '../../../common/pagination/date-range-page-query.dto';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import {
  BOOKING_NOT_OPEN,
  requestForDriver,
  type DriverAssignmentRequestView,
  type DriverOpenBookingItem,
  type TripAssignmentRequest,
} from '../domain/trip-assignment-request';
import { OpenBookingRepository } from '../persistence/open-booking.repository';
import { TripAssignmentRequestRepository } from '../persistence/trip-assignment-request.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import { requireEligibleDriver } from './dispatch-eligibility';

/**
 * The driver's side of an open booking: see it, ask for it, take the ask back.
 *
 * ★ OWNERSHIP IS THE CALLER'S ID, NEVER THE BODY'S. Every method takes the
 * driver from the session; there is no way to ask, or withdraw, on somebody
 * else's behalf, so there is nothing to refuse.
 *
 * ★ NOTHING HERE ASSIGNS. An ask is a row in `trip_assignment_requests`; the
 * trip, its events and its money stay behind `ActiveAssignmentGuard` until
 * Dispatch approves and a turn exists.
 */
@Injectable()
export class DriverAssignmentRequestService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly bookings: OpenBookingRepository,
    private readonly requests: TripAssignmentRequestRepository,
    private readonly users: UserRepository,
  ) {}

  /** Bookings open from today on the business calendar — not the handset's. */
  listOpenBookings(driverUserId: string, now = new Date()): Promise<DriverOpenBookingItem[]> {
    return this.bookings.listOpen(driverUserId, businessToday(now));
  }

  async listMine(driverUserId: string): Promise<DriverAssignmentRequestView[]> {
    const rows = await this.bookings.listRequestsOf(driverUserId);
    return rows.map(({ request, booking }) => requestForDriver(request, booking));
  }

  /**
   * Asks for an open booking. ★ IDEMPOTENT: a double tap, a retry or a second
   * tab gets the SAME pending request back (0035's partial unique index).
   *
   * Lock order: trip → request — the order approval and direct dispatch take,
   * so an ask cannot slip onto a booking a turn was just put on.
   */
  async request(tripId: string, driverUserId: string): Promise<DriverAssignmentRequestView> {
    return this.db.transaction(async (tx) => {
      // A missing trip and a trip that is not open answer the same: a driver
      // probing ids learns nothing about bookings that are not theirs to see.
      const trip = await this.trips.lockActive(tripId, tx);
      const booking = trip ? await this.bookings.findOpen(tripId, tx) : null;
      if (!booking) throw notOpen();

      await requireEligibleDriver(this.users, driverUserId, tx);
      const request = await this.requests.create(tripId, driverUserId, tx);
      return requestForDriver(request, booking);
    });
  }

  /** Takes a PENDING ask back. A decided one is decided: 409. */
  async withdraw(requestId: string, driverUserId: string): Promise<DriverAssignmentRequestView> {
    const owned = await this.requests.findById(requestId);
    // Somebody else's request answers exactly as one that does not exist.
    if (owned?.driverUserId !== driverUserId) throw new NotFoundError('Request not found.');

    return this.db.transaction(async (tx) => {
      // Trip first, as every writer does. An archived trip has no lock to take
      // — and no pending ask either: archiving superseded it.
      await this.trips.lockActive(owned.tripId, tx);
      const withdrawn = await this.requests.resolve(
        { id: owned.id, state: 'withdrawn', by: driverUserId, now: new Date() },
        tx,
      );
      if (!withdrawn) throw new ConflictError('That request is no longer pending.');
      return this.view(withdrawn, tx);
    });
  }

  private async view(request: TripAssignmentRequest, tx: DatabaseQuery): Promise<DriverAssignmentRequestView> {
    const booking = await this.bookings.findBooking(request.tripId, tx);
    if (!booking) throw new Error(`trip_assignment_requests ${request.id}: its trip disappeared`);
    return requestForDriver(request, booking);
  }
}

const notOpen = (): ValidationError =>
  new ValidationError('That booking is no longer open.', { booking: BOOKING_NOT_OPEN });
