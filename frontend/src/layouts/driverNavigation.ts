import { Bell, Truck, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/types/translate';

/**
 * The Driver Portal's navigation MODEL — what a driver may go to, and nothing
 * the Backoffice offers. Data, not markup: the shell draws it.
 *
 * ★ THREE DESTINATIONS, ALL OF THEM THE DRIVER'S OWN. My trips, what I have
 * been told, my account. No roster, no catalogue, no board, no money — those
 * screens answer 403 to a driver, and a menu that offers what the server will
 * refuse is worse than no menu.
 *
 * ★ "MY TRIPS" IS HOME. `/driver` is exact, and a trip's detail counts as
 * being there, so the row stays lit while the driver works a trip.
 */
export interface DriverDestination {
  key: 'trips' | 'notifications' | 'profile';
  to: string;
  icon: LucideIcon;
  label: TranslationKey;
  exact?: boolean;
  activePaths?: readonly string[];
}

export const DRIVER_NAVIGATION: readonly DriverDestination[] = [
  { key: 'trips', to: '/driver', icon: Truck, label: 'driverMyTrips', exact: true, activePaths: ['/driver/trips'] },
  { key: 'notifications', to: '/driver/notifications', icon: Bell, label: 'driverNotifications' },
  { key: 'profile', to: '/driver/account/security', icon: User, label: 'driverProfile' },
];
