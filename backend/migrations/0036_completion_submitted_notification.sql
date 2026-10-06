-- 0036_completion_submitted_notification.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- The one notification that travels UPWARDS.
--
-- Every type 0020 and 0035 opened is something a DRIVER is told: you are on
-- this trip, you are off it, your completion came back, your ask was declined.
-- The approval that ends a trip had no such row in the other direction — a
-- driver pressed "gửi hoàn tất chuyến" and the request sat in the review queue
-- until somebody happened to open that screen. Nothing told the person who has
-- to decide. This type is that telling.
--
-- ★ NO NEW TABLE, NO NEW COLUMN, AND THAT IS THE POINT. `notifications` was
-- never a driver table: `recipient_user_id` references `users`, and every read
-- filters on it alone (see the repository). A SuperAdmin is a user. So the
-- whole of this change is one more word in the CHECK — the row, the unique
-- `event_key`, the deny-delete trigger, the live stream and "only your own"
-- all hold for the new recipient exactly as written.
--
-- ★ IDEMPOTENT PER COMPLETION REQUEST, by the same index 0020 created:
-- `completion:<requestId>:submitted` is minted from the request row, so a
-- driver's retried submit, a re-run transaction or two writers racing produce
-- ONE row and ring the bell once (`uq_notification_event`).
--
-- ★ AND IT CARRIES NOTHING NEW. The type, the trip, the trip's day as it stood.
-- `detail` stays NULL: the figures the reviewer needs are on the review screen,
-- read live under permission, and a notification is not where money goes (0020).
--
-- ⚠ THE RECIPIENT IS RESOLVED IN APPLICATION CODE, NOT HERE. Who holds
-- `trip.complete.review` is a question about `role_assignments`, which 0004
-- already answers and already keeps to ONE active SUPERADMIN
-- (`uq_single_active_superadmin`). A trigger that chose a recipient would be a
-- second authorization model in a place nobody reviews.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRIP_ASSIGNED',
                  'TRIP_UNASSIGNED',
                  'COMPLETION_REJECTED',
                  'COMPLETION_APPROVED',
                  'ASSIGNMENT_REQUEST_REJECTED',
                  'ASSIGNMENT_REQUEST_SUPERSEDED',
                  -- A driver has asked for a turn to be closed. The only type
                  -- addressed to the office rather than to the road.
                  'COMPLETION_SUBMITTED'));
