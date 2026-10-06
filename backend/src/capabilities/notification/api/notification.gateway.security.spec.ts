import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { NotificationStream, roomOf } from '../application/notification-stream';
import { NotificationGateway, sessionTokenFromHandshake } from './notification.gateway';

/**
 * The handshake is the boundary.
 *
 * ★ WHY THIS FILE EXISTS AT ALL. Every HTTP route in the system is decided by
 * `AuthGuard`, and `authorization-policy.spec` can read the whole matrix off the
 * decorators. A WebSocket has no decorator to read: the gateway resolves the
 * cookie itself, so the only way "a socket belongs to exactly one session" stays
 * true is a test that says so. These cases are the security review of the one
 * second authentication path in the deployment.
 *
 * ⚠ WHAT THIS CANNOT PROVE: that socket.io really calls `handleConnection` for
 * every upgrade, and that nginx really forwards the `Cookie` header on one.
 * Those are facts about other software and are checked by hand before a deploy.
 */
describe('notification gateway security', () => {
  const TOKEN = 'a-session-token-value';
  const ME = '33333333-3333-3333-3333-333333333333';
  const SOMEBODY_ELSE = '44444444-4444-4444-4444-444444444444';

  const activeUser = { id: ME, displayName: 'Điều Hành', status: 'active', accountType: 'employee' };

  /** A socket as socket.io hands one over, recording what was done to it. */
  const socketWith = (cookie: string | undefined, id = 'socket-1') => {
    const joined: string[] = [];
    return {
      id,
      joined,
      disconnected: [] as boolean[],
      handshake: { headers: { cookie } },
      join: jest.fn(async (room: string) => void joined.push(room)),
      disconnect: jest.fn(function (this: { disconnected: boolean[] }, close?: boolean) {
        this.disconnected.push(close ?? false);
      }),
    };
  };

  const build = (resolve: jest.Mock, limits = { perUser: 5, total: 1000 }) => {
    const stream = new NotificationStream(limits);
    const sent: Array<{ room: string; signal: unknown }> = [];
    stream.attach({ emitToRoom: (room, signal) => void sent.push({ room, signal }) });
    const gateway = new NotificationGateway({ resolve } as never, stream);
    return { gateway, stream, sent };
  };

  const resolvesMe = () => jest.fn().mockResolvedValue(activeUser);

  describe('who gets in', () => {
    it('★ joins the room of the SESSION, never a room a client could name', async () => {
      const resolve = resolvesMe();
      const { gateway, stream } = build(resolve);
      const socket = socketWith(`${SESSION_COOKIE}=${TOKEN}`);

      await gateway.handleConnection(socket as never);

      expect(resolve).toHaveBeenCalledWith(TOKEN);
      expect(socket.joined).toEqual([roomOf(ME)]);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(stream.connections(ME)).toBe(1);
    });

    it('★ a cookie naming somebody else’s id buys nothing — the TOKEN decides', async () => {
      // The handshake carries only an opaque token. Even a caller who knows
      // another user's uuid has no field to put it in: the id comes back from
      // `SessionService.resolve`, which is the server's own lookup.
      const resolve = resolvesMe();
      const { gateway, stream } = build(resolve);
      const socket = socketWith(`${SESSION_COOKIE}=${TOKEN}; userId=${SOMEBODY_ELSE}`);

      await gateway.handleConnection(socket as never);

      expect(socket.joined).toEqual([roomOf(ME)]);
      expect(stream.connections(SOMEBODY_ELSE)).toBe(0);
    });

    it.each([
      ['no cookie header at all', undefined],
      ['cookies, but not the session one', 'theme=dark; lang=vi'],
      ['the session cookie, empty', `${SESSION_COOKIE}=`],
    ])('refuses a handshake with %s, silently and without a lookup', async (_label, cookie) => {
      const resolve = resolvesMe();
      const { gateway, stream } = build(resolve);
      const socket = socketWith(cookie as string | undefined);

      await gateway.handleConnection(socket as never);

      // Not even asked: there is no token to ask about.
      expect(resolve).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.joined).toEqual([]);
      expect(stream.totalConnections()).toBe(0);
    });

    it('★ refuses a token the session service does not know, with no reason given', async () => {
      // Unknown, expired, revoked, or a user disabled mid-session: `resolve`
      // answers null to all four and this reacts identically to each, so none
      // of them is a probe — the same property `AuthGuard` documents.
      const resolve = jest.fn().mockResolvedValue(null);
      const { gateway, stream } = build(resolve);
      const socket = socketWith(`${SESSION_COOKIE}=${TOKEN}`);

      await gateway.handleConnection(socket as never);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.joined).toEqual([]);
      expect(stream.totalConnections()).toBe(0);
    });

    it('★ drops the handshake past the account’s ceiling, and joins no room for it', async () => {
      const { gateway, stream } = build(resolvesMe(), { perUser: 1, total: 10 });
      await gateway.handleConnection(socketWith(`${SESSION_COOKIE}=${TOKEN}`, 'first') as never);

      const refused = socketWith(`${SESSION_COOKIE}=${TOKEN}`, 'second');
      await gateway.handleConnection(refused as never);

      expect(refused.disconnect).toHaveBeenCalledWith(true);
      expect(refused.joined).toEqual([]);
      // The first connection is untouched: a refusal costs the holder nothing.
      expect(stream.connections(ME)).toBe(1);
    });
  });

  describe('what it listens for', () => {
    it('★ nothing — there is no message handler on this gateway', () => {
      // A `@SubscribeMessage` here would be a second, less-guarded way in: it
      // would run behind the handshake rather than behind `AuthGuard` +
      // `CsrfGuard` like every action in the product. Nest records handlers as
      // metadata; the absence of any is the assertion.
      const handlers = Reflect.getMetadataKeys(NotificationGateway.prototype)
        .concat(
          Object.getOwnPropertyNames(NotificationGateway.prototype).flatMap((name) =>
            Reflect.getMetadataKeys(NotificationGateway.prototype, name),
          ),
        )
        .filter((key) => String(key).includes('message'));

      expect(handlers).toEqual([]);
    });
  });

  describe('letting go', () => {
    it('gives the slot back when the socket closes', async () => {
      const { gateway, stream } = build(resolvesMe());
      const socket = socketWith(`${SESSION_COOKIE}=${TOKEN}`);
      await gateway.handleConnection(socket as never);

      gateway.handleDisconnect(socket as never);

      expect(stream.connections(ME)).toBe(0);
      expect(stream.totalConnections()).toBe(0);
    });

    it('★ a refused handshake disconnects too, and releases nothing it never took', async () => {
      const { gateway, stream } = build(jest.fn().mockResolvedValue(null));
      const socket = socketWith(`${SESSION_COOKIE}=${TOKEN}`);
      await gateway.handleConnection(socket as never);

      // socket.io reports this disconnect like any other.
      expect(() => gateway.handleDisconnect(socket as never)).not.toThrow();
      expect(stream.totalConnections()).toBe(0);
    });
  });

  describe('reading the cookie', () => {
    it.each([
      [`${SESSION_COOKIE}=${TOKEN}`, TOKEN],
      [`theme=dark; ${SESSION_COOKIE}=${TOKEN}; lang=vi`, TOKEN],
      [`  ${SESSION_COOKIE}=${TOKEN}  `, TOKEN],
      // Percent-encoded, as `cookie-parser` would decode it on the HTTP side:
      // a token that round-trips differently on the two paths is a session that
      // works over REST and not over the socket.
      [`${SESSION_COOKIE}=a%2Fb`, 'a/b'],
      [undefined, null],
      ['', null],
      [`${SESSION_COOKIE}=`, null],
      ['nonsense-without-equals', null],
      [`${SESSION_COOKIE}x=${TOKEN}`, null],
      [`x${SESSION_COOKIE}=${TOKEN}`, null],
    ])('reads %p as %p', (header, expected) => {
      expect(sessionTokenFromHandshake(header as string | undefined)).toBe(expected);
    });
  });
});
