import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, newRequestId, readDraft, writeDraft, type ExpenseDraft } from './driverDraft';

/**
 * The half-typed expense, and the id that makes a retry safe.
 *
 * ★ WHAT `newRequestId` IS FOR DECIDES WHAT IT MUST GUARANTEE. The value is an
 * IDEMPOTENCY KEY: the server takes it as an optional string and uses it to
 * recognise a retried tap as the same expense line rather than a second one.
 * Nothing is authorised by it. So these tests pin UNIQUENESS, and deliberately
 * do NOT pin unpredictability — that would be asserting a property the design
 * does not claim and the server does not rely on.
 */

const TRIP = 'trip-1';

const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  category: 'fuel',
  amount: '1500000.00',
  note: 'Đổ dầu Long Thành',
  clientRequestId: 'req-1',
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
});

describe('newRequestId', () => {
  it('never repeats itself', () => {
    // 1000 is far past anything a driver produces and still instant; a
    // generator that collides at this scale would collide on a busy day.
    const ids = new Set(Array.from({ length: 1000 }, () => newRequestId()));

    expect(ids.size).toBe(1000);
  });

  it('is a non-empty string the server will accept', () => {
    const id = newRequestId();

    // The route is `z.string().trim().min(1).max(200)`.
    expect(typeof id).toBe('string');
    expect(id.trim().length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(200);
  });

  it('★ comes from Web Crypto, with no fallback path left to take', () => {
    // The deleted fallback claimed to exist for the test environment. It never
    // ran even here — this asserts the premise directly, so a future change
    // that reintroduces a weaker generator has to argue with a test.
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID');

    const id = newRequestId();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(id).toBe(spy.mock.results[0]?.value);

    spy.mockRestore();
  });
});

describe('the draft that survives a reload', () => {
  it('gives back what was written', () => {
    writeDraft(TRIP, draft());

    expect(readDraft(TRIP)).toEqual(draft());
  });

  it('keeps one trip out of another trip’s draft', () => {
    writeDraft(TRIP, draft({ amount: '111.00' }));
    writeDraft('trip-2', draft({ amount: '222.00' }));

    expect(readDraft(TRIP)?.amount).toBe('111.00');
    expect(readDraft('trip-2')?.amount).toBe('222.00');
  });

  it('answers null when there is nothing saved', () => {
    expect(readDraft(TRIP)).toBeNull();
  });

  it('forgets the draft when told to', () => {
    writeDraft(TRIP, draft());
    clearDraft(TRIP);

    expect(readDraft(TRIP)).toBeNull();
  });

  it('★ treats a malformed or outdated entry as no draft, rather than trusting it', () => {
    sessionStorage.setItem(`driver-expense-draft:${TRIP}`, '{not json');
    expect(readDraft(TRIP)).toBeNull();

    // Written by an older version with a different shape.
    sessionStorage.setItem(`driver-expense-draft:${TRIP}`, JSON.stringify({ amount: '1.00' }));
    expect(readDraft(TRIP)).toBeNull();
  });

  it('★ never throws when storage refuses, because a convenience must not break the screen', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => writeDraft(TRIP, draft())).not.toThrow();
    expect(readDraft(TRIP)).toBeNull();
    expect(() => clearDraft(TRIP)).not.toThrow();

    setItem.mockRestore();
    getItem.mockRestore();
  });
});
