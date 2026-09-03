import { Injectable, type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { NotFoundError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import { signalOf, type Notification, type NotificationInput } from '../domain/notification';
import { NotificationRepository } from '../persistence/notification.repository';
import { NotificationStream } from './notification-stream';

/**
 * Telling people things, durably first and quickly second.
 *
 * ★ THE ORDER IS THE DESIGN, AND IT IS THE CALLER'S TO KEEP:
 *
 *   business transaction  →  record(…, tx)  →  COMMIT  →  deliver(…)
 *
 * `record` runs INSIDE the business transaction, so a notification about a
 * change that rolls back never exists. `deliver` runs AFTER commit, so a phone
 * is never told about a row it cannot yet read — and so a failure to reach the
 * phone cannot undo the business change. Nothing here can roll anything back;
 * `deliver` does not even return a promise.
 *
 * ★ OWNERSHIP IS IN THE QUERY. Every read takes the caller's own id from the
 * session and passes it to a repository that filters on it. There is no way to
 * ask for somebody else's, so there is nothing to refuse.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly stream: NotificationStream,
  ) {}

  /** Inside the caller's transaction. `null` when this event was already recorded. */
  async record(input: NotificationInput, tx: DatabaseQuery): Promise<Notification | null> {
    return this.notifications.record(input, tx);
  }

  /**
   * After commit. Pushes each row that was actually written; the nulls a
   * retry produced are skipped, which is what stops a retried request ringing
   * a phone twice.
   */
  deliver(written: readonly (Notification | null)[]): void {
    for (const notification of written) {
      if (notification) this.stream.publish(notification.recipientUserId, signalOf(notification));
    }
  }

  async listMine(userId: string): Promise<{ items: Notification[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      this.notifications.listForUser(userId),
      this.notifications.countUnread(userId),
    ]);
    return { items, unreadCount };
  }

  /** One of the caller's own. Not theirs answers exactly as not there. */
  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const read = await this.notifications.markRead(notificationId, userId, new Date());
    if (!read) throw new NotFoundError('Notification not found.');
    return read;
  }

  /** The caller's own live stream. Who the caller is came from the session. */
  streamFor(userId: string): Observable<MessageEvent> {
    return this.stream.subscribe(userId);
  }
}
