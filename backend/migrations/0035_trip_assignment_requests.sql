-- 0035 · A driver asking for an open booking — a request, never an assignment
-- ============================================================================
--
-- ★ REQUEST ≠ ASSIGNMENT. A driver may ask to run a booking nobody is on yet;
-- only Dispatch (`dispatch.write`) turns a request into a canonical
-- `trip_driver_assignments` row, choosing the lorry as it does. Until then the
-- driver holds NO assignment, so every assignment-scoped route — the trip, its
-- events, its money — stays closed to them (`ActiveAssignmentGuard`). No trip
-- status is added: "open" is derived (pending, not archived, no active turn).
--
-- Three parts, in the runner's single transaction:
--
--   1. `trip_driver_assignments (id, trip_id, driver_user_id)` UNIQUE — a
--      superset of the primary key, so it holds for every existing row. It is
--      what lets an approved request name THE assignment made from it: same
--      trip, same driver, in a foreign key rather than in a comment.
--
--   2. `trip_assignment_requests` — one row per ask, kept forever.
--      pending → approved | rejected | withdrawn | superseded, once:
--        approved    Dispatch accepted it; `approved_assignment_id` is the turn
--        rejected    Dispatch declined it; `resolution_reason` optional
--        withdrawn   the driver took it back while it was pending
--        superseded  the booking stopped being open under it — another driver
--                    approved, a direct dispatch, the trip closed or archived;
--                    `resolution_reason` says which, as a fixed word
--      At most ONE pending request per driver per trip (the partial unique
--      index); any number of drivers may ask for the same trip.
--
--   3. `notifications.type` gains the two driver-facing outcomes that are not
--      already an existing event. An approval IS an assignment, so the driver
--      is told by the `TRIP_ASSIGNED` row the crew path already writes.

-- ------------------------------------------------- 1. assignment identity ----

DO $$
BEGIN
  -- `conrelid`, not the name alone: constraint names are per schema, and the
  -- table this resolves to is the one on the search path.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'trip_driver_assignments_id_trip_driver'
       AND conrelid = 'trip_driver_assignments'::regclass
  ) THEN
    ALTER TABLE trip_driver_assignments
      ADD CONSTRAINT trip_driver_assignments_id_trip_driver UNIQUE (id, trip_id, driver_user_id);
  END IF;
END $$;

-- ---------------------------------------------------------- 2. requests ----

CREATE TABLE IF NOT EXISTS trip_assignment_requests (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                UUID        NOT NULL REFERENCES trip_schedules(id),
  driver_user_id         UUID        NOT NULL REFERENCES users(id),
  state                  TEXT        NOT NULL DEFAULT 'pending'
                                     CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn', 'superseded')),
  requested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who closed it and when: the dispatcher, the driver withdrawing, or the
  -- person whose action took the booking away (assigning, closing, archiving).
  resolved_at            TIMESTAMPTZ,
  resolved_by            UUID        REFERENCES users(id),
  approved_assignment_id UUID,
  resolution_reason      TEXT,

  CONSTRAINT trip_assignment_requests_resolution
    CHECK ((state = 'pending') = (resolved_at IS NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL)),
  CONSTRAINT trip_assignment_requests_approval
    CHECK ((state = 'approved') = (approved_assignment_id IS NOT NULL)),
  -- The turn made from this request: on this trip, for this driver.
  CONSTRAINT trip_assignment_requests_assignment
    FOREIGN KEY (approved_assignment_id, trip_id, driver_user_id)
    REFERENCES trip_driver_assignments (id, trip_id, driver_user_id),
  -- A rejection may say why (never whitespace); a supersession always says
  -- which of three things happened; nothing else carries a reason.
  CONSTRAINT trip_assignment_requests_reason
    CHECK (CASE state
             WHEN 'rejected' THEN resolution_reason IS NULL OR length(trim(resolution_reason)) > 0
             WHEN 'superseded' THEN resolution_reason IS NOT NULL
                                    AND resolution_reason IN ('trip_assigned', 'trip_closed', 'trip_archived')
             ELSE resolution_reason IS NULL
           END)
);

-- ★ ONE PENDING ASK PER DRIVER PER TRIP — what makes a double tap, or two tabs,
-- one request. Leads with `trip_id`, so it is also "the pending asks on a trip".
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_assignment_request_pending
  ON trip_assignment_requests (trip_id, driver_user_id)
  WHERE state = 'pending';

-- An assignment approves at most one request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_assignment_request_assignment
  ON trip_assignment_requests (approved_assignment_id)
  WHERE approved_assignment_id IS NOT NULL;

-- A driver's own asks, newest first (the portal's "Yêu cầu của tôi").
CREATE INDEX IF NOT EXISTS idx_trip_assignment_request_driver
  ON trip_assignment_requests (driver_user_id, requested_at DESC, id DESC);

-- Every ask on one trip, resolved ones included (Dispatch's review).
CREATE INDEX IF NOT EXISTS idx_trip_assignment_request_trip
  ON trip_assignment_requests (trip_id, requested_at);

-- A resolved request is final, and who asked for what, when, never changes.
CREATE OR REPLACE FUNCTION trip_assignment_requests_guard_update() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'pending'
     OR ROW(NEW.id, NEW.trip_id, NEW.driver_user_id, NEW.requested_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.trip_id, OLD.driver_user_id, OLD.requested_at)
  THEN
    RAISE EXCEPTION 'trip_assignment_requests %: only a pending request may be resolved, and only once', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trip_assignment_requests_guard_update ON trip_assignment_requests;
CREATE TRIGGER trip_assignment_requests_guard_update
  BEFORE UPDATE ON trip_assignment_requests
  FOR EACH ROW EXECUTE FUNCTION trip_assignment_requests_guard_update();

DROP TRIGGER IF EXISTS trip_assignment_requests_deny_delete ON trip_assignment_requests;
CREATE TRIGGER trip_assignment_requests_deny_delete
  BEFORE DELETE ON trip_assignment_requests
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

-- ----------------------------------------------------- 3. notifications ----

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRIP_ASSIGNED',
                  'TRIP_UNASSIGNED',
                  'COMPLETION_REJECTED',
                  'COMPLETION_APPROVED',
                  'ASSIGNMENT_REQUEST_REJECTED',
                  'ASSIGNMENT_REQUEST_SUPERSEDED'));
