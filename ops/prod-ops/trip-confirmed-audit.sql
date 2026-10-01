-- ============================================================================
-- bo-prod-ops · trip-confirmed-audit — the legacy `confirmed` audit, SANITIZED
-- for CI output. READ ONLY: one READ ONLY transaction, ended by ROLLBACK, and
-- the session itself is opened read-only by the wrapper (PGOPTIONS).
--
-- Output: one `section|key|value` row per fact (the wrapper runs psql -A -t
-- -F '|'). It prints trip UUIDs, classifications, counts and lifecycle state —
-- never customer names, contacts, addresses, notes, cargo, prices, costs,
-- free-text reasons or actor ids. The human-run audit in the trip capability
-- (backend/scripts/legacy-confirmed-dry-run.sql) is the detailed one.
--
-- Classification follows the contract the trip capability owns
-- (`classify` in domain/legacy-confirmed.ts): archived → pending driver request
-- → half closing stamp → ELIGIBLE. This copy only GATES; the normalization CLI
-- re-checks every id under its row lock, so a disagreement can refuse a write
-- but never cause one. See ops/prod-ops/README.md.
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

WITH pending AS (
  SELECT r.trip_id, count(*) AS requests
    FROM trip_completion_requests r
   WHERE r.state = 'pending'
   GROUP BY r.trip_id
), legacy AS (
  SELECT t.id, t.scheduled_on,
         t.archived_at IS NOT NULL                        AS archived,
         coalesce(p.requests, 0) > 0                      AS waiting,
         (t.closed_at IS NULL) <> (t.closed_by IS NULL)   AS stamp_partial,
         CASE WHEN t.closed_at IS NULL AND t.closed_by IS NULL         THEN 'CLOSED_MISSING'
              WHEN t.closed_at IS NOT NULL AND t.closed_by IS NOT NULL THEN 'CLOSED_COMPLETE'
              ELSE 'CLOSED_PARTIAL' END                   AS closed_metadata,
         t.pickup_at IS NOT NULL
           AND (t.pickup_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> t.scheduled_on AS pickup_day_mismatch,
         t.pickup_at IS NOT NULL AND t.delivery_at IS NOT NULL
           AND t.delivery_at <= t.pickup_at               AS delivery_not_after_pickup
    FROM trip_schedules t
    LEFT JOIN pending p ON p.trip_id = t.id
   WHERE t.status = 'confirmed'
), classified AS (
  SELECT l.id, l.scheduled_on, l.closed_metadata, l.pickup_day_mismatch, l.delivery_not_after_pickup,
         CASE WHEN l.archived      THEN 'SKIPPED_ARCHIVED'
              WHEN l.waiting       THEN 'CONFLICT_PENDING_COMPLETION'
              WHEN l.stamp_partial THEN 'CONFLICT_CLOSED_PARTIAL'
              ELSE 'ELIGIBLE' END AS classification
    FROM legacy l
), buckets (bucket, ord) AS (
  VALUES ('ELIGIBLE', 1), ('CONFLICT_PENDING_COMPLETION', 2), ('CONFLICT_CLOSED_PARTIAL', 3),
         ('SKIPPED_ARCHIVED', 4), ('CLOSED_COMPLETE', 5), ('CLOSED_MISSING', 6), ('CLOSED_PARTIAL', 7)
), membership AS (
  -- Each trip sits in two buckets: its classification and its closing stamp.
  SELECT c.id, c.scheduled_on, m.bucket
    FROM classified c
   CROSS JOIN LATERAL (VALUES (c.classification), (c.closed_metadata)) AS m (bucket)
), facts (ord, section, key, value) AS (
  -- ::text on the FIRST branch: it types the whole column, and current_database()
  -- is `name` - 63 bytes - which silently truncated every id list below it.
  SELECT 0, 'meta', v.key, v.value
    FROM (VALUES
      ('database', current_database()::text),
      ('transaction_read_only', current_setting('transaction_read_only')),
      ('closed_state_constraint', coalesce(
         (SELECT CASE WHEN c.convalidated THEN 'validated' ELSE 'not_validated' END
            FROM pg_constraint c
           WHERE c.conrelid = 'trip_schedules'::regclass AND c.conname = 'trip_schedules_closed_state'),
         'absent'))
    ) AS v (key, value)
  UNION ALL
  SELECT 1, 'count', 'confirmed_total', count(*)::text FROM classified
  UNION ALL
  SELECT 1 + b.ord, 'count', b.bucket, count(m.id)::text
    FROM buckets b LEFT JOIN membership m ON m.bucket = b.bucket
   GROUP BY b.bucket, b.ord
  UNION ALL
  SELECT 10, 'temporal', v.key, v.value
    FROM (SELECT count(*) FILTER (WHERE c.pickup_day_mismatch)::text       AS mismatch,
                 count(*) FILTER (WHERE c.delivery_not_after_pickup)::text AS inverted
            FROM classified c) AS n
   CROSS JOIN LATERAL (VALUES ('pickup_day_mismatch', n.mismatch),
                              ('delivery_not_after_pickup', n.inverted)) AS v (key, value)
  UNION ALL
  SELECT 20, 'assignments', a.state, count(*)::text
    FROM trip_driver_assignments a
    JOIN classified c ON c.id = a.trip_id
   GROUP BY a.state
  UNION ALL
  SELECT 30 + b.ord, 'ids', b.bucket,
         coalesce(string_agg(m.id::text, ',' ORDER BY m.scheduled_on ASC, m.id ASC), '')
    FROM buckets b LEFT JOIN membership m ON m.bucket = b.bucket
   GROUP BY b.bucket, b.ord
)
SELECT f.section, f.key, f.value
  FROM facts f
 ORDER BY f.ord ASC, f.key ASC;

ROLLBACK;
