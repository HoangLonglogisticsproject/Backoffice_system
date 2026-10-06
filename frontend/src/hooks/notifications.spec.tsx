import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNotificationStream } from './notifications';
import type { NotificationSignal } from '@/types/notification';

vi.mock('@/api/notifications', () => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  notificationSocketTarget: () => ({ origin: 'http://api.test', path: '/socket.io' }),
}));

/**
 * A fake socket that records how it was opened and lets a test fire the events
 * socket.io would.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  closed = false;

  constructor(
    readonly origin: string,
    readonly options: Record<string, unknown>,
  ) {
    FakeSocket.instances.push(this);
  }

  on(event: string, handler: (payload: unknown) => void) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return this;
  }

  emitToClient(event: string, payload?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  close() {
    this.closed = true;
  }
}

const io = vi.fn(
  (origin: string, options: Record<string, unknown>) => new FakeSocket(origin, options),
);

vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => io(...(args as [string, Record<string, unknown>])) }));

const SIGNAL: NotificationSignal = {
  id: 'n1',
  type: 'COMPLETION_SUBMITTED',
  tripId: 't1',
  createdAt: 'x',
};

function Listener({ onSignal }: Readonly<{ onSignal?: (signal: NotificationSignal) => void }>) {
  useNotificationStream(onSignal);
  return null;
}

const mount = (onSignal?: (signal: NotificationSignal) => void) => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  const view = render(
    <QueryClientProvider client={client}>
      <Listener onSignal={onSignal} />
    </QueryClientProvider>,
  );
  return { client, invalidate, view };
};

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));

beforeEach(() => {
  FakeSocket.instances = [];
  io.mockClear();
  // jsdom has no WebSocket; the hook checks for one before it dials.
  vi.stubGlobal('WebSocket', class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * ★ THE SOCKET TRIGGERS RE-READS AND WRITES NOTHING. Every case asserts which
 * queries were invalidated — never that any data was set from a signal. That
 * property is what makes a stale or replayed signal harmless: the API, not the
 * wire, decides what this session may see.
 */
describe('useNotificationStream', () => {
  it('★ dials the API origin, on the proxy’s path, with credentials', () => {
    mount();

    const [socket] = FakeSocket.instances;
    expect(socket?.origin).toBe('http://api.test');
    expect(socket?.options).toMatchObject({ path: '/socket.io', withCredentials: true });
  });

  it('★ refuses to long-poll, so a proxy that cannot upgrade fails loudly', () => {
    // Polling works through nginx's general /api/ block; the upgrade needs its
    // own location. Allowing the fallback would turn a misconfigured proxy into
    // "realtime is a bit slow today" and nobody would ever look.
    mount();

    expect(FakeSocket.instances[0]?.options.transports).toEqual(['websocket']);
  });

  it('★ re-reads the list and the assignments on every (re)connection', () => {
    const { invalidate } = mount();
    const [socket] = FakeSocket.instances;
    invalidate.mockClear();

    socket!.emitToClient('connect');

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(['notifications']),
        JSON.stringify(['driver', 'assignments']),
      ]),
    );
  });

  it('★ on a signal, invalidates the list, the assignments and the office’s own lists — and sets nothing', () => {
    const { invalidate } = mount();
    const [socket] = FakeSocket.instances;
    invalidate.mockClear();

    socket!.emitToClient('notification', SIGNAL);

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(['notifications']),
        JSON.stringify(['driver', 'assignments']),
        // The review queue and the operational board both live under this.
        JSON.stringify(['trip']),
      ]),
    );
  });

  it('★ re-reads when the tab comes back — a locked phone may have missed everything', () => {
    const { invalidate } = mount();
    invalidate.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['notifications']));
  });

  it('closes the socket when the shell unmounts — which is what a sign-out does', () => {
    const { view } = mount();
    const [socket] = FakeSocket.instances;

    view.unmount();

    expect(socket?.closed).toBe(true);
  });

  it('opens ONE socket per shell, not one per render', () => {
    const { view } = mount();
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <Listener />
      </QueryClientProvider>,
    );

    // A new client is a new subscription; the old one was closed first.
    expect(FakeSocket.instances.filter((socket) => !socket.closed)).toHaveLength(1);
  });

  it('works without WebSocket at all — reconciliation does not need it', () => {
    vi.stubGlobal('WebSocket', undefined);
    const { invalidate } = mount();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(io).not.toHaveBeenCalled();
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['notifications']));
  });

  /**
   * ★ THE DIFFERENCE BETWEEN "SOMETHING HAPPENED" AND "THIS PAGE REOPENED".
   *
   * `onSignal` is what the bell raises a toast from. If it fired on connect or
   * on a tab regaining focus, a reviewer would get a popup every time they came
   * back to the window — for an event that arrived an hour ago. These cases are
   * the whole reason the callback exists separately from the reconcile.
   */
  describe('onSignal', () => {
    it('★ is called for a live event, with the signal untouched', () => {
      const onSignal = vi.fn();
      mount(onSignal);

      FakeSocket.instances[0]!.emitToClient('notification', SIGNAL);

      expect(onSignal).toHaveBeenCalledTimes(1);
      expect(onSignal).toHaveBeenCalledWith(SIGNAL);
    });

    it('★ is NOT called on connect, on visibility, or on mount', () => {
      const onSignal = vi.fn();
      mount(onSignal);

      FakeSocket.instances[0]!.emitToClient('connect');
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(onSignal).not.toHaveBeenCalled();
    });

    it('★ changing the callback does not tear the socket down and build another', () => {
      // Held in a ref precisely so a parent re-rendering with a fresh closure —
      // which is every render — cannot cost a reconnection.
      const { client, view } = mount(vi.fn());
      const before = FakeSocket.instances.length;

      view.rerender(
        <QueryClientProvider client={client}>
          <Listener onSignal={vi.fn()} />
        </QueryClientProvider>,
      );

      expect(FakeSocket.instances).toHaveLength(before);
      expect(FakeSocket.instances[0]?.closed).toBe(false);
    });
  });
});
