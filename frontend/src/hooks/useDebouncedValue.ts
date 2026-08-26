import { useEffect, useState } from 'react';

/**
 * `value`, but only after it has stopped changing for `delayMs`.
 *
 * ★ WRITTEN FOR THE DATE FILTER, AND THE DATE FILTER IS NOT A TEXT SEARCH.
 * `<input type="date">` fires `change` on every COMPONENT of the date, so
 * typing the year `2026` walks through `0002`, `0020`, `0202` and finally
 * `2026`. Undebounced that is four requests, three of them for a range nobody
 * asked for — and `from: 0002-01-01` is the widest scan the endpoint can be
 * given, which is precisely the query ADR-0003's bounded range exists to
 * prevent.
 *
 * Returns the FIRST value immediately: a screen must not wait `delayMs` for its
 * own initial render. Only changes are delayed.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Already there — usually the render right after this hook settled. No
    // timer, so a stable value costs nothing.
    if (Object.is(value, settled)) return;

    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);

  return settled;
}
