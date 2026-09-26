import type { Notification } from '@/types/notification';
import { scheduleViewOf } from '@/utils/driverSchedule';

/**
 * Where tapping a notification leads.
 *
 * ★ THE SCHEDULE, ON THE TAB OF THE TRIP'S DAY. A notification names a TRIP,
 * and a driver may hold several turns on one trip (ADR-0004) — so there is no
 * single assignment to open. The schedule shows one card per turn with its
 * plate (DL-115), which is where the driver picks the one the message was
 * about. The day is the notification's snapshot: a trip rescheduled since may
 * sit on another tab, and the tab counts say where. A trip the driver no
 * longer holds has nothing to open either way.
 *
 * `today` is `todayAsCalendarDay()` — the business calendar, not the handset's.
 */
export const destinationOf = (notification: Notification, today: string): string => {
  const view = scheduleViewOf(notification.tripScheduledOn, today);
  return view === 'today' ? '/driver' : `/driver?view=${view}`;
};
