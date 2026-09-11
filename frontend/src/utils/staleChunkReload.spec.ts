import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStaleChunk } from './staleChunkReload';

/**
 * The branch under test is the GIVE-UP one. Reloading on a stale chunk is the
 * easy half; not reloading a second time is what keeps a broken deployment from
 * becoming a white screen that reloads forever.
 */

/** Enough of a Window for this function: storage, an href, and a reload. */
function fakeWindow(href: string, storage?: Partial<Storage>) {
  const map = new Map<string, string>();
  const reload = vi.fn();
  return {
    reload,
    map,
    win: {
      sessionStorage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        ...storage,
      },
      location: { href, reload },
    } as unknown as Window,
  };
}

describe('handleStaleChunk', () => {
  let event: Event & { preventDefault: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    event = { preventDefault: vi.fn() } as unknown as typeof event;
  });

  it('reloads once and suppresses the error, so the stale tab picks up the new index.html', () => {
    const { win, reload } = fakeWindow('https://ops.example/trips');

    handleStaleChunk(event, win);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('★ does NOT reload a second time for the same URL — a broken deploy must surface, not loop', () => {
    const { win, reload } = fakeWindow('https://ops.example/trips');

    handleStaleChunk(event, win); // the stale tab
    expect(reload).toHaveBeenCalledTimes(1);

    // After the reload the flag survives in sessionStorage, and the chunk is
    // STILL missing: this is a bad build, not a stale tab.
    handleStaleChunk(event, win);

    expect(reload).toHaveBeenCalledTimes(1);
    // And the error is left to throw, rather than swallowed by a recovery that
    // has already decided not to recover.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('reloads again after navigating elsewhere — the flag is per URL, not per session', () => {
    const { win, reload, map } = fakeWindow('https://ops.example/trips');
    handleStaleChunk(event, win);

    const next = fakeWindow('https://ops.example/approvals');
    // Same session, so the same storage contents travel with the tab.
    map.forEach((v, k) => next.win.sessionStorage.setItem(k, v));

    handleStaleChunk(event, next.win);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(next.reload).toHaveBeenCalledTimes(1);
  });

  it('★ does nothing when sessionStorage is unavailable — a page that cannot remember must not reload', () => {
    const throws = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const { win, reload } = fakeWindow('https://ops.example/trips', {
      getItem: throws,
      setItem: throws,
    });

    handleStaleChunk(event, win);

    expect(reload).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
