import { useSyncExternalStore } from 'react';
import { todayAsCalendarDay } from '@/utils/format/datetime';

/**
 * Today on the business calendar, and a re-render when it changes.
 *
 * ★ A PHONE STAYS OPEN OVERNIGHT. A driver checks tomorrow's trip at 21:00,
 * locks the phone, and unlocks it at 05:30; read once at render, "today" would
 * still be yesterday and today's trip would sit under "upcoming". The snapshot
 * is a `YYYY-MM-DD` string, so React re-renders only when the day actually
 * turns.
 */
const subscribe = (onChange: () => void) => {
  // ponytail: a minute's poll; a timeout to the exact midnight if a minute of lag ever matters.
  const timer = setInterval(onChange, 60_000);
  // Unlocking the phone is the moment the day is most likely to have turned.
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onChange);
  };
};

export const useBusinessToday = (): string => useSyncExternalStore(subscribe, () => todayAsCalendarDay());
