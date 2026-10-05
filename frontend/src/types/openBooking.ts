import type { UserSummary } from './organization';

/**
 * Open bookings and drivers' asks for them (0035). Mirrors the backend.
 *
 * ★ A REQUEST IS NOT AN ASSIGNMENT. Until Dispatch approves one — choosing the
 * lorry — the driver holds nothing on the trip; the approved trip is reached
 * through `assignmentId` and the existing driver views, never through these.
 */
export const ASSIGNMENT_REQUEST_STATES = ['pending', 'approved', 'rejected', 'withdrawn', 'superseded'] as const;
export type AssignmentRequestState = (typeof ASSIGNMENT_REQUEST_STATES)[number];

/** Why a pending ask stopped being answerable — the fixed word the server stores. */
export type SupersedeReason = 'trip_assigned' | 'trip_closed' | 'trip_archived';

/** One end of a booking before it is the driver's: a place name and its area. */
export interface OpenBookingPlace {
  name: string | null;
  area: string | null;
}

/** ★ THE WHOLE OF WHAT A DRIVER SEES OF A BOOKING THAT IS NOT THEIRS. No price, no customer, no contact. */
export interface DriverOpenBooking {
  tripId: string;
  /** `YYYY-MM-DD` — a calendar day, never an instant. */
  scheduledOn: string;
  scheduledPickupAt: string | null;
  scheduledDeliveryAt: string | null;
  pickup: OpenBookingPlace;
  delivery: OpenBookingPlace;
  cargoInfo: string | null;
  driverInstructions: string | null;
}

export interface DriverOpenBookingItem extends DriverOpenBooking {
  /** The caller's own pending ask on it, if any. */
  myPendingRequestId: string | null;
}

export interface DriverAssignmentRequest {
  id: string;
  state: AssignmentRequestState;
  requestedAt: string;
  resolvedAt: string | null;
  rejectionReason: string | null;
  supersededBecause: SupersedeReason | null;
  /** Only when approved: the turn, opened in "Chuyến của tôi". */
  assignmentId: string | null;
  booking: DriverOpenBooking;
}

/** An ask as Dispatch reviews it. */
export interface DispatchAssignmentRequest {
  id: string;
  tripId: string;
  driver: UserSummary;
  state: AssignmentRequestState;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: UserSummary | null;
  approvedAssignmentId: string | null;
  resolutionReason: string | null;
}
