/**
 * What the server keeps about what a person was told. Mirrors the backend row.
 *
 * ★ NO TEXT ARRIVES. The server stores a TYPE, a trip, the day of that trip
 * and at most a reviewer's reason; the sentence the driver reads is composed
 * here, in their language. Nothing commercial is in the row to leak.
 */
export const NOTIFICATION_TYPES = [
  'TRIP_ASSIGNED',
  'TRIP_UNASSIGNED',
  'COMPLETION_REJECTED',
  'COMPLETION_APPROVED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  tripId: string;
  /** `YYYY-MM-DD`, a snapshot of the board day when the event happened. */
  tripScheduledOn: string;
  /** A reviewer's reason on a rejection. */
  detail: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * What arrives over the live stream: enough to know WHAT to re-read, never
 * the thing itself. The API stays the authority on what may be seen now.
 */
export interface NotificationSignal {
  id: string;
  type: NotificationType;
  tripId: string;
  createdAt: string;
}
