import { Injectable } from '@nestjs/common';
import { TooManyConnectionsError, type NotificationSignal } from '../domain/notification';

/** How many live connections may exist: per account, and in the whole process. */
export interface StreamLimits {
  perUser: number;
  total: number;
}

/** The env defaults, repeated here so a bare `new NotificationStream()` is safe too. */
export const DEFAULT_STREAM_LIMITS: StreamLimits = { perUser: 5, total: 1000 };

/** What the registry needs of a transport. One method, so a test needs no socket server. */
export interface SignalTransport {
  /** Deliver to everyone in a room. The room name is this file's to choose. */
  emitToRoom(room: string, signal: NotificationSignal): void;
}

/**
 * The room one person's connections share. Prefixed, because a room name and a
 * user id are different things and a bare uuid in a room namespace is the kind
 * of coincidence that becomes a bug once something else joins rooms too.
 */
export const roomOf = (userId: string): string => `user:${userId}`;

/**
 * Who is connected, how many connections they hold, and where a signal goes.
 *
 * ★ WEBSOCKET, BY DECISION (CEO 2026-10-06), AND THE TRADE WAS MADE WITH EYES
 * OPEN. This was Server-Sent Events until that date: an ordinary authenticated
 * GET that `AuthGuard` decided, that the browser reconnected by itself, and
 * that every hop in `deploy/nginx.conf` already carried. The switch bought no
 * new capability — the traffic is still server → client only — and cost three
 * packages, an nginx `Upgrade` route, and a SECOND authentication path for the
 * handshake (`NotificationGateway`, which is the only place a cookie is read
 * outside `AuthGuard`). It was chosen for what comes next: a two-way channel is
 * the thing SSE genuinely cannot do, and dispatch ↔ driver messaging and live
 * vehicle positions are both asked for.
 *
 * ⚠ SO THE HANDSHAKE IS THE SECURITY BOUNDARY, AND IT IS ONE FILE. Everything
 * below assumes the gateway already resolved a session and is handing over an
 * id the SERVER decided. Nothing here takes a user id from a client, and the
 * gateway accepts no message from one.
 *
 * ★ ADDRESSED BY ROOM, SO ONE PERSON'S DEVICES ALL HEAR AND NOBODY ELSE DOES.
 * A phone and a desk both signed in as the same reviewer are two connections in
 * one room; publishing is by recipient, so a signal reaches exactly that room.
 *
 * ★ A SIGNAL, NOT A SOURCE OF TRUTH. What goes down the wire is an id, a type
 * and a trip id — enough to say "re-read". The client then asks the ordinary
 * APIs, which decide what it may see NOW, not what it was told a minute ago.
 *
 * ★ NO HEARTBEAT HERE ANY MORE. SSE needed a comment line every 25 s to survive
 * `proxy_read_timeout`; socket.io runs its own ping/pong and the nginx socket
 * route is given a long read timeout to match. One less number to keep in step
 * with a proxy config.
 *
 * ponytail: in-memory, one process. This map is only correct on a single
 * instance, which is what `deploy/docker-compose.yml` runs. The day a second
 * backend container appears, a publish has to reach every instance — the
 * socket.io Redis adapter is the ready-made step, a PostgreSQL `LISTEN/NOTIFY`
 * fan-out the dependency-free one. Either slots in behind `publish()` without
 * touching a caller.
 */
@Injectable()
export class NotificationStream {
  /** userId → the connection ids it currently holds. */
  private readonly connectionsByUser = new Map<string, Set<string>>();
  /**
   * Live connections across every user. Moved in the same synchronous frame
   * as the set it mirrors — never across an `await` — so the two cannot
   * disagree and no interleaved connection can slip past the check.
   */
  private total = 0;

  /**
   * Set once by the gateway when its socket server is ready. Absent in a unit
   * test and in any process that never opened a port — and `publish` then does
   * nothing, which is the correct behaviour rather than a crash: a notification
   * ROW is the fact, and the push is only how a screen hears about it sooner.
   */
  private transport: SignalTransport | null = null;

  constructor(private readonly limits: StreamLimits = DEFAULT_STREAM_LIMITS) {}

  /** The gateway hands over its server once it is listening. The only writer. */
  attach(transport: SignalTransport): void {
    this.transport = transport;
  }

  /**
   * Takes a slot for one connection, or refuses it.
   *
   * ★ THE LIMITS ARE CHECKED BEFORE ANYTHING IS REGISTERED, AND THE CHECK AND
   * THE INSERT SHARE ONE SYNCHRONOUS FRAME. Node runs this on one thread and
   * there is no `await` between reading the counts and recording the id, so two
   * handshakes arriving together are handled one after the other in full: the
   * second sees the first's insert. A refusal throws and registers nothing, so
   * a refused connection leaves no slot behind.
   *
   * ⚠ THE AWAIT THAT MATTERS IS THE GATEWAY'S, NOT THIS ONE. Resolving the
   * session is asynchronous, so two handshakes CAN both finish their lookup
   * before either reaches this method — which is exactly why the count is read
   * here, after the await, and not before it.
   */
  register(userId: string, connectionId: string): void {
    const mine = this.connectionsByUser.get(userId) ?? new Set<string>();

    if (mine.size >= this.limits.perUser) {
      throw new TooManyConnectionsError(
        'This account already holds as many live notification connections as it may. Close another tab and try again.',
      );
    }
    if (this.total >= this.limits.total) {
      throw new TooManyConnectionsError(
        'The server is holding as many live notification connections as it may right now. Try again shortly.',
      );
    }

    mine.add(connectionId);
    this.connectionsByUser.set(userId, mine);
    this.total += 1;
  }

  /**
   * Gives the slot back. Idempotent: socket.io can report a disconnect for a
   * connection that was never registered (a handshake refused above, a socket
   * dropped mid-lookup), and `delete` answering false is what keeps the total
   * from drifting below zero on one of those.
   */
  release(userId: string, connectionId: string): void {
    const mine = this.connectionsByUser.get(userId);
    if (!mine) return;

    if (mine.delete(connectionId)) this.total -= 1;
    if (mine.size === 0) this.connectionsByUser.delete(userId);
  }

  /** To every connection the recipient has open, and to nobody else's. */
  publish(recipientUserId: string, signal: NotificationSignal): void {
    this.transport?.emitToRoom(roomOf(recipientUserId), signal);
  }

  /** Live connections in the process. For tests and for a health line. */
  totalConnections(): number {
    return this.total;
  }

  /** How many connections a user holds. For tests and for a health line. */
  connections(userId: string): number {
    return this.connectionsByUser.get(userId)?.size ?? 0;
  }
}
