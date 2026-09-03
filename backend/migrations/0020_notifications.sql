-- 0020_notifications.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- What a driver is told, kept.
--
-- A driver works from a phone in a lorry cab. When Operations puts them on a
-- trip, sends their completion back, or closes it, they have to learn that
-- promptly — and they have to be able to find it again after the phone slept,
-- the network changed, or the browser was closed. So the notification is a
-- ROW first and a realtime signal second: the signal is how the phone hears
-- quickly, the row is the fact it reconciles against.
--
-- ★ ONE ROW PER BUSINESS EVENT PER RECIPIENT, ENFORCED HERE. Every notification
-- is written inside the transaction of the business change that caused it,
-- keyed by that change — the assignment row, the completion request — so a
-- retried request, a re-delivered event or a second tab cannot produce a second
-- row. The unique index is what makes that true when two writers race.
--
-- ★ NO TEXT, NO MONEY. The row carries the TYPE, the trip, the day of the trip
-- as it stood, and at most the reason a reviewer typed. The sentence a driver
-- reads is composed by the portal in the driver's language; nothing commercial
-- is anywhere near this table, and nothing here joins a cost or a hire.
--
-- ★ `trip_scheduled_on` IS A SNAPSHOT, ON PURPOSE. A driver taken off a trip
-- can no longer read it — `ActiveAssignmentGuard` refuses them — so the
-- notification that says so has to carry the one fact that identifies the trip
-- to a person: which day it was.

CREATE TABLE IF NOT EXISTS notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose it is. The ONLY column any read filters on, and every read does.
  recipient_user_id UUID        NOT NULL REFERENCES users(id),

  type              TEXT        NOT NULL
                                CHECK (type IN ('TRIP_ASSIGNED',
                                                'TRIP_UNASSIGNED',
                                                'COMPLETION_REJECTED',
                                                'COMPLETION_APPROVED')),

  trip_id           UUID        NOT NULL REFERENCES trip_schedules(id),
  trip_scheduled_on DATE        NOT NULL,

  -- The one piece of free text: a reviewer's rejection reason. Never a price.
  detail            TEXT,

  -- ★ THE IDEMPOTENCY KEY. Named after the business row that caused this —
  -- `assignment:<id>:assigned`, `completion:<id>:rejected` — so it is the same
  -- string on every retry of the same change and a different string for a
  -- genuinely new one. Server-minted; a client never supplies it.
  event_key         TEXT        NOT NULL CHECK (length(trim(event_key)) > 0),

  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_event
  ON notifications (recipient_user_id, event_key);

-- The one read: a person's own notifications, newest first.
CREATE INDEX IF NOT EXISTS idx_notification_recipient
  ON notifications (recipient_user_id, created_at DESC, id DESC);

-- Told is told. A notification is withdrawn by being read, never by vanishing —
-- the same rule 0017 puts behind every other historical table.
DROP TRIGGER IF EXISTS notifications_deny_delete ON notifications;
CREATE TRIGGER notifications_deny_delete
  BEFORE DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION deny_delete();
