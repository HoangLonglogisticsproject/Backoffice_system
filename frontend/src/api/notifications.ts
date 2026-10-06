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
 * Where the realtime socket connects, derived from the SAME base URL every
 * other call uses — so it carries the same cookie, through the same proxy, to
 * the same API, in both environments.
 *
 * ★ TWO PARTS, BECAUSE SOCKET.IO TAKES THEM SEPARATELY. `origin` is the host to
 * dial; `path` is the endpoint the handshake is made against. The path must
 * match the `location /api/socket.io/` block in `deploy/nginx.conf` and the
 * gateway's own `path` option — three places holding one string, and the proxy
 * is the one that fails SILENTLY when they disagree: the client quietly falls
 * back to long-polling and nobody notices until a signal arrives late.
 *
 * ★ THE TWO SHAPES OF `baseURL`, AND WHY THEY NEED DIFFERENT ANSWERS:
 *
 *   `http://localhost:3000`  development. A different ORIGIN, and no nginx in
 *                            between — the backend serves the handshake at its
 *                            own root, so the path carries no prefix.
 *   `/api`                   production. The SAME origin, and the prefix is the
 *                            proxy's: dialling `/api` as a host would be
 *                            meaningless, so the origin is left empty (socket.io
 *                            then uses the page's own) and `/api` moves into the
 *                            path, where nginx is waiting for it.
 */
export const notificationSocketTarget = (): { origin: string; path: string } => {
  const base = httpClient.defaults.baseURL ?? '';

  if (/^https?:\/\//i.test(base)) return { origin: base, path: '/socket.io' };

  return { origin: '', path: `${base}/socket.io` };
};
