-- 0014_trip_driver_assignment.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- Who is driving. The board has recorded WHICH LORRY since 0011 and WHAT IT COST
-- since 0012, and has never once recorded a person.
--
-- ★ THERE IS NO `drivers` TABLE, AND THERE WILL NOT BE ONE. A driver is a `users`
-- row — the same account that signs in, held by the same identity and session
-- machinery as everybody else. A second person-table would mean two answers to
-- "who is this", and the one that gets out of date is always the one nobody
-- signs in with. What is new here is not the person; it is the RELATIONSHIP
-- between a person and a trip, over time.
--
-- ★ ONE ROW PER ASSIGNMENT, AND ASSIGNMENTS ARE NEVER OVERWRITTEN. Replacing a
-- driver ENDS the current row and INSERTS a new one. A column on `trip_schedules`
-- would have been three lines shorter and would have destroyed the answer to
-- "who was driving when this expense was recorded" every time a driver changed —
-- which is the one question the whole operational lifecycle is built to answer.
--
-- MVP SCOPE: 1 trip = 1 customer + 1 vehicle + 1 driver. The vehicle stays on
-- `trip_schedules.vehicle_id`; there is no vehicle-assignment table, by decision.

CREATE TABLE IF NOT EXISTS trip_driver_assignments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID        NOT NULL REFERENCES trip_schedules(id),

  -- The driver, as an account. `users(id)` and nothing else.
  driver_user_id  UUID        NOT NULL REFERENCES users(id),

  state           TEXT        NOT NULL DEFAULT 'active'
                              CHECK (state IN ('active', 'ended')),

  assigned_by     UUID        NOT NULL REFERENCES users(id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  ended_by        UUID        REFERENCES users(id),
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT,

  -- ★ THE COMPOSITE KEY THAT MAKES PROVENANCE UNFORGEABLE.
  --
  -- `id` alone is already unique, so this index buys nothing on its own. It
  -- exists to be the TARGET of a composite foreign key: an execution event or an
  -- expense references `(driver_assignment_id, trip_id)` TOGETHER, so the
  -- database itself refuses a row that pairs one trip's id with another trip's
  -- assignment. Without it, that pairing is only ever checked by whichever
  -- service happens to remember to check it.
  CONSTRAINT trip_driver_assignments_id_trip UNIQUE (id, trip_id),

  -- The four end columns move as one. Same shape as `trip_costs_void_state`:
  -- an assignment that ended with no reason is a change nobody can explain, and
  -- an `active` row carrying an end date is a contradiction the schema should
  -- never be able to hold.
  CONSTRAINT trip_driver_assignments_end_state
    CHECK (
      (state = 'active' AND ended_at IS NULL     AND ended_by IS NULL     AND end_reason IS NULL)
      OR
      (state = 'ended'  AND ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL)
    ),

  CONSTRAINT trip_driver_assignments_end_reason_not_blank
    CHECK (end_reason IS NULL OR length(trim(end_reason)) > 0)
);

-- ★ AT MOST ONE ACTIVE DRIVER PER TRIP — ENFORCED BY POSTGRESQL, NOT BY A SERVICE.
--
-- This is the entire concurrency answer for driver assignment. Two operators
-- assigning different drivers to the same trip at the same instant both pass
-- every application check — they read the same empty state — and one of them
-- loses here, at COMMIT, with a unique violation. An `IF NOT EXISTS` in
-- TypeScript cannot do this; nothing that reads before it writes can.
--
-- Partial on `state = 'active'` so the history keeps as many `ended` rows as a
-- trip needs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_active_driver_assignment
  ON trip_driver_assignments (trip_id)
  WHERE state = 'active';

-- A trip's assignment history, newest first.
CREATE INDEX IF NOT EXISTS idx_trip_driver_assignment_trip
  ON trip_driver_assignments (trip_id, assigned_at DESC);

-- "What am I driving today" — the Driver Portal's only broad read. Partial,
-- because a driver's finished trips are never on that screen.
CREATE INDEX IF NOT EXISTS idx_trip_driver_assignment_driver
  ON trip_driver_assignments (driver_user_id)
  WHERE state = 'active';
