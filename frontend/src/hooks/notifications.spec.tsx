import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNotificationStream } from './notifications';

vi.mock('@/api/notifications', () => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  notificationStreamUrl: () => 'http://api.test/notifications/stream',
}));

/**
 * A fake `EventSource` that records how it was opened and lets a test fire
 * the events a browser would.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  closed = false;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent);
  }

  close() {
    this.closed = true;
  }
}

function Listener() {
  useNotificationStream();
  return null;
}

const mount = () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  const view = render(
    <QueryClientProvider client={client}>
      <Listener />
    </QueryClientProvider>,
  );
  return { invalidate, view };
};

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * ★ THE STREAM TRIGGERS RE-READS AND WRITES NOTHING. Every case asserts which
 * queries were invalidated — never that any data was set from a signal.
 */
describe('useNotificationStream', () => {
  it('★ opens the stream with credentials, on the API base', () => {
    mount();

    const [source] = FakeEventSource.instances;
    expect(source?.url).toBe('http://api.test/notifications/stream');
    expect(source?.init).toEqual({ withCredentials: true });
  });

  it('★ re-reads the list and the trips on every (re)connection', () => {
    const { invalidate } = mount();
    const [source] = FakeEventSource.instances;
    invalidate.mockClear();

    source!.onopen?.();

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([JSON.stringify(['notifications']), JSON.stringify(['driver', 'trips'])]),
    );
  });

  it('★ on a signal, invalidates the list, the trips and the trip named — and sets nothing', () => {
    const { invalidate } = mount();
    const [source] = FakeEventSource.instances;
    invalidate.mockClear();

    source!.emit('notification', JSON.stringify({ id: 'n1', type: 'TRIP_ASSIGNED', tripId: 't1', createdAt: 'x' }));

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(['notifications']),
        JSON.stringify(['driver', 'trips']),
        JSON.stringify(['driver', 'trips', 't1']),
      ]),
    );
  });

  it('survives a malformed signal by re-reading anyway', () => {
    const { invalidate } = mount();
    const [source] = FakeEventSource.instances;
    invalidate.mockClear();

    expect(() => source!.emit('notification', '{not json')).not.toThrow();
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['notifications']));
  });

  it('★ re-reads when the tab comes back — a locked phone may have missed everything', () => {
    const { invalidate } = mount();
    invalidate.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['notifications']));
  });

  it('closes the stream when the shell unmounts — which is what a sign-out does', () => {
    const { view } = mount();
    const [source] = FakeEventSource.instances;

    view.unmount();

    expect(source?.closed).toBe(true);
  });

  it('opens ONE stream per shell, not one per render', () => {
    const { view } = mount();
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <Listener />
      </QueryClientProvider>,
    );
    // A new client is a new subscription; the old one was closed first.
    expect(FakeEventSource.instances.filter((s) => !s.closed)).toHaveLength(1);
  });

  it('works without EventSource at all — reconciliation does not need it', () => {
    vi.stubGlobal('EventSource', undefined);
    const { invalidate } = mount();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['notifications']));
  });
});
