-- ============================================================================
-- READ-ONLY PRODUCTION AUDIT: legacy `confirmed` trips, before `confirmed → finished`.
--
-- Writes NOTHING: fail-fast, one READ ONLY transaction, ended by ROLLBACK.
-- Needs no application deploy. Run it with psql -X (no ~/.psqlrc) against the
-- ONE identified Backoffice database container — see the PR's procedure.
--
-- Classification — the normalization CLI applies the same rules, and re-checks
-- each approved id under its row lock before writing anything:
--   ELIGIBLE                     confirmed, not archived, no pending driver
--                                request, closing stamp complete or absent
--   CONFLICT_PENDING_COMPLETION  a driver request is pending   → manual review
--   CONFLICT_CLOSED_PARTIAL      one half of the closing stamp → manual review
--   SKIPPED_ARCHIVED             archived                      → left as it is
-- Closing stamp: CLOSED_COMPLETE (both), CLOSED_MISSING (neither), CLOSED_PARTIAL.
-- Temporal flags are diagnostics only; the normalization never rewrites times.
-- ============================================================================

\set ON_ERROR_STOP on
-- The audit's constants, named once.
\set legacy_status confirmed
\set pending_request pending
\set business_tz Asia/Ho_Chi_Minh

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

\echo '== A. Trips by status (archived apart)'
SELECT t.status, t.archived_at IS NOT NULL AS archived, count(*) AS trips
  FROM trip_schedules t
 GROUP BY t.status, archived
 ORDER BY t.status ASC, archived ASC;

\echo '== The constraint that makes CLOSED_PARTIAL impossible, if validated'
SELECT conname, convalidated
  FROM pg_constraint
 WHERE conrelid = 'trip_schedules'::regclass AND conname = 'trip_schedules_closed_state';

\echo '== B–F, H. Legacy confirmed: counts by classification, closing stamp and time flags'
WITH pending AS (
  SELECT r.trip_id, count(*) AS requests
    FROM trip_completion_requests r
   WHERE r.state = :'pending_request'
   GROUP BY r.trip_id
), legacy AS (
  SELECT t.scheduled_on, t.pickup_at, t.delivery_at,
         t.archived_at IS NOT NULL                            AS archived,
         coalesce(p.requests, 0) > 0                          AS waiting,
         t.closed_at IS NOT NULL AND t.closed_by IS NOT NULL  AS stamp_complete,
         t.closed_at IS NULL AND t.closed_by IS NULL          AS stamp_missing,
         (t.closed_at IS NULL) <> (t.closed_by IS NULL)       AS stamp_partial
    FROM trip_schedules t
    LEFT JOIN pending p ON p.trip_id = t.id
   WHERE t.status = :'legacy_status'
)
SELECT count(*)                                                                    AS "B_confirmed",
       count(*) FILTER (WHERE NOT archived AND NOT waiting AND NOT stamp_partial) AS "C_eligible",
       count(*) FILTER (WHERE NOT archived AND waiting)                           AS "D_conflict_pending_completion",
       count(*) FILTER (WHERE NOT archived AND NOT waiting AND stamp_partial)     AS "D_conflict_closed_partial",
       count(*) FILTER (WHERE archived)                                           AS "E_archived",
       count(*) FILTER (WHERE stamp_complete)                                     AS "F_closed_complete",
       count(*) FILTER (WHERE stamp_missing)                                      AS "F_closed_missing",
       count(*) FILTER (WHERE stamp_partial)                                      AS "F_closed_partial",
       count(*) FILTER (WHERE pickup_at IS NOT NULL
                          AND (pickup_at AT TIME ZONE :'business_tz')::date <> scheduled_on) AS "H_pickup_day_mismatch",
       count(*) FILTER (WHERE pickup_at IS NOT NULL AND delivery_at IS NOT NULL
                          AND delivery_at <= pickup_at)                            AS "H_delivery_not_after_pickup"
  FROM legacy;

\echo '== G. Assignments on legacy confirmed trips, by state and end reason'
SELECT a.state, coalesce(a.end_reason, '') AS end_reason_label, count(*) AS assignments,
       count(DISTINCT a.trip_id) AS trips
  FROM trip_driver_assignments a
  JOIN trip_schedules t ON t.id = a.trip_id
 WHERE t.status = :'legacy_status'
 GROUP BY a.state, end_reason_label
 ORDER BY a.state ASC, end_reason_label ASC;

\echo '== H. Temporal diagnostics across ALL non-archived trips (a separate debt — never rewritten here)'
SELECT t.status,
       count(*) FILTER (WHERE t.pickup_at IS NOT NULL
                          AND (t.pickup_at AT TIME ZONE :'business_tz')::date <> t.scheduled_on) AS pickup_day_mismatch,
       count(*) FILTER (WHERE t.pickup_at IS NOT NULL AND t.delivery_at IS NOT NULL
                          AND t.delivery_at <= t.pickup_at)                                     AS delivery_not_after_pickup
  FROM trip_schedules t
 WHERE t.archived_at IS NULL
 GROUP BY t.status
 ORDER BY t.status ASC;

\echo '== I, J, K. Explicit ids — I (ELIGIBLE) is exactly what --ids would take'
WITH pending AS (
  SELECT r.trip_id, count(*) AS requests
    FROM trip_completion_requests r
   WHERE r.state = :'pending_request'
   GROUP BY r.trip_id
), legacy AS (
  SELECT t.id, t.scheduled_on,
         t.archived_at IS NOT NULL                      AS archived,
         coalesce(p.requests, 0) > 0                    AS waiting,
         (t.closed_at IS NULL) <> (t.closed_by IS NULL) AS stamp_partial
    FROM trip_schedules t
    LEFT JOIN pending p ON p.trip_id = t.id
   WHERE t.status = :'legacy_status'
), lists AS (
  SELECT id, scheduled_on, 'I_ELIGIBLE' AS list FROM legacy WHERE NOT archived AND NOT waiting AND NOT stamp_partial
  UNION ALL
  SELECT id, scheduled_on, 'J_CONFLICT_PENDING_COMPLETION' FROM legacy WHERE NOT archived AND waiting
  UNION ALL
  SELECT id, scheduled_on, 'K_CLOSED_PARTIAL' FROM legacy WHERE stamp_partial
  UNION ALL
  SELECT id, scheduled_on, 'E_SKIPPED_ARCHIVED' FROM legacy WHERE archived
)
SELECT n.list, count(l.id) AS trips, string_agg(l.id::text, ',' ORDER BY l.scheduled_on ASC, l.id ASC) AS ids
  FROM (VALUES ('I_ELIGIBLE'), ('J_CONFLICT_PENDING_COMPLETION'), ('K_CLOSED_PARTIAL'), ('E_SKIPPED_ARCHIVED')) AS n (list)
  LEFT JOIN lists l ON l.list = n.list
 GROUP BY n.list
 ORDER BY n.list ASC;

\echo '== Detail: one line per legacy confirmed trip'
WITH pending AS (
  SELECT r.trip_id, count(*) AS requests
    FROM trip_completion_requests r
   WHERE r.state = :'pending_request'
   GROUP BY r.trip_id
), turns AS (
  SELECT a.trip_id,
         count(*) FILTER (WHERE a.state = 'active') AS active_turns,
         count(*) FILTER (WHERE a.state = 'ended')  AS ended_turns
    FROM trip_driver_assignments a
   GROUP BY a.trip_id
), events AS (
  SELECT e.trip_id, count(*) AS events
    FROM trip_execution_events e
   WHERE e.voided_at IS NULL
   GROUP BY e.trip_id
), costs AS (
  SELECT c.trip_id, count(*) AS lines, sum(c.amount) AS amount
    FROM trip_costs c
   WHERE c.voided_at IS NULL
   GROUP BY c.trip_id
), hires AS (
  SELECT h.trip_id, sum(h.agreed_amount) AS amount
    FROM trip_outsource_hires h
   WHERE h.voided_at IS NULL
   GROUP BY h.trip_id
)
SELECT t.id, t.created_at, t.scheduled_on, t.pickup_at, t.delivery_at, t.closed_at, t.closed_by,
       t.archived_at IS NOT NULL                      AS archived,
       coalesce(tu.active_turns, 0)                   AS active_turns,
       coalesce(tu.ended_turns, 0)                    AS ended_turns,
       coalesce(p.requests, 0)                        AS pending_requests,
       coalesce(ev.events, 0)                         AS execution_events,
       coalesce(c.lines, 0)                           AS cost_lines,
       coalesce(c.amount, 0) + coalesce(h.amount, 0)  AS cost_total,
       CASE WHEN t.archived_at IS NOT NULL                     THEN 'SKIPPED_ARCHIVED'
            WHEN coalesce(p.requests, 0) > 0                   THEN 'CONFLICT_PENDING_COMPLETION'
            WHEN (t.closed_at IS NULL) <> (t.closed_by IS NULL) THEN 'CONFLICT_CLOSED_PARTIAL'
            ELSE 'ELIGIBLE' END                        AS classification,
       CASE WHEN t.closed_at IS NOT NULL AND t.closed_by IS NOT NULL THEN 'CLOSED_COMPLETE'
            WHEN t.closed_at IS NULL AND t.closed_by IS NULL         THEN 'CLOSED_MISSING'
            ELSE 'CLOSED_PARTIAL' END                  AS closed_metadata,
       t.pickup_at IS NOT NULL
         AND (t.pickup_at AT TIME ZONE :'business_tz')::date <> t.scheduled_on AS pickup_day_mismatch,
       t.pickup_at IS NOT NULL AND t.delivery_at IS NOT NULL
         AND t.delivery_at <= t.pickup_at              AS delivery_not_after_pickup
  FROM trip_schedules t
  LEFT JOIN pending p ON p.trip_id = t.id
  LEFT JOIN turns tu  ON tu.trip_id = t.id
  LEFT JOIN events ev ON ev.trip_id = t.id
  LEFT JOIN costs c   ON c.trip_id = t.id
  LEFT JOIN hires h   ON h.trip_id = t.id
 WHERE t.status = :'legacy_status'
 ORDER BY archived ASC, t.scheduled_on ASC, t.id ASC;

ROLLBACK;
