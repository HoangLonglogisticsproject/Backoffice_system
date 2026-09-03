import { httpClient } from './client';
import type { Notification } from '@/types/notification';

/**
 * A person's own notifications. Every call is scoped by the session cookie —
 * there is no id or user to pass, and the server would ignore one.
 */

export interface NotificationPage {
  items: Notification[];
  unreadCount: number;
}

export async function fetchNotifications(): Promise<NotificationPage> {
  const { data } = await httpClient.get<NotificationPage>('/notifications');
  return data;
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  const { data } = await httpClient.post<Notification>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
  );
  return data;
}

/**
 * The live stream, on the same base URL every other call uses — so it goes
 * through the same `/api/` proxy in production and the same allowlisted origin
 * in development, with the same cookie.
 */
export const notificationStreamUrl = (): string =>
  `${httpClient.defaults.baseURL ?? ''}/notifications/stream`;
