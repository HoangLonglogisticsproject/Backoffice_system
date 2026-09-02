import type { TripCostCategory } from '@/types/tripCost';

/**
 * The expense a driver is part-way through typing.
 *
 * ★ WHY THIS EXISTS AT ALL. The form lived in `useState`, so a reload lost it —
 * and a reload is not an edge case on a phone in a lorry park. The browser is
 * backgrounded while the driver walks to the office, the tab is evicted for
 * memory, the page is pulled down to refresh out of habit. Every one of those
 * threw away a figure somebody had just read off a fuel receipt, and the most
 * likely outcome is that they do not type it again.
 *
 * ★ `sessionStorage`, NOT `localStorage`. A draft is worth surviving a reload;
 * it is not worth surviving a week. `sessionStorage` dies with the tab, which
 * is the right lifetime for something nobody has committed to yet — and it
 * cannot leak a half-typed figure into a shared device's next session.
 *
 * ⚠ EVERY ACCESS IS GUARDED. Storage throws in a private window, when site data
 * is blocked, and when quota is exceeded. A draft is a convenience; a
 * convenience that can crash the screen a driver needs is worse than no
 * convenience at all, so nothing here ever propagates.
 */

export interface ExpenseDraft {
  category: TripCostCategory;
  amount: string;
  note: string;
  /**
   * ★ THE IDEMPOTENCY KEY, MINTED WITH THE DRAFT AND NOT WITH THE REQUEST.
   *
   * One id per INTENT, which is what makes a retry collide with its own first
   * attempt rather than adding a second fuel line. Generating it at submit time
   * would mint a fresh one per tap — exactly the duplicate the server's key
   * exists to prevent.
   */
  clientRequestId: string;
}

/** Scoped to the trip, so two trips open in two tabs cannot see each other's. */
const keyFor = (tripId: string) => `driver-expense-draft:${tripId}`;

/**
 * A stable id for one declaration attempt.
 *
 * `crypto.randomUUID` where it exists — every browser this portal supports has
 * it over HTTPS, which the session cookie already requires. The fallback is for
 * the test environment rather than for production.
 */
export const newRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `draft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

export const readDraft = (tripId: string): ExpenseDraft | null => {
  try {
    const raw = sessionStorage.getItem(keyFor(tripId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    // Malformed JSON from an older version, or storage refusing to be read.
    // Both mean "no draft", which is a state the form already handles.
    return null;
  }
};

export const writeDraft = (tripId: string, draft: ExpenseDraft): void => {
  try {
    sessionStorage.setItem(keyFor(tripId), JSON.stringify(draft));
  } catch {
    // Quota, private mode, blocked site data. The form still works; it just
    // will not survive a reload, which is where it started.
  }
};

/**
 * Forgets the draft.
 *
 * ★ CALLED ONLY AFTER THE SERVER ACCEPTS. Clearing on failure would throw away
 * the figure at the exact moment the driver needs it most — a network error is
 * when they are most likely to retry.
 */
export const clearDraft = (tripId: string): void => {
  try {
    sessionStorage.removeItem(keyFor(tripId));
  } catch {
    /* nothing to do, and nothing worth breaking the screen over */
  }
};

/** Narrow, because storage can hold whatever a previous version wrote. */
const isDraft = (value: unknown): value is ExpenseDraft =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ExpenseDraft).category === 'string' &&
  typeof (value as ExpenseDraft).amount === 'string' &&
  typeof (value as ExpenseDraft).note === 'string' &&
  typeof (value as ExpenseDraft).clientRequestId === 'string';
