import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  fetchNotifications,
  markNotificationRead,
  notificationSocketTarget,
} from '@/api/notifications';
import type { NotificationSignal } from '@/types/notification';
import { driverKeys } from './driver';
import { bookingKeys } from './driver/openBookings';
import { tripKeys } from './trip/keys';

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
 * Hears the server while a shell is open, and re-reads when it does.
 *
 * ★ ONE HOOK, BOTH SHELLS. `DriverLayout` mounts it for a driver; in the
 * Backoffice `CompletionBell` does, so it exists only for an account that can
 * act on a signal (0036). The socket is the same one either way, scoped by the
 * session cookie at the handshake, and what a signal means is "re-read what you
 * have" — true of a schedule and of a review queue alike.
 *
 * ★ A SIGNAL TRIGGERS A REFETCH; IT NEVER WRITES STATE. What comes down the
 * wire is an id, a type and a trip id. The screen does not draw from it — it
 * invalidates the queries that own the truth (the notification list, the
 * driver's trips, the review queue) and lets the API answer what this person
 * may see NOW. A stale signal therefore cannot show a stale trip: the refetch
 * is refused the same way a tap would be.
 *
 * ★ RECONCILIATION DOES NOT DEPEND ON THE SOCKET, AND THAT SURVIVED THE MOVE
 * FROM SSE TO WEBSOCKET UNCHANGED. Three things trigger a re-read regardless of
 * whether any event arrived:
 *
 *   connect       every (re)connection — after WiFi → mobile data, a dropped
 *                 socket, a server restart; socket.io reconnects itself
 *   visible       the tab or phone coming back — a locked screen may have
 *                 dropped the socket without a single event being missed
 *                 visibly, so the answer is asked for again rather than assumed
 *   mount         the shell opening at all
 *
 * So a missed event costs nothing but a moment; nothing here assumes every
 * event arrives. Closed on unmount, which is what a logout does.
 *
 * ★ `onSignal` IS CALLED FOR A LIVE EVENT AND FOR NOTHING ELSE — not on
 * connect, not on a tab regaining focus, not on mount. That distinction is the
 * whole of its purpose: it is what lets the bell tell "a completion just
 * arrived" apart from "this page was reopened", so a toast fires once for a
 * real event instead of on every refresh. Held in a ref so changing the
 * callback does not tear the socket down and build a new one.
 *
 * ⚠ NO WEBSOCKET (jsdom, an old browser) IS NOT A FAILURE. The hook falls back
 * to reconciling on visibility and on mount, which is also why the entire test
 * suite runs without a socket server. Realtime is acceleration, not correctness.
 *
 * ⚠ The client reconnects on its own and re-sends the cookie; if the session is
 * gone the gateway drops the handshake and nothing here has to know.
 */
export function useNotificationStream(onSignal?: (signal: NotificationSignal) => void): void {
  const client = useQueryClient();

  // The latest callback, without it being a dependency of the effect below.
  const handler = useRef(onSignal);
  handler.current = onSignal;

  useEffect(() => {
    const reconcile = () => {
      void client.invalidateQueries({ queryKey: notificationKeys.all });
      void client.invalidateQueries({ queryKey: driverKeys.assignments() });
      // Open bookings and the driver's asks (0035): an approval, a rejection or
      // another driver winning changes both.
      void client.invalidateQueries({ queryKey: bookingKeys.all });
      // ★ AND THE OFFICE'S OWN LISTS (0036). The signal a reviewer gets says a
      // completion was submitted, which changes the review queue and the
      // operational board — both under `tripKeys.all`. Invalidating a prefix
      // nothing is subscribed to costs nothing, so this one hook serves both
      // shells rather than being two hooks that drift.
      void client.invalidateQueries({ queryKey: tripKeys.all });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile();
    };
    document.addEventListener('visibilitychange', onVisible);

    if (typeof WebSocket === 'undefined') {
      return () => document.removeEventListener('visibilitychange', onVisible);
    }

    const { origin, path } = notificationSocketTarget();
    const socket = io(origin, {
      path,
      // The session cookie is the only credential, and it only travels on a
      // credentialed request — see `api/client.ts`.
      withCredentials: true,
      /**
       * ★ WEBSOCKET ONLY, NO LONG-POLLING FALLBACK, AND IT IS DELIBERATE.
       * socket.io polls first by default and upgrades afterwards; those polls
       * go through nginx's general `/api/` block, which clears `Connection` —
       * so the upgrade that follows is the one hop that can fail while
       * everything still "works", slowly and invisibly. Refusing to poll turns
       * a misconfigured proxy into a connection error somebody notices.
       */
      transports: ['websocket'],
    });

    // ★ THE SIGNAL'S BODY IS NOT READ FOR THE REFETCH (ADR-0004). It names a
    // trip; the driver cache is keyed by assignment, and `assignments()`
    // prefixes every turn's key — so one reconcile re-reads the list and any
    // open turn alike. The body is passed on to `onSignal` untouched, for a
    // caller that wants to SAY something about it.
    socket.on('notification', (signal: NotificationSignal) => {
      reconcile();
      handler.current?.(signal);
    });
    socket.on('connect', reconcile);

    return () => {
      socket.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client]);
}
