-- 0022_driver_roster_indexes.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- Two indexes for two reads that did not exist until now. Nothing is added,
-- dropped or rewritten: this migration touches no column and no row.
--
-- ★ WHY THESE ARRIVE ONLY NOW. Until this change a driver account was
-- reachable from exactly one place — the assignment dropdown, which asks for
-- LIVE drivers and nothing else — and a driver's work history was only ever
-- read one trip at a time. Both of those are served by what 0014 and 0018
-- already built. The backoffice roster asks two questions neither index can
-- answer, and each of them scans a whole table without one.

-- ================================================ every driver, newest first ==
--
-- ★ THIS REVERSES A DECISION 0018 MADE EXPLICITLY, and the reversal is the
-- point rather than an oversight. 0018 wrote: "Every 'is this caller a driver'
-- check reads this column on the session's user, so it is worth an index only
-- if that read ever stops being by primary key. It is not." That was true then.
-- `GET /driver-accounts` is precisely the read that stops it being true — it
-- selects BY `account_type` and orders by the keyset, so the sentence above no
-- longer describes the queries this table serves.
--
-- `(created_at DESC, id DESC)` matches the ORDER BY of the keyset exactly,
-- tiebreaker included. `id` is in the index because `created_at` is NOT unique:
-- provisioning several people in one transaction stamps them identically, and a
-- page boundary inside such a tie loses rows when the comparison is on the
-- timestamp alone.
CREATE INDEX IF NOT EXISTS idx_users_account_type_page
  ON users (account_type, created_at DESC, id DESC);

-- ============================================ one driver's whole history ==
--
-- ★ NOT A DUPLICATE OF `idx_trip_driver_assignment_driver`, AND THE DIFFERENCE
-- IS THE `WHERE`. That index is PARTIAL on `state = 'active'`, which is exactly
-- right for the question it was built for — "what is this driver on right now"
-- — and useless for this one. A backoffice reader asking what a driver HAS
-- driven wants the ended turns too: the trip somebody was taken off is a fact
-- about that driver, not a row to hide.
--
-- The partial index stays. It is smaller and it still serves the live read,
-- which runs far more often than this one.
CREATE INDEX IF NOT EXISTS idx_trip_driver_assignment_driver_history
  ON trip_driver_assignments (driver_user_id, assigned_at DESC, id DESC);
