import { Bell, CalendarDays, Fuel, History, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/types/translate';

/**
 * The Driver Portal's navigation MODEL — what a driver may go to, and nothing
 * the Backoffice offers. Data, not markup: the shell draws it.
 *
 * ★ FOUR DESTINATIONS, ALL OF THEM REAL AND ALL OF THEM THE DRIVER'S OWN. The
 * schedule, what I have already run, what I have been told, my account. No
 * roster, no catalogue, no board, no money — those screens answer 403 to a
 * driver, and a menu that offers what the server will refuse is worse than no
 * menu. A destination is added here when its page exists, never before.
 *
 * ★ THE SCHEDULE IS HOME. `/driver` is exact, and an assignment's detail counts
 * as being there, so the tab stays lit while the driver works a trip.
 */
export interface DriverDestination {
  key: 'schedule' | 'fuel' | 'history' | 'notifications' | 'profile';
  to: string;
  icon: LucideIcon;
  label: TranslationKey;
  exact?: boolean;
  activePaths?: readonly string[];
}

export const DRIVER_NAVIGATION: readonly DriverDestination[] = [
  { key: 'schedule', to: '/driver', icon: CalendarDays, label: 'driverSchedule', exact: true, activePaths: ['/driver/assignments'] },
  // ★ The driver's fuel (0038): record a fill, see where Accounting's check stands, answer "Cần bổ sung".
  { key: 'fuel', to: '/driver/fuel', icon: Fuel, label: 'driverFuelNav' },
  { key: 'history', to: '/driver/history', icon: History, label: 'driverHistory' },
  { key: 'notifications', to: '/driver/notifications', icon: Bell, label: 'driverNotifications' },
  { key: 'profile', to: '/driver/account/security', icon: User, label: 'driverProfile' },
];
