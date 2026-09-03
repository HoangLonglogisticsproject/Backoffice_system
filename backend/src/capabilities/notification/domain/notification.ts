/**
 * What a driver is told.
 *
 * ★ A ROW FIRST, A SIGNAL SECOND. The notification is written inside the
 * transaction of the business change that caused it, and only then pushed to
 * whatever phone is listening. The row is the fact; the push is how the phone
 * hears about it quickly. A phone that was asleep reads the rows.
 *
 * ★ FOUR TYPES, AND EACH IS A REAL EVENT THAT ALREADY EXISTS. Nothing here is
 * invented for the sake of a bell icon: an assignment starts or ends, a
 * completion is sent back or approved. There is no per-expense rejection in the
 * lifecycle — a rejected completion reopens every line — so there is no
 * `EXPENSE_REJECTED`.
 */
export const NOTIFICATION_TYPES = [
  /** You are now driving this trip. */
  'TRIP_ASSIGNED',
  /** You are no longer driving this trip — replaced, or taken off. */
  'TRIP_UNASSIGNED',
  /** Your completion was sent back. `detail` carries why. */
  'COMPLETION_REJECTED',
  /** Your completion was approved; the trip is closed. */
  'COMPLETION_APPROVED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  tripId: string;
  /** The board day as it stood, `YYYY-MM-DD`. A snapshot — see 0020. */
  tripScheduledOn: string;
  /** A reviewer's reason, on a rejection. Never money. */
  detail: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationInput {
  recipientUserId: string;
  type: NotificationType;
  tripId: string;
  tripScheduledOn: string;
  detail?: string | null;
  /**
   * ★ SERVER-MINTED, FROM THE BUSINESS ROW. Same string on every retry of the
   * same change, so the unique index in 0020 can refuse the second row.
   */
  eventKey: string;
}

/**
 * What goes over the wire when a row is written. Ids and a type — enough for a
 * phone to know WHAT to re-read, and nothing it could act on without asking
 * the server. Never the row, never a trip.
 */
export interface NotificationSignal {
  id: string;
  type: NotificationType;
  tripId: string;
  createdAt: string;
}

export const signalOf = (notification: Notification): NotificationSignal => ({
  id: notification.id,
  type: notification.type,
  tripId: notification.tripId,
  createdAt: notification.createdAt.toISOString(),
});

/** The keys, spelled in one place so two services cannot spell one differently. */
export const eventKeys = {
  assigned: (assignmentId: string) => `assignment:${assignmentId}:assigned`,
  unassigned: (assignmentId: string) => `assignment:${assignmentId}:ended`,
  completionRejected: (requestId: string) => `completion:${requestId}:rejected`,
  completionApproved: (requestId: string) => `completion:${requestId}:approved`,
};
