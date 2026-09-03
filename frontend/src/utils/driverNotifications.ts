import type { Notification } from '@/types/notification';

/**
 * Where tapping a notification leads.
 *
 * A trip the driver no longer holds is not offered: `TRIP_UNASSIGNED` goes to
 * the list. Everything else goes to the trip — where the server decides,
 * again, whether this person may see it now.
 */
export const destinationOf = (notification: Notification): string =>
  notification.type === 'TRIP_UNASSIGNED' ? '/driver' : `/driver/trips/${notification.tripId}`;
