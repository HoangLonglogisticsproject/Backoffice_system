import type { UserSummary } from '../../../common/types/user-summary';

/**
 * A driver asking to run an open booking (0035).
 *
 * ★ A REQUEST IS NOT AN ASSIGNMENT. It grants the driver nothing: no trip, no
 * events, no money. Only Dispatch turns one into a `trip_driver_assignments`
 * row, choosing the lorry as it does — the same crew path direct dispatch uses.
 */
export const ASSIGNMENT_REQUEST_STATES = ['pending', 'approved', 'rejected', 'withdrawn', 'superseded'] as const;
export type AssignmentRequestState = (typeof ASSIGNMENT_REQUEST_STATES)[number];

/**
 * Why a pending request stopped being answerable — the booking stopped being
 * open under it. A fixed word, never prose (0035's CHECK).
 */
export const SUPERSEDE_REASONS = ['trip_assigned', 'trip_closed', 'trip_archived'] as const;
export type SupersedeReason = (typeof SUPERSEDE_REASONS)[number];

/** The `details` code on the 422 that refuses an ask on a booking that is not open. */
export const BOOKING_NOT_OPEN = 'BOOKING_NOT_OPEN';

export interface TripAssignmentRequest {
  id: string;
  tripId: string;
  driverUserId: string;
  state: AssignmentRequestState;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  approvedAssignmentId: string | null;
  /** A rejection's optional reason, or a `SupersedeReason`. */
  resolutionReason: string | null;
}

/** One end of a booking as a driver may see it before it is theirs: a name and an area. */
export interface OpenBookingPlace {
  name: string | null;
  /** Ward, district, province — whichever the place has. */
  area: string | null;
}

/**
 * ★ WHAT A DRIVER MAY KNOW ABOUT A BOOKING THAT IS NOT THEIRS — and the whole
 * of it. Enough to decide whether to ask: when, from where to where, what. No
 * customer, no contact, no address line, and nothing commercial: the query
 * that fills this never selects a price, a cost or a hire.
 */
export interface DriverOpenBooking {
  tripId: string;
  scheduledOn: string;
  scheduledPickupAt: Date | null;
  scheduledDeliveryAt: Date | null;
  pickup: OpenBookingPlace;
  delivery: OpenBookingPlace;
  cargoInfo: string | null;
  /** The one field written FOR drivers (`driverInstructions`, 0017). */
  driverInstructions: string | null;
}

/** An open booking in the list, with the caller's own pending ask on it, if any. */
export interface DriverOpenBookingItem extends DriverOpenBooking {
  myPendingRequestId: string | null;
}

/**
 * A driver's own request, as they see it. The booking is the same safe
 * projection, read now. Once approved, the trip itself is reached through the
 * assignment and its existing driver views — never through this.
 */
export interface DriverAssignmentRequestView {
  id: string;
  state: AssignmentRequestState;
  requestedAt: Date;
  resolvedAt: Date | null;
  /** Only when rejected, and only if Dispatch gave one. */
  rejectionReason: string | null;
  /** Only when superseded. */
  supersededBecause: SupersedeReason | null;
  /** Only when approved: the turn to open in "Chuyến của tôi". */
  assignmentId: string | null;
  booking: DriverOpenBooking;
}

/** A request as Dispatch reviews it. */
export interface DispatchAssignmentRequest {
  id: string;
  tripId: string;
  driver: UserSummary;
  state: AssignmentRequestState;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: UserSummary | null;
  approvedAssignmentId: string | null;
  resolutionReason: string | null;
}

/** The driver-facing reading of a stored request. */
export const requestForDriver = (
  request: TripAssignmentRequest,
  booking: DriverOpenBooking,
): DriverAssignmentRequestView => ({
  id: request.id,
  state: request.state,
  requestedAt: request.requestedAt,
  resolvedAt: request.resolvedAt,
  rejectionReason: request.state === 'rejected' ? request.resolutionReason : null,
  supersededBecause: request.state === 'superseded' ? asSupersedeReason(request.resolutionReason) : null,
  assignmentId: request.state === 'approved' ? request.approvedAssignmentId : null,
  booking,
});

const asSupersedeReason = (value: string | null): SupersedeReason | null =>
  SUPERSEDE_REASONS.find((reason) => reason === value) ?? null;
