-- 0017_trip_completion_and_history.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- How a trip ends, and the proof that it ended that way.
--
-- Three things arrive together because they are one rule seen from three sides:
-- a driver ASKS for a trip to be closed, a SuperAdmin DECIDES, and the decision
-- makes the trip permanent. Splitting them across migrations would leave a
-- window in which a trip could be closed with nothing recording who closed it.
--
-- ★ DONE IS TERMINAL, AND THE DATABASE IS WHAT MAKES IT SO.
--
-- 0011 gave `trip_schedules.status` five values and no transition rules at all —
-- `done` can be set, and then unset, by any caller holding `trip.write`, leaving
-- no trace that it ever happened. The contract says a completed trip is closed
-- permanently, because everything downstream — invoicing, reconciliation, the
-- driver's expense record — treats DONE as the point after which figures stop
-- moving. A promise that any UPDATE can undo is not a promise.

-- ------------------------------------------- trip_schedules: the closing pair ----

ALTER TABLE trip_schedules
  -- When the trip was closed, and by whom. Distinct from `status = 'done'`:
  -- the status is the board's word, these two are the audit of the decision.
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id),

  -- ★ THE ONE FREE-TEXT FIELD A DRIVER IS ALLOWED TO SEE.
  --
  -- The contract promises a driver never sees commercial data, and the trip
  -- already carries four free-text columns — cargo, addresses, contacts, note —
  -- that may contain anything somebody typed, prices included. Rather than
  -- filtering those on the way out and hoping, Operations gets a field written
  -- FOR the driver, and the driver read model whitelists this one.
  ADD COLUMN IF NOT EXISTS driver_instructions TEXT;

ALTER TABLE trip_schedules
  DROP CONSTRAINT IF EXISTS trip_schedules_closed_state;

ALTER TABLE trip_schedules
  ADD CONSTRAINT trip_schedules_closed_state
    CHECK ((closed_at IS NULL) = (closed_by IS NULL));

-- ------------------------------------------------ trip_completion_requests ----
--
-- ★ ONE ROW PER ATTEMPT. A rejected request is never overwritten and never
-- reused — resubmitting INSERTS a new row with the next `attempt_no`. Three
-- rejections and an approval leave four rows, which is the only shape that can
-- answer "how many times was this sent back, and why".

CREATE TABLE IF NOT EXISTS trip_completion_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id              UUID        NOT NULL REFERENCES trip_schedules(id),

  -- Which assignment asked. Composite with `trip_id`, so a request can never
  -- carry another trip's assignment.
  driver_assignment_id UUID        NOT NULL,

  attempt_no           INTEGER     NOT NULL CHECK (attempt_no >= 1),

  -- ★ THE DRIVER SAYS WHETHER THERE WAS ANY MONEY, AND IS NEVER ASSUMED TO.
  --
  -- Without this column "no expenses on this trip" and "the driver forgot to
  -- enter them" are the same thing: zero rows. They are not the same thing at
  -- all — one is a fact and the other is an omission, and only the driver can
  -- tell them apart. NOT NULL with NO DEFAULT, so the answer has to be given
  -- rather than inherited.
  --
  -- A resubmission is a new row, so it carries a new declaration: a driver
  -- correcting a rejected trip states the position again rather than having
  -- last week's answer carried forward.
  expense_declaration  TEXT        NOT NULL
                                   CHECK (expense_declaration IN ('none', 'expenses')),

  state                TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (state IN ('pending', 'approved', 'rejected')),

  submitted_by         UUID        NOT NULL REFERENCES users(id),
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  decided_by           UUID        REFERENCES users(id),
  decided_at           TIMESTAMPTZ,
  decision_reason      TEXT,

  CONSTRAINT trip_completion_requests_assignment_matches_trip
    FOREIGN KEY (driver_assignment_id, trip_id)
    REFERENCES trip_driver_assignments (id, trip_id),

  -- A decision and its author arrive together, and a pending request has
  -- neither. Same shape as the void trio.
  CONSTRAINT trip_completion_requests_decision_state
    CHECK (
      (state = 'pending' AND decided_at IS NULL     AND decided_by IS NULL)
      OR
      (state <> 'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
    ),

  -- ★ A REJECTION ALWAYS SAYS WHY, AND THE DATABASE IS WHERE THAT IS SETTLED.
  --
  -- Two existing approval flows in this codebase collect a rejection reason in
  -- the UI and drop it on the floor in the API — documented product debt. A
  -- driver told only "rejected" cannot act, so here the reason is a column the
  -- row cannot exist without.
  CONSTRAINT trip_completion_requests_reject_reason
    CHECK (state <> 'rejected'
           OR (decision_reason IS NOT NULL AND length(trim(decision_reason)) > 0))
);

-- ★ AT MOST ONE PENDING REQUEST PER TRIP — the double-submit answer. A driver
-- tapping twice, or two tabs, both pass an application check and one loses here.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_completion_pending
  ON trip_completion_requests (trip_id)
  WHERE state = 'pending';

-- ★ AND AT MOST ONE APPROVAL, EVER. This is what makes approval terminal at the
-- storage layer: once a trip has an approved request, a second one cannot be
-- written, so a trip cannot be completed twice by two approvers racing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_completion_approved
  ON trip_completion_requests (trip_id)
  WHERE state = 'approved';

-- Attempts are numbered, and the numbering cannot repeat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_completion_attempt
  ON trip_completion_requests (trip_id, attempt_no);

CREATE INDEX IF NOT EXISTS idx_trip_completion_assignment
  ON trip_completion_requests (driver_assignment_id);

-- ---------------------------------------------------- trip_status_history ----
--
-- Every dispatch status change, with who and why. Insert-only.
--
-- `from_status` is nullable for exactly one case: the row written when the trip
-- is created, which has no previous value.

CREATE TABLE IF NOT EXISTS trip_status_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES trip_schedules(id),
  from_status TEXT,
  to_status   TEXT        NOT NULL,
  reason      TEXT,
  changed_by  UUID        NOT NULL REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT trip_status_history_actually_changed
    CHECK (from_status IS NULL OR from_status <> to_status)
);

CREATE INDEX IF NOT EXISTS idx_trip_status_history_trip
  ON trip_status_history (trip_id, changed_at DESC);

-- ------------------------------------------------------------ T1 · terminal ----

CREATE OR REPLACE FUNCTION trip_schedules_guard_done() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'done' AND NEW.status <> 'done' THEN
    RAISE EXCEPTION
      'trip_schedules %: a completed trip cannot be reopened (done -> %)',
      OLD.id, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trip_schedules_guard_done ON trip_schedules;

CREATE TRIGGER trip_schedules_guard_done
  BEFORE UPDATE ON trip_schedules
  FOR EACH ROW
  EXECUTE FUNCTION trip_schedules_guard_done();

-- ------------------------------------------------------- T3 · no deletions ----
--
-- ★ A HISTORICAL RECORD IS NOT DELETABLE, AND THE APPLICATION IS NOT WHERE THAT
-- IS DECIDED.
--
-- A boundary rule already greps the source for `DELETE` and fails the build, so
-- no service can issue one today. That check protects the code; it does nothing
-- about a maintenance script, an ORM somebody adds later, or a psql session at
-- the end of a long day. Every table below is a record of something that
-- HAPPENED — money spent, a lorry arriving, a decision taken — and the correct
-- way to withdraw any of them already exists: void it, with a reason.
--
-- One function, seven triggers. Statement-level would be cheaper but reports the
-- table without the row; row-level names what was nearly lost.

CREATE OR REPLACE FUNCTION deny_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% is a historical record and cannot be deleted (row %); withdraw it instead',
    TG_TABLE_NAME, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trip_costs_deny_delete ON trip_costs;
CREATE TRIGGER trip_costs_deny_delete
  BEFORE DELETE ON trip_costs
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

DROP TRIGGER IF EXISTS trip_outsource_hires_deny_delete ON trip_outsource_hires;
CREATE TRIGGER trip_outsource_hires_deny_delete
  BEFORE DELETE ON trip_outsource_hires
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

DROP TRIGGER IF EXISTS trip_cost_edits_deny_delete ON trip_cost_edits;
CREATE TRIGGER trip_cost_edits_deny_delete
  BEFORE DELETE ON trip_cost_edits
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

DROP TRIGGER IF EXISTS trip_driver_assignments_deny_delete ON trip_driver_assignments;
CREATE TRIGGER trip_driver_assignments_deny_delete
  BEFORE DELETE ON trip_driver_assignments
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

DROP TRIGGER IF EXISTS trip_execution_events_deny_delete ON trip_execution_events;
CREATE TRIGGER trip_execution_events_deny_delete
  BEFORE DELETE ON trip_execution_events
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

DROP TRIGGER IF EXISTS trip_completion_requests_deny_delete ON trip_completion_requests;
CREATE TRIGGER trip_completion_requests_deny_delete
  BEFORE DELETE ON trip_completion_requests
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

DROP TRIGGER IF EXISTS trip_status_history_deny_delete ON trip_status_history;
CREATE TRIGGER trip_status_history_deny_delete
  BEFORE DELETE ON trip_status_history
  FOR EACH ROW EXECUTE FUNCTION deny_delete();
