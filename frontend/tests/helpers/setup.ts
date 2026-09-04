import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { toast } from 'sonner';

/**
 * `window.matchMedia`, which jsdom does not implement at all.
 *
 * ★ NOT A CONVENIENCE — WITHOUT IT, MOUNTING `<Toaster />` THROWS. sonner asks
 * for `(prefers-color-scheme: dark)` on mount, and in jsdom that call is
 * `undefined is not a function`: a page rendered with the toaster in it fails
 * every assertion in the file, including the ones that have nothing to do with
 * toasts. A real browser has always had this; the stub only puts the test
 * environment back on par.
 *
 * Answers "not dark" and never changes. A test that needs a theme to CHANGE can
 * override this per-file; nothing in the suite does today, and a listener
 * registry here would be machinery for a case that does not exist.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      // Deprecated pair, still called by libraries that support older Safari.
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/**
 * Toasts do not survive into the next test.
 *
 * ★ sonner's STORE IS MODULE STATE, NOT COMPONENT STATE, and `subscribe`
 * REPLAYS every still-active toast to a `Toaster` that mounts later — the
 * feature that stops a toast raised before mount from being lost. Across a test
 * file it means the receipts from test three are handed to the `Toaster` of test
 * four, which then finds two "Hoàn tác" buttons and cannot say which is its own.
 *
 * `dismiss()` with no id marks every active one dismissed, and the replay skips
 * dismissed toasts — so each test mounts into an empty screen. Nothing here
 * touches the DOM; Testing Library's own cleanup does that.
 */
afterEach(() => {
  toast.dismiss();
});
