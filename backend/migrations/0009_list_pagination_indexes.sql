-- 0009_list_pagination_indexes.sql — three indexes, no schema change.
--
-- Keyset pagination asks "the next N rows after this key". That is only cheap
-- if an index already holds the rows IN that key order; otherwise PostgreSQL
-- reads the whole partition and sorts it on every page, and the pagination buys
-- nothing. These three indexes are what make the ordering free.
--
-- Two of them also fix a problem that exists TODAY, before any pagination:
--
--   GET /departments/:id/membership-requests   Parallel Seq Scan + external
--                                              merge, 4.6 MB to disk, 54.2 ms
--   GET /departments/:id/account-invitations   Parallel Seq Scan + external
--                                              merge, 10.0 MB to disk, 84.6 ms
--
-- Both queries filter by `department_id` and sort by `requested_at`, and NEITHER
-- has an index that can serve them: the partial indexes from 0006 and 0007 are
-- `WHERE status = 'pending'`, and these two lists carry no status filter at all
-- — they return the department's whole history. So the existing indexes are not
-- merely unhelpful here, they are ineligible.
--
-- ★ THE DIRECTION OF THE TIEBREAKER MATTERS, and it is easy to get wrong.
-- An index of `(department_id, requested_at DESC, id)` serves an
-- `ORDER BY requested_at DESC, id DESC` query only through an Incremental Sort,
-- because the second column runs the wrong way. Measured on 200,000 rows:
--
--   (department_id, requested_at DESC, id)       Incremental Sort   0.659 ms
--   (department_id, requested_at DESC, id DESC)  pure Index Scan    0.285 ms
--
-- So each index below mirrors its query's ORDER BY exactly, including the id.
--
-- WHY NOT `CREATE INDEX CONCURRENTLY`: the migration runner wraps each file in
-- a transaction (see migration-runner.ts), and CONCURRENTLY cannot run inside
-- one. The blocking form is correct here — building these takes milliseconds to
-- a few seconds at present data volumes and takes only a ShareLock, which
-- blocks writes to the table briefly and does not block reads at all. A
-- deployment large enough for that pause to matter should build them
-- CONCURRENTLY by hand, outside the runner, and then mark this file applied.
--
-- FORWARD ONLY, like every migration here. There is no rollback script: undoing
-- these is `DROP INDEX`, which is instantaneous and loses nothing, because an
-- index holds no data of its own.

-- --------------------------------------------------- department members ----
-- Serves: GET /departments/:departmentId/members
--   ORDER BY created_at ASC, id ASC   (oldest first — joining order)
--
-- PARTIAL on `status = 'active'`, matching the query's own filter. The index
-- then holds only current members while the table keeps every membership that
-- ever existed, so it stays small as history accumulates.
CREATE INDEX IF NOT EXISTS idx_membership_dept_page
  ON department_memberships (department_id, created_at, id)
  WHERE status = 'active';

-- ------------------------------------------- membership change requests ----
-- Serves: GET /departments/:departmentId/membership-requests
--   ORDER BY requested_at DESC, id DESC   (newest first — a history view)
--
-- NOT partial: this list deliberately has no status filter, so a partial index
-- could not answer it. That is precisely why the existing
-- `idx_membership_request_department ... WHERE status = 'pending'` does not
-- help, and why this one has to exist alongside it.
CREATE INDEX IF NOT EXISTS idx_request_dept_page
  ON membership_change_requests (department_id, requested_at DESC, id DESC);

-- ------------------------------------------------- account invitations ----
-- Serves: GET /departments/:departmentId/account-invitations
--   ORDER BY requested_at DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_invitation_dept_page
  ON account_invitations (department_id, requested_at DESC, id DESC);

-- NOTHING IS ADDED FOR THE TWO GLOBAL QUEUES.
--
-- `GET /membership-requests` and `GET /account-invitations` filter
-- `status = 'pending'` and sort by `requested_at ASC`. The partial indexes from
-- 0006 and 0007 already reduce those to the pending rows alone — measured at
-- 0.043 ms — and those queues are bounded by workflow throughput rather than by
-- the deployment's age. An index that buys nothing still costs every write.
