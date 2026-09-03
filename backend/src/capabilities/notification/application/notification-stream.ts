import { Injectable, type MessageEvent } from '@nestjs/common';
import { Observable, Subject, finalize, interval, map, merge } from 'rxjs';
import type { NotificationSignal } from '../domain/notification';

/**
 * The open connections, and who each one belongs to.
 *
 * ★ SERVER-SENT EVENTS OVER THE HTTP SERVER THAT ALREADY EXISTS, not a
 * WebSocket. The deployment is one Node process behind nginx behind
 * Cloudflare, and `deploy/nginx.conf` explicitly clears the `Connection`
 * header on `/api/` — a WebSocket upgrade would need that proxy changed, three
 * new packages, and a second authentication path for the handshake. An SSE
 * response is an ordinary authenticated GET: the session cookie travels with it,
 * `AuthGuard` decides it, the browser reconnects it on its own, and every hop
 * in the current topology already carries it.
 *
 * ★ SUBSCRIBED BY THE SESSION USER, NEVER BY A NAME THE CLIENT SENDS. The
 * controller passes the id `AuthGuard` resolved; there is no parameter through
 * which a caller could name another person's stream. Publishing is by
 * recipient, so one user's set of connections is the only set that hears their
 * signal — a phone and a tablet both signed in as the same driver both hear it,
 * and nobody else does.
 *
 * ★ A SIGNAL, NOT A SOURCE OF TRUTH. What goes down the wire is an id, a type
 * and a trip id — enough to say "re-read". The phone then asks the ordinary
 * APIs, which decide what it may see NOW, not what it was told a minute ago.
 *
 * ponytail: in-memory, one process. This map is only correct on a single
 * instance, which is what `deploy/docker-compose.yml` runs. The day a second
 * backend container appears, a publish has to reach every instance — a
 * PostgreSQL `LISTEN/NOTIFY` fan-out is the smallest step, and it slots in
 * behind `publish()` without touching a caller.
 */
@Injectable()
export class NotificationStream {
  private readonly subscribers = new Map<string, Set<Subject<NotificationSignal>>>();

  /**
   * Keeps the connection alive through every proxy on the way.
   *
   * nginx closes an idle upstream read after 60 s (`proxy_read_timeout`) and
   * Cloudflare after ~100 s; a comment line every 25 s is under both, and a
   * browser's `EventSource` ignores it.
   */
  static readonly HEARTBEAT_MS = 25_000;

  subscribe(userId: string): Observable<MessageEvent> {
    const subject = new Subject<NotificationSignal>();
    const mine = this.subscribers.get(userId) ?? new Set<Subject<NotificationSignal>>();
    mine.add(subject);
    this.subscribers.set(userId, mine);

    const signals = subject.pipe(
      map((data): MessageEvent => ({ type: 'notification', data })),
    );
    const heartbeat = interval(NotificationStream.HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: '' })),
    );

    return merge(signals, heartbeat).pipe(
      finalize(() => {
        mine.delete(subject);
        if (mine.size === 0) this.subscribers.delete(userId);
        subject.complete();
      }),
    );
  }

  /** To every connection the recipient has open, and to nobody else's. */
  publish(recipientUserId: string, signal: NotificationSignal): void {
    for (const subject of this.subscribers.get(recipientUserId) ?? []) subject.next(signal);
  }

  /** How many connections a user holds. For tests and for a health line. */
  connections(userId: string): number {
    return this.subscribers.get(userId)?.size ?? 0;
  }
}
