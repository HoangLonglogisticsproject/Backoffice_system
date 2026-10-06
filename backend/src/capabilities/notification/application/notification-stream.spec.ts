import { TooManyConnectionsError, type NotificationSignal } from '../domain/notification';
import { DEFAULT_STREAM_LIMITS, NotificationStream, roomOf } from './notification-stream';

/**
 * Who hears what, and how many connections one account may hold.
 *
 * ★ THE ONE PROPERTY: a signal published to A is emitted to A's ROOM and to no
 * other. There is no room name a client could pick — the gateway joins a socket
 * to `roomOf(session.id)` and nothing else ever calls `join`.
 *
 * ⚠ WHAT THIS CANNOT PROVE. It stops at the transport boundary: that socket.io
 * really delivers a room emit, that nginx really upgrades the connection, and
 * that a dropped socket really fires `handleDisconnect` are facts about other
 * software. What is pinned here is the accounting and the addressing, which are
 * this file's own.
 */
describe('NotificationStream', () => {
  const signal: NotificationSignal = {
    id: 'n1',
    type: 'TRIP_ASSIGNED',
    tripId: 't1',
    createdAt: 'now',
  };

  /** A transport that records instead of emitting, so no server is needed. */
  const recorder = () => {
    const sent: Array<{ room: string; signal: NotificationSignal }> = [];
    return { sent, emitToRoom: (room: string, s: NotificationSignal) => void sent.push({ room, signal: s }) };
  };

  const attached = (limits?: { perUser: number; total: number }) => {
    const stream = limits ? new NotificationStream(limits) : new NotificationStream();
    const transport = recorder();
    stream.attach(transport);
    return { stream, transport };
  };

  it('★ emits to the recipient’s room and to no other', () => {
    const { stream, transport } = attached();
    stream.register('A', 'socket-1');
    stream.register('B', 'socket-2');

    stream.publish('A', signal);

    expect(transport.sent).toEqual([{ room: roomOf('A'), signal }]);
    expect(transport.sent.some((item) => item.room === roomOf('B'))).toBe(false);
  });

  it('★ addresses a room, never a bare user id — two namespaces that must not collide', () => {
    expect(roomOf('A')).toBe('user:A');
  });

  it('counts every device the recipient has open, and emits once for the room', () => {
    const { stream, transport } = attached();
    stream.register('A', 'phone');
    stream.register('A', 'tablet');

    stream.publish('A', signal);

    // One emit, not two: socket.io fans the room out itself. Emitting per
    // connection would deliver the same signal twice to a person with two tabs.
    expect(transport.sent).toHaveLength(1);
    expect(stream.connections('A')).toBe(2);
  });

  it('★ gives the slot back when a connection closes', () => {
    const { stream } = attached();
    stream.register('A', 'phone');
    stream.register('A', 'tablet');

    stream.release('A', 'phone');

    expect(stream.connections('A')).toBe(1);
    expect(stream.totalConnections()).toBe(1);

    stream.release('A', 'tablet');
    expect(stream.connections('A')).toBe(0);
    expect(stream.totalConnections()).toBe(0);
  });

  it('★ releasing twice does not drive the total below what is open', () => {
    // socket.io reports a disconnect for a handshake that was refused before it
    // was ever registered. Double-counting that would leak the ceiling downwards
    // until nobody could connect at all.
    const { stream } = attached();
    stream.register('A', 'phone');

    stream.release('A', 'phone');
    stream.release('A', 'phone');
    stream.release('A', 'never-registered');
    stream.release('nobody', 'never-registered');

    expect(stream.totalConnections()).toBe(0);
  });

  it('refuses a connection past the per-account ceiling, and registers nothing for it', () => {
    const { stream } = attached({ perUser: 2, total: 10 });
    stream.register('A', 's1');
    stream.register('A', 's2');

    expect(() => stream.register('A', 's3')).toThrow(TooManyConnectionsError);
    expect(stream.connections('A')).toBe(2);
    expect(stream.totalConnections()).toBe(2);
  });

  it('refuses past the process ceiling, whoever is asking', () => {
    const { stream } = attached({ perUser: 10, total: 2 });
    stream.register('A', 's1');
    stream.register('B', 's2');

    expect(() => stream.register('C', 's3')).toThrow(TooManyConnectionsError);
    expect(stream.totalConnections()).toBe(2);
  });

  it('★ frees the account’s ceiling again once a tab closes', () => {
    const { stream } = attached({ perUser: 1, total: 10 });
    stream.register('A', 's1');
    expect(() => stream.register('A', 's2')).toThrow(TooManyConnectionsError);

    stream.release('A', 's1');

    expect(() => stream.register('A', 's2')).not.toThrow();
  });

  it('★ publishes to nobody — rather than crashing — before a transport is attached', () => {
    // A process that never opened a port still records notification ROWS, and a
    // row is the fact. Throwing here would roll the business change back over a
    // push that is only an accelerator.
    const stream = new NotificationStream();
    stream.register('A', 's1');

    expect(() => stream.publish('A', signal)).not.toThrow();
  });

  it('keeps the shipped defaults where a deployment sets nothing', () => {
    expect(DEFAULT_STREAM_LIMITS).toEqual({ perUser: 5, total: 1000 });
  });
});
