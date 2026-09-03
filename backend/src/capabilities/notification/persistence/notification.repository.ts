import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { Notification, NotificationInput, NotificationType } from '../domain/notification';

/**
 * SQL for what a person has been told. Opens no transaction; decides nothing.
 *
 * ⚠ EVERY READ AND EVERY WRITE FILTERS ON `recipient_user_id`. There is no
 * method here that takes a notification id alone: an id is only ever paired
 * with the caller it belongs to, so a caller holding somebody else's id gets
 * the same nothing a missing id gets. That is what makes "only your own" true
 * by construction rather than by a check a route could forget.
 */

interface NotificationRow {
  id: string;
  recipient_user_id: string;
  type: NotificationType;
  trip_id: string;
  /** `::text`, for the same reason every other board day is — see `TripRow`. */
  trip_scheduled_on: string;
  detail: string | null;
  read_at: Date | null;
  created_at: Date;
}

const toNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  recipientUserId: row.recipient_user_id,
  type: row.type,
  tripId: row.trip_id,
  tripScheduledOn: row.trip_scheduled_on,
  detail: row.detail,
  readAt: row.read_at,
  createdAt: row.created_at,
});

const COLUMNS = `id, recipient_user_id, type, trip_id, trip_scheduled_on::text AS trip_scheduled_on,
                 detail, read_at, created_at`;

/** Bounded: a phone shows the recent ones, and the recent ones are what matter. */
const LIST_LIMIT = 50;

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes the row, or finds it already written.
   *
   * ★ `ON CONFLICT DO NOTHING`, AND `null` WHEN IT DID NOTHING. A retried
   * assignment request, a re-run of the same transaction, a second writer with
   * the same key — all of them meet `uq_notification_event` and are told, by
   * the null, that there is nothing new to deliver. The caller passes its own
   * transaction, because a notification about a change that then rolls back is
   * a notification about nothing.
   */
  async record(
    input: NotificationInput,
    executor: DatabaseQuery,
  ): Promise<Notification | null> {
    const rows = await executor.query<NotificationRow>(
      `INSERT INTO notifications
         (recipient_user_id, type, trip_id, trip_scheduled_on, detail, event_key)
       VALUES ($1, $2, $3, $4::date, $5, $6)
       ON CONFLICT (recipient_user_id, event_key) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        input.recipientUserId,
        input.type,
        input.tripId,
        input.tripScheduledOn,
        input.detail ?? null,
        input.eventKey,
      ],
    );
    return rows[0] ? toNotification(rows[0]) : null;
  }

  /** A person's own, newest first. Served by `idx_notification_recipient`. */
  async listForUser(userId: string, executor: DatabaseQuery = this.db): Promise<Notification[]> {
    const rows = await executor.query<NotificationRow>(
      `SELECT ${COLUMNS} FROM notifications
        WHERE recipient_user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT ${LIST_LIMIT}`,
      [userId],
    );
    return rows.map(toNotification);
  }

  async countUnread(userId: string, executor: DatabaseQuery = this.db): Promise<number> {
    const rows = await executor.query<{ unread: string }>(
      `SELECT count(*)::text AS unread FROM notifications
        WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    // `count` is bigint, which `pg` hands back as a string.
    return Number(rows[0]?.unread ?? '0');
  }

  /**
   * Marks one of the caller's own as read. Idempotent: a second tap keeps the
   * first time. `null` for an id that is not theirs — indistinguishable from
   * one that does not exist, on purpose.
   */
  async markRead(
    id: string,
    userId: string,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<Notification | null> {
    const rows = await executor.query<NotificationRow>(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, $3)
        WHERE id = $1 AND recipient_user_id = $2
        RETURNING ${COLUMNS}`,
      [id, userId, now],
    );
    return rows[0] ? toNotification(rows[0]) : null;
  }
}
