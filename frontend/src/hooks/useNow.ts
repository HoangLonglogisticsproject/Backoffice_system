import { useSyncExternalStore } from 'react';

const MINUTE_MS = 60_000;

const subscribe = (onChange: () => void) => {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
};

/**
 * The current instant, to the minute, and a re-render when the minute turns.
 *
 * ★ FLOORED TO THE MINUTE so the snapshot is stable between renders, which
 * `useSyncExternalStore` requires — and so a board left open still moves a trip
 * into "sắp đến giờ" without anybody reloading it. `useBusinessToday` is the
 * same idea at the grain of a day.
 */
export const useNow = (): number =>
  useSyncExternalStore(subscribe, () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);
