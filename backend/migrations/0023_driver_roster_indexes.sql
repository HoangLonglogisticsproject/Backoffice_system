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

-- ==================================================== every driver, by name ==
--
-- ★ THIS REVERSES A DECISION 0018 MADE EXPLICITLY, and the reversal is the
-- point rather than an oversight. 0018 wrote: "Every 'is this caller a driver'
-- check reads this column on the session's user, so it is worth an index only
-- if that read ever stops being by primary key. It is not." That was true then.
-- Driver Management is precisely the read that stops it being true: it selects
-- BY `account_type`, so the sentence above no longer describes the queries this
-- table serves.
--
-- `(display_name, id)` matches the ORDER BY of that list exactly, tiebreaker
-- included — `DriverAccountRepository.list` reads
-- `WHERE account_type = 'driver' ORDER BY display_name ASC, id ASC`.
CREATE INDEX IF NOT EXISTS idx_users_account_type_name
  ON users (account_type, display_name, id);

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
