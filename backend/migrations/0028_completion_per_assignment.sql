-- 0028_completion_per_assignment.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- A completion request belongs to an ASSIGNMENT, not to the trip.
--
-- 0017 allowed one pending and one approved request per TRIP, because a trip
-- had one driver. With several lorries on a trip (0027, ADR-0004) every driver
-- closes their own turn: driver A's approval must not stop driver B asking,
-- and `attempt_no` counts one assignment's attempts, not the trip's.
--
-- The trip itself is still closed explicitly — `trip_schedules.status`,
-- `closed_at`, `closed_by`, `trip_status_history` all stay — when every active
-- assignment has an approved request. That decision is the completion
-- service's, under the trip row lock; it is not a derived state.
--
-- ★ AUDIT FIRST. The new scopes are narrower than the old, so existing rows
-- cannot violate them (one pending per trip implies one per assignment). That
-- is reasoned, not assumed: the block below counts, and refuses the file if the
-- reasoning is wrong, rather than deleting a row to make it right.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  pending_dupes  integer;
  approved_dupes integer;
  attempt_dupes  integer;
BEGIN
  SELECT count(*) INTO pending_dupes FROM (
    SELECT driver_assignment_id FROM trip_completion_requests
     WHERE state = 'pending' GROUP BY driver_assignment_id HAVING count(*) > 1) d;

  SELECT count(*) INTO approved_dupes FROM (
    SELECT driver_assignment_id FROM trip_completion_requests
     WHERE state = 'approved' GROUP BY driver_assignment_id HAVING count(*) > 1) d;

  SELECT count(*) INTO attempt_dupes FROM (
    SELECT driver_assignment_id, attempt_no FROM trip_completion_requests
     GROUP BY driver_assignment_id, attempt_no HAVING count(*) > 1) d;

  IF pending_dupes > 0 OR approved_dupes > 0 OR attempt_dupes > 0 THEN
    RAISE EXCEPTION
      '0028: trip_completion_requests cannot be re-scoped to the assignment (% assignments with >1 pending, % with >1 approved, % duplicate attempt numbers). Resolve by hand; this file deletes nothing.',
      pending_dupes, approved_dupes, attempt_dupes
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

DROP INDEX IF EXISTS uq_trip_completion_pending;
DROP INDEX IF EXISTS uq_trip_completion_approved;
DROP INDEX IF EXISTS uq_trip_completion_attempt;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_completion_pending
  ON trip_completion_requests (driver_assignment_id)
  WHERE state = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_completion_approved
  ON trip_completion_requests (driver_assignment_id)
  WHERE state = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_completion_attempt
  ON trip_completion_requests (driver_assignment_id, attempt_no);

-- ★ THE TRIP-SIDE READ KEEPS ITS INDEX. `uq_trip_completion_attempt` was also
-- what served "every attempt on this trip, newest first" and the review
-- queue's `DISTINCT ON (trip_id) ... ORDER BY attempt_no DESC`. Both order by
-- `attempt_no`, never by `submitted_at`, so this is the shape that replaces it.
CREATE INDEX IF NOT EXISTS idx_trip_completion_trip_attempt
  ON trip_completion_requests (trip_id, attempt_no DESC);

-- `idx_trip_completion_assignment (driver_assignment_id)` is now covered by the
-- leading column of `uq_assignment_completion_attempt`. It is left in place:
-- dropping an index is a separate, evidence-backed change, not a side effect
-- of this one.
