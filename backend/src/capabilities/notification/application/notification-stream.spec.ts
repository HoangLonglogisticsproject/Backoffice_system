import type { MessageEvent } from '@nestjs/common';
import { NotificationStream } from './notification-stream';

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
});
