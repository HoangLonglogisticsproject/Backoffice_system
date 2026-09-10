import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications, markNotificationRead, notificationStreamUrl } from '@/api/notifications';
import { driverKeys } from './driver';

export const notificationKeys = {
  all: ['notifications'] as const,
};

/** The list and the unread count, from the API — the authority. */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: () => fetchNotifications(),
    staleTime: 30_000,
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/**
 * Hears the server while the portal is open, and re-reads when it does.
 *
 * ★ A SIGNAL TRIGGERS A REFETCH; IT NEVER WRITES STATE. What comes down the
 * wire is an id, a type and a trip id. The screen does not draw from it — it
 * invalidates the queries that own the truth (the notification list, the
 * driver's trips, the one trip named) and lets the API answer what this
 * person may see NOW. A stale signal therefore cannot show a stale trip: the
 * refetch is refused the same way a tap would be.
 *
 * ★ RECONCILIATION DOES NOT DEPEND ON THE STREAM. Three things trigger a
 * re-read regardless of whether any event arrived:
 *
 *   open          every (re)connection — after WiFi → mobile data, a dropped
 *                 socket, a server restart; `EventSource` reconnects itself
 *   visible       the tab or phone coming back — a locked screen may have
 *                 dropped the socket without a single event being missed
 *                 visibly, so the answer is asked for again rather than assumed
 *   mount         the portal opening at all
 *
 * So a missed event costs nothing but a moment; nothing here assumes every
 * event arrives. Closed on unmount, which is what a logout does.
 *
 * ⚠ The browser reconnects on its own and re-sends the cookie; if the session
 * is gone the server answers 401 and the browser stops retrying. Nothing here
 * has to know.
 */
export function useNotificationStream(): void {
  const client = useQueryClient();

  useEffect(() => {
    const reconcile = () => {
      void client.invalidateQueries({ queryKey: notificationKeys.all });
      void client.invalidateQueries({ queryKey: driverKeys.assignments() });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile();
    };
    document.addEventListener('visibilitychange', onVisible);

    // A browser with no `EventSource` still works: it reconciles on
    // visibility and on every screen it opens. Realtime is acceleration, not
    // correctness.
    if (typeof EventSource === 'undefined') {
      return () => document.removeEventListener('visibilitychange', onVisible);
    }

    const source = new EventSource(notificationStreamUrl(), { withCredentials: true });

    // ★ THE SIGNAL'S BODY IS NOT READ (ADR-0004). It names a trip; the driver
    // cache is keyed by assignment, and `assignments()` prefixes every turn's
    // key — so one reconcile re-reads the list and any open turn alike.
    source.addEventListener('notification', reconcile);
    source.onopen = reconcile;

    return () => {
      source.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client]);
}
