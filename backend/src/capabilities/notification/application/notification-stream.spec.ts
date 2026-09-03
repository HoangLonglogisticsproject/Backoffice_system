import type { MessageEvent } from '@nestjs/common';
import { TooManyConnectionsError } from '../domain/notification';
import { DEFAULT_STREAM_LIMITS, NotificationStream } from './notification-stream';

/**
 * Who hears what.
 *
 * ★ THE ONE PROPERTY: a signal published to A reaches every connection A holds
 * and no connection anybody else holds. There is no channel name a client
 * could pick; the user id comes from the session and is the only key.
 */
describe('NotificationStream', () => {
  const signal = { id: 'n1', type: 'TRIP_ASSIGNED' as const, tripId: 't1', createdAt: 'now' };

  const listen = (stream: NotificationStream, userId: string) => {
    const heard: MessageEvent[] = [];
    const subscription = stream.subscribe(userId).subscribe((event) => heard.push(event));
    return { heard, stop: () => subscription.unsubscribe() };
  };

  it('★ delivers to the recipient only', () => {
    const stream = new NotificationStream();
    const a = listen(stream, 'A');
    const b = listen(stream, 'B');

    stream.publish('A', signal);

    expect(a.heard).toEqual([{ type: 'notification', data: signal }]);
    expect(b.heard).toEqual([]);
    a.stop();
    b.stop();
  });

  it('delivers to every device the recipient has open', () => {
    const stream = new NotificationStream();
    const phone = listen(stream, 'A');
    const tablet = listen(stream, 'A');

    stream.publish('A', signal);

    expect(phone.heard).toHaveLength(1);
    expect(tablet.heard).toHaveLength(1);
    expect(stream.connections('A')).toBe(2);
    phone.stop();
    tablet.stop();
  });

  it('★ forgets a connection that closed, so a reconnect does not double-deliver', () => {
    const stream = new NotificationStream();
    const first = listen(stream, 'A');
    first.stop();
    const second = listen(stream, 'A');

    stream.publish('A', signal);

    expect(first.heard).toEqual([]);
    expect(second.heard).toHaveLength(1);
    expect(stream.connections('A')).toBe(1);
    second.stop();
    expect(stream.connections('A')).toBe(0);
  });

  it('drops a signal for somebody with nothing open, rather than queueing it', () => {
    // The ROW is the queue. A phone that was not listening reads it later.
    const stream = new NotificationStream();
    expect(() => stream.publish('nobody', signal)).not.toThrow();
    expect(stream.connections('nobody')).toBe(0);
  });

  it('sends a heartbeat under every proxy timeout in the path', () => {
    jest.useFakeTimers();
    const stream = new NotificationStream();
    const a = listen(stream, 'A');

    jest.advanceTimersByTime(NotificationStream.HEARTBEAT_MS);

    expect(a.heard).toEqual([{ type: 'heartbeat', data: '' }]);
    // nginx `proxy_read_timeout 60s` in deploy/nginx.conf; Cloudflare ~100 s.
    expect(NotificationStream.HEARTBEAT_MS).toBeLessThan(60_000);
    a.stop();
    jest.useRealTimers();
  });

  /**
   * ★ CEILINGS, CHECKED BEFORE ANYTHING IS CREATED. A refused subscribe
   * throws, registers nothing, and starts no heartbeat; a slot comes back
   * exactly once when a stream ends, however it ends.
   */
  describe('connection limits', () => {
    it('ships safe defaults', () => {
      expect(DEFAULT_STREAM_LIMITS).toEqual({ perUser: 5, total: 1000 });
    });

    it('★ refuses the connection past the per-user ceiling, and only that user’s', () => {
      const stream = new NotificationStream({ perUser: 2, total: 10 });
      const a1 = listen(stream, 'A');
      const a2 = listen(stream, 'A');

      expect(() => stream.subscribe('A')).toThrow(TooManyConnectionsError);
      expect(stream.connections('A')).toBe(2);
      // B is untouched by A's ceiling.
      const b = listen(stream, 'B');
      expect(stream.connections('B')).toBe(1);
      a1.stop();
      a2.stop();
      b.stop();
    });

    it('★ refuses the connection past the process-wide ceiling, whoever asks', () => {
      const stream = new NotificationStream({ perUser: 5, total: 2 });
      const a = listen(stream, 'A');
      const b = listen(stream, 'B');

      expect(() => stream.subscribe('C')).toThrow(TooManyConnectionsError);
      expect(stream.totalConnections()).toBe(2);
      expect(stream.connections('C')).toBe(0);
      a.stop();
      b.stop();
    });

    it('serves every connection under both ceilings exactly as before', () => {
      const stream = new NotificationStream({ perUser: 2, total: 3 });
      const a1 = listen(stream, 'A');
      const a2 = listen(stream, 'A');
      const b = listen(stream, 'B');

      stream.publish('A', signal);

      expect(a1.heard).toHaveLength(1);
      expect(a2.heard).toHaveLength(1);
      expect(b.heard).toHaveLength(0);
      expect(stream.totalConnections()).toBe(3);
      a1.stop();
      a2.stop();
      b.stop();
    });

    it('★ a refused subscribe leaves no subscriber and no heartbeat behind', () => {
      jest.useFakeTimers();
      const stream = new NotificationStream({ perUser: 1, total: 10 });
      const a = listen(stream, 'A');

      expect(() => stream.subscribe('A')).toThrow(TooManyConnectionsError);
      jest.advanceTimersByTime(NotificationStream.HEARTBEAT_MS);

      // Exactly one heartbeat — the live connection's — and one slot held.
      expect(a.heard).toEqual([{ type: 'heartbeat', data: '' }]);
      expect(stream.connections('A')).toBe(1);
      expect(stream.totalConnections()).toBe(1);
      a.stop();
      jest.useRealTimers();
    });

    it('★ gives the slot back on disconnect, so the next connection is served', () => {
      const stream = new NotificationStream({ perUser: 1, total: 1 });
      const first = listen(stream, 'A');
      expect(() => stream.subscribe('A')).toThrow(TooManyConnectionsError);

      first.stop();

      expect(stream.totalConnections()).toBe(0);
      const second = listen(stream, 'A');
      stream.publish('A', signal);
      expect(second.heard).toHaveLength(1);
      second.stop();
      expect(stream.totalConnections()).toBe(0);
    });

    it('gives a slot back exactly once, however a stream ends', () => {
      const stream = new NotificationStream({ perUser: 1, total: 1 });
      const heard: MessageEvent[] = [];
      const subscription = stream.subscribe('A').subscribe((event) => heard.push(event));

      subscription.unsubscribe();
      subscription.unsubscribe();

      expect(stream.totalConnections()).toBe(0);
      expect(stream.connections('A')).toBe(0);
    });

    it('★ holds the ceiling under a burst of simultaneous subscribes', () => {
      // Each subscribe checks and inserts in one synchronous frame, so a
      // burst is handled one after another and the ceiling is exact.
      const stream = new NotificationStream({ perUser: 100, total: 5 });
      const results = Array.from({ length: 20 }, (_, i) => {
        try {
          return stream.subscribe(`user-${i}`).subscribe(() => undefined);
        } catch (error) {
          return error;
        }
      });

      const served = results.filter((r) => !(r instanceof Error));
      const refused = results.filter((r) => r instanceof TooManyConnectionsError);
      expect(served).toHaveLength(5);
      expect(refused).toHaveLength(15);
      expect(stream.totalConnections()).toBe(5);

      for (const s of served) (s as { unsubscribe: () => void }).unsubscribe();
      expect(stream.totalConnections()).toBe(0);
    });

    it('names a Retry-After, so a 429 tells the client when to come back', () => {
      const stream = new NotificationStream({ perUser: 1, total: 1 });
      const a = listen(stream, 'A');
      let refusal: unknown;
      try {
        stream.subscribe('A');
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(TooManyConnectionsError);
      expect((refusal as TooManyConnectionsError).code).toBe('TOO_MANY_CONNECTIONS');
      expect((refusal as TooManyConnectionsError).retryAfterSeconds).toBeGreaterThan(0);
      a.stop();
    });
  });
});
