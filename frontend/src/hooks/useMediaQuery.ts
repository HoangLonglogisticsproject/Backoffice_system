import { useSyncExternalStore } from 'react';

const supported = (): boolean => typeof window.matchMedia === 'function';

/**
 * Does the viewport match `query` — and a re-render when that changes.
 *
 * ★ `true` WHERE `matchMedia` DOES NOT EXIST (jsdom), the same desktop-first
 * answer `AppShell` gives for its sidebar: the wide layout is the one every
 * screen is written for, and a test that wants the narrow one stubs it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!supported()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (supported() ? window.matchMedia(query).matches : true),
  );
}
