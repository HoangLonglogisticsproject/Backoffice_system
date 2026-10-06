import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import type { NotificationSignal } from '../domain/notification';
import { NotificationStream, roomOf } from '../application/notification-stream';

/**
 * The live channel: one socket per open tab, authenticated at the handshake.
 *
 * ★ THIS IS THE SECOND AUTHENTICATION PATH IN THE SYSTEM, AND THE ONLY ONE.
 * Every HTTP route is decided by `AuthGuard`, which reads the cookie Express
 * parsed. A WebSocket handshake never reaches a Nest guard with a parsed
 * `request.cookies`, so the cookie is read here, by hand, once — and resolved
 * through the SAME `SessionService.resolve` every route uses, so an expired,
 * revoked or disabled session is refused here exactly as it is there. Adding a
 * third reader of this cookie should take an argument, not a commit.
 *
 * ★ EVERY REFUSAL IS IDENTICAL, as `AuthGuard` documents: no cookie, unknown
 * token, expired, revoked, a user disabled mid-session, or simply too many
 * connections all end as one silent `disconnect`. None of them is a probe, and
 * none tells a caller which of the six it was.
 *
 * ★ IT LISTENS FOR NOTHING. There is no `@SubscribeMessage` in this file and
 * there must not be one: the socket exists to PUSH. Every action in the product
 * stays on REST behind `AuthGuard` + `CsrfGuard`, which is what keeps the new
 * transport from quietly becoming a second, less-guarded way in. A client that
 * emits anything is ignored.
 *
 * ★ AND WHAT IT PUSHES IS A SIGNAL, NEVER A ROW. An id, a type, a trip id — the
 * client re-reads through the ordinary API, which decides what that session may
 * see NOW. So a socket that stayed open across a change of access cannot show
 * anything the HTTP routes would refuse.
 *
 * ⚠ `path` MATCHES `deploy/nginx.conf`. The proxy upgrades exactly one
 * location, and it is this one; changing the string here without changing it
 * there produces a client that silently falls back to polling forever.
 */
@WebSocketGateway({ path: '/socket.io' })
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  /**
   * Whose socket is whose, for the disconnect.
   *
   * ★ KEPT HERE RATHER THAN READ BACK OFF THE SOCKET. `handleDisconnect` runs
   * after socket.io has already torn the connection down, and anything hung on
   * `socket.data` by a LATER version of this file would be the kind of thing
   * that quietly stops being set. One map, written on the way in and deleted on
   * the way out, is what keeps the slot accounting honest.
   */
  private readonly userBySocket = new Map<string, string>();

  constructor(
    private readonly sessions: SessionService,
    private readonly stream: NotificationStream,
  ) {}

  /** Hands the registry its transport, once the server exists. */
  afterInit(server: Server): void {
    this.stream.attach({
      emitToRoom: (room: string, signal: NotificationSignal) =>
        void server.to(room).emit('notification', signal),
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const token = sessionTokenFromHandshake(socket.handshake.headers.cookie);
    // No cookie at all: nothing to resolve, and nothing to say about it.
    if (!token) return void socket.disconnect(true);

    const user = await this.sessions.resolve(token);
    if (!user) return void socket.disconnect(true);

    try {
      // ★ THE SLOT IS TAKEN BEFORE THE ROOM IS JOINED. A refused connection
      // must never have been addressable, not even for the instant between.
      this.stream.register(user.id, socket.id);
    } catch {
      // A limit, not a failure worth a stack trace in production logs — the
      // message `TooManyConnectionsError` carries is written for an HTTP 429
      // and there is no response here to put it in.
      return void socket.disconnect(true);
    }

    this.userBySocket.set(socket.id, user.id);
    await socket.join(roomOf(user.id));
  }

  handleDisconnect(socket: Socket): void {
    const userId = this.userBySocket.get(socket.id);
    // A socket refused at the handshake disconnects too, and was never
    // registered: `release` is idempotent, but there is nothing to release.
    if (!userId) return;

    this.userBySocket.delete(socket.id);
    this.stream.release(userId, socket.id);
    this.logger.debug(`notification socket closed (${this.stream.totalConnections()} open)`);
  }
}

/**
 * The session token out of a raw `Cookie` header.
 *
 * ★ HAND-PARSED, BECAUSE `cookie-parser` IS EXPRESS MIDDLEWARE AND A HANDSHAKE
 * IS NOT AN EXPRESS REQUEST. Same rule as `sessionTokenFrom` in `auth.guard`:
 * the cookie is the ONLY transport — no query parameter, no auth payload, no
 * `Authorization` header. A token in a query string would be written into every
 * proxy access log between the browser and this process, which is exactly why
 * socket.io's `auth` option is not used here either.
 *
 * `decodeURIComponent` because that is what `cookie-parser` does to the value
 * on the HTTP side, and a token that round-trips differently on two paths is a
 * session that works over REST and not over the socket.
 */
export function sessionTokenFromHandshake(header: string | undefined): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;

    // An empty cookie is not a missing one, and both resolve to null rather
    // than reaching the session lookup — as `auth.guard` spells out.
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value.length > 0 ? value : null;
  }

  return null;
}
