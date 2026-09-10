import type { Notification } from '@/types/notification';

/**
 * Where tapping a notification leads.
 *
 * ★ ALWAYS THE LIST. A notification names a TRIP, and a driver may hold several
 * turns on one trip (ADR-0004) — so there is no single assignment to open. The
 * list is grouped by trip and names the lorry beside each turn, which is where
 * the driver picks the one the message was about. And a trip the driver no
 * longer holds has nothing to open either way.
 */
export const destinationOf = (_notification: Notification): string => '/driver';
