import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBusinessToday } from './useBusinessToday';

const unlockThePhone = () => act(() => document.dispatchEvent(new Event('visibilitychange')));

/**
 * ★ THE DAY TURNS ON THE BUSINESS CALENDAR (Asia/Ho_Chi_Minh, UTC+7), NOT THE
 * SUITE'S UTC: 17:00Z is midnight in Hồ Chí Minh.
 */
describe('useBusinessToday', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-08-30T16:59:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads today on the business calendar — one minute before midnight in Hồ Chí Minh', () => {
    const { result } = renderHook(() => useBusinessToday());

    expect(result.current).toBe('2026-08-30');
  });

  it('moves to the next day when the phone is unlocked after midnight, without a reload', () => {
    const { result } = renderHook(() => useBusinessToday());

    vi.setSystemTime(new Date('2026-08-30T17:01:00Z'));
    unlockThePhone();

    expect(result.current).toBe('2026-08-31');
  });

  it('stops listening once unmounted', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useBusinessToday());
    const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];

    unmount();

    expect(listener).toBeDefined();
    expect(remove).toHaveBeenCalledWith('visibilitychange', listener);
    vi.setSystemTime(new Date('2026-08-30T17:01:00Z'));
    expect(unlockThePhone).not.toThrow();
  });
});
