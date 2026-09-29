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

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

\echo '== A. Trips by status (archived apart)'
SELECT status, archived_at IS NOT NULL AS archived, count(*) AS trips
  FROM trip_schedules
 GROUP BY 1, 2
 ORDER BY 1, 2;

\echo '== The constraint that makes CLOSED_PARTIAL impossible, if validated'
SELECT conname, convalidated
  FROM pg_constraint
 WHERE conrelid = 'trip_schedules'::regclass AND conname = 'trip_schedules_closed_state';

\echo '== B–F, H. Legacy confirmed: counts by classification, closing stamp and time flags'
WITH legacy AS (
  SELECT t.*,
         CASE WHEN t.closed_at IS NOT NULL AND t.closed_by IS NOT NULL THEN 'CLOSED_COMPLETE'
              WHEN t.closed_at IS NULL AND t.closed_by IS NULL         THEN 'CLOSED_MISSING'
              ELSE 'CLOSED_PARTIAL' END AS closed_metadata,
         EXISTS (SELECT 1 FROM trip_completion_requests r
                  WHERE r.trip_id = t.id AND r.state = 'pending') AS pending
    FROM trip_schedules t
   WHERE t.status = 'confirmed'
), classified AS (
  SELECT legacy.*,
         CASE WHEN archived_at IS NOT NULL             THEN 'SKIPPED_ARCHIVED'
              WHEN pending                             THEN 'CONFLICT_PENDING_COMPLETION'
              WHEN closed_metadata = 'CLOSED_PARTIAL'  THEN 'CONFLICT_CLOSED_PARTIAL'
              ELSE 'ELIGIBLE' END AS classification
    FROM legacy
)
SELECT count(*)                                                                    AS "B_confirmed",
       count(*) FILTER (WHERE classification = 'ELIGIBLE')                         AS "C_eligible",
       count(*) FILTER (WHERE classification = 'CONFLICT_PENDING_COMPLETION')      AS "D_conflict_pending_completion",
       count(*) FILTER (WHERE classification = 'CONFLICT_CLOSED_PARTIAL')          AS "D_conflict_closed_partial",
       count(*) FILTER (WHERE archived_at IS NOT NULL)                             AS "E_archived",
       count(*) FILTER (WHERE closed_metadata = 'CLOSED_COMPLETE')                 AS "F_closed_complete",
       count(*) FILTER (WHERE closed_metadata = 'CLOSED_MISSING')                  AS "F_closed_missing",
       count(*) FILTER (WHERE closed_metadata = 'CLOSED_PARTIAL')                  AS "F_closed_partial",
       count(*) FILTER (WHERE pickup_at IS NOT NULL
                          AND (pickup_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> scheduled_on) AS "H_pickup_day_mismatch",
       count(*) FILTER (WHERE pickup_at IS NOT NULL AND delivery_at IS NOT NULL
                          AND delivery_at <= pickup_at)                             AS "H_delivery_not_after_pickup"
  FROM classified;

\echo '== G. Assignments on legacy confirmed trips, by state and end reason'
SELECT a.state, coalesce(a.end_reason, '') AS end_reason, count(*) AS assignments,
       count(DISTINCT a.trip_id) AS trips
  FROM trip_driver_assignments a
  JOIN trip_schedules t ON t.id = a.trip_id
 WHERE t.status = 'confirmed'
 GROUP BY 1, 2
 ORDER BY 1, 2;

\echo '== H. Temporal diagnostics across ALL non-archived trips (a separate debt — never rewritten here)'
SELECT status,
       count(*) FILTER (WHERE pickup_at IS NOT NULL
                          AND (pickup_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> scheduled_on) AS pickup_day_mismatch,
       count(*) FILTER (WHERE pickup_at IS NOT NULL AND delivery_at IS NOT NULL
                          AND delivery_at <= pickup_at)                                         AS delivery_not_after_pickup
  FROM trip_schedules
 WHERE archived_at IS NULL
 GROUP BY status
 ORDER BY status;

\echo '== I, J, K. Explicit ids (I = ELIGIBLE is exactly what --ids would take)'
WITH legacy AS (
  SELECT t.id, t.scheduled_on, t.archived_at,
         (t.closed_at IS NULL) <> (t.closed_by IS NULL) AS partial,
         EXISTS (SELECT 1 FROM trip_completion_requests r
                  WHERE r.trip_id = t.id AND r.state = 'pending') AS pending
    FROM trip_schedules t
   WHERE t.status = 'confirmed'
)
SELECT 'I_ELIGIBLE' AS list, count(*) AS trips, string_agg(id::text, ',' ORDER BY scheduled_on, id) AS ids
  FROM legacy WHERE archived_at IS NULL AND NOT pending AND NOT partial
UNION ALL
SELECT 'J_CONFLICT_PENDING_COMPLETION', count(*), string_agg(id::text, ',' ORDER BY scheduled_on, id)
  FROM legacy WHERE archived_at IS NULL AND pending
UNION ALL
SELECT 'K_CLOSED_PARTIAL', count(*), string_agg(id::text, ',' ORDER BY scheduled_on, id)
  FROM legacy WHERE partial
UNION ALL
SELECT 'SKIPPED_ARCHIVED', count(*), string_agg(id::text, ',' ORDER BY scheduled_on, id)
  FROM legacy WHERE archived_at IS NOT NULL;

\echo '== Detail: one line per legacy confirmed trip'
SELECT t.id, t.created_at, t.scheduled_on, t.pickup_at, t.delivery_at, t.closed_at, t.closed_by,
       t.archived_at IS NOT NULL AS archived,
       (SELECT count(*) FROM trip_driver_assignments a WHERE a.trip_id = t.id AND a.state = 'active')   AS active_turns,
       (SELECT count(*) FROM trip_driver_assignments a WHERE a.trip_id = t.id AND a.state = 'ended')    AS ended_turns,
       (SELECT count(*) FROM trip_completion_requests r WHERE r.trip_id = t.id AND r.state = 'pending') AS pending_requests,
       (SELECT count(*) FROM trip_execution_events e WHERE e.trip_id = t.id AND e.voided_at IS NULL)    AS execution_events,
       (SELECT count(*) FROM trip_costs c WHERE c.trip_id = t.id AND c.voided_at IS NULL)               AS cost_lines,
       (SELECT coalesce(sum(c.amount), 0) FROM trip_costs c WHERE c.trip_id = t.id AND c.voided_at IS NULL)
     + (SELECT coalesce(sum(h.agreed_amount), 0) FROM trip_outsource_hires h
         WHERE h.trip_id = t.id AND h.voided_at IS NULL)                                                AS cost_total,
       pickup_at IS NOT NULL
         AND (t.pickup_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> t.scheduled_on                     AS pickup_day_mismatch,
       t.pickup_at IS NOT NULL AND t.delivery_at IS NOT NULL AND t.delivery_at <= t.pickup_at           AS delivery_not_after_pickup
  FROM trip_schedules t
 WHERE t.status = 'confirmed'
 ORDER BY t.archived_at IS NOT NULL, t.scheduled_on, t.id;

ROLLBACK;
