-- 0016_trip_cost_lifecycle.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- ★ `trip_costs` IS THE EXPENSE TABLE. THERE IS NO SECOND ONE.
--
-- The operational design names an entity called "Driver Operational Expense".
-- That entity is THIS TABLE, extended — not a new `trip_expenses` beside it.
-- Two tables holding the same business concept means two totals, two void
-- rules, two sets of permissions, and a permanent argument about which one a
-- figure came from. 0012 already owns the five categories, the exact `NUMERIC`,
-- the void trio and the `cost.*` permissions; this migration grows it.
--
-- ★ WHAT CHANGES, AND WHY IT IS A CHANGE AT ALL.
--
-- 0012 states, in its own words, that a financial record is immutable the
-- instant it is written: a wrong figure is voided, with a reason, and replaced.
-- That is right for a clerk entering an invoice, and wrong for a driver typing
-- an amount on a phone at a fuel station — a mistyped digit would produce two
-- rows and a void reason saying "typo". The business contract resolves it by
-- giving a DRIVER-DECLARED expense a life before it is final:
--
--   EDITABLE ──(driver submits completion)──► LOCKED ──(approve)──► IMMUTABLE
--       ▲                                       │
--       └──────────────(reject)─────────────────┘
--
-- ★ LOCKED IS NOT IMMUTABLE. Locking is temporary: a rejected completion
-- reopens every line back to EDITABLE. Only APPROVAL makes a figure permanent,
-- because approval is the moment the trip's money becomes something the company
-- has committed to.
--
-- ★ EXISTING BEHAVIOUR IS PRESERVED EXACTLY. `state` defaults to `immutable`,
-- so every row already in the table, and every row the existing `cost.create`
-- route writes, keeps 0012's rule: born final, changeable only by being voided.
-- Nothing that works today stops working. The new lifecycle applies to rows the
-- driver portal writes, which declare `editable` explicitly.
--
-- ★ VOID SURVIVES AT EVERY STATE, AND IS NOT AN EDIT. Withdrawing a record with
-- a reason is how this table has always corrected itself, and the trigger below
-- is written so that the void trio remains writable on an immutable row. A void
-- does not change what a figure WAS; it records that it no longer counts.

-- ------------------------------------------------- the lifecycle, as columns ----

ALTER TABLE trip_costs
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'immutable',

  -- ★ WHICH CHANNEL TYPED THIS, WHICH `created_by` CANNOT ANSWER.
  --
  -- One person may hold both a portal login and a backoffice login, so the
  -- author's id does not say whether a figure came off a phone at a fuel
  -- station or out of an invoice on a desk. Those two are reviewed differently
  -- and trusted differently, so the difference is recorded rather than guessed.
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'backoffice',

  -- Composite provenance. Nullable, because a backoffice line has no driver.
  ADD COLUMN IF NOT EXISTS driver_assignment_id UUID,

  -- Snapshots taken when the line is written. Never joined back to the trip on
  -- read: the trip's vehicle today is not necessarily the vehicle this money was
  -- spent on. `vehicle_ownership` is nullable while 0013's classification is
  -- outstanding, and NULL must never be read as `company`.
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES trip_vehicles(id),
  ADD COLUMN IF NOT EXISTS vehicle_ownership TEXT,

  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id),

  -- Idempotency for the phone on a bad connection, same argument as the
  -- execution events: a retried declaration must collide with its own first
  -- attempt rather than double the trip's fuel bill.
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE trip_costs
  DROP CONSTRAINT IF EXISTS trip_costs_state_values,
  DROP CONSTRAINT IF EXISTS trip_costs_source_values,
  DROP CONSTRAINT IF EXISTS trip_costs_vehicle_ownership_values,
  DROP CONSTRAINT IF EXISTS trip_costs_lock_state,
  DROP CONSTRAINT IF EXISTS trip_costs_editable_not_locked,
  DROP CONSTRAINT IF EXISTS trip_costs_driver_provenance,
  DROP CONSTRAINT IF EXISTS trip_costs_outsourced_category,
  DROP CONSTRAINT IF EXISTS trip_costs_assignment_matches_trip;

ALTER TABLE trip_costs
  ADD CONSTRAINT trip_costs_state_values
    CHECK (state IN ('editable', 'locked', 'immutable')),

  ADD CONSTRAINT trip_costs_source_values
    CHECK (source IN ('driver_portal', 'backoffice')),

  ADD CONSTRAINT trip_costs_vehicle_ownership_values
    CHECK (vehicle_ownership IS NULL OR vehicle_ownership IN ('company', 'outsourced')),

  -- The two lock columns move together. They are NOT required by `state`,
  -- because a backoffice line is born `immutable` without ever having been
  -- locked — it never passed through a completion request at all.
  ADD CONSTRAINT trip_costs_lock_state
    CHECK ((locked_at IS NULL) = (locked_by IS NULL)),

  -- An editable line cannot be holding a lock.
  ADD CONSTRAINT trip_costs_editable_not_locked
    CHECK (state <> 'editable' OR locked_at IS NULL),

  -- A driver-declared line always names the assignment that declared it. A
  -- backoffice line has no assignment and must not invent one.
  ADD CONSTRAINT trip_costs_driver_provenance
    CHECK (source = 'backoffice' OR driver_assignment_id IS NOT NULL),

  -- ★ A HIRED LORRY DOES NOT BILL US FOR ITS OWN FUEL OR TOLLS.
  --
  -- The carrier absorbs both into the one agreed price recorded in
  -- `trip_outsource_hires`. A `fuel` line against an outsourced trip is
  -- therefore either a mistake or the same money counted twice, and the check
  -- reads the SNAPSHOT rather than the vehicle's current classification, so a
  -- reclassification next year cannot retroactively invalidate a row that was
  -- correct when it was written.
  ADD CONSTRAINT trip_costs_outsourced_category
    CHECK (vehicle_ownership IS DISTINCT FROM 'outsourced'
           OR category NOT IN ('fuel', 'toll')),

  -- The assignment must belong to THIS trip. PostgreSQL skips this when
  -- `driver_assignment_id` is NULL, which is exactly right for backoffice rows.
  ADD CONSTRAINT trip_costs_assignment_matches_trip
    FOREIGN KEY (driver_assignment_id, trip_id)
    REFERENCES trip_driver_assignments (id, trip_id);

-- A retry collides with its own first attempt; two different declarations do
-- not. Partial, because the existing rows and every backoffice line carry NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_cost_client_request
  ON trip_costs (trip_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Serves the foreign-key check when an assignment is ended.
CREATE INDEX IF NOT EXISTS idx_trip_cost_assignment
  ON trip_costs (driver_assignment_id)
  WHERE driver_assignment_id IS NOT NULL;

-- ------------------------------------------------------------ T2 · the guard ----
--
-- ★ WHY THIS IS A TRIGGER AND NOT A RULE IN THE SERVICE.
--
-- 0012 could state "financial records are never edited" and simply not write an
-- UPDATE — the rule held because it was UNSPELLABLE. This migration adds an
-- UPDATE path for editable lines, and the moment that path exists the old
-- guarantee becomes a thing somebody has to remember. A trigger is the only
-- place the promise survives a future service, a migration script or a hand-typed
-- statement in psql.
--
-- Two rules, one function:
--
--   1. A figure can only change while the line is EDITABLE.
--   2. An IMMUTABLE line cannot change AT ALL, except to be voided.
--
-- Rule 2 permits the void trio deliberately. Whether an approved figure should
-- still be voidable after the trip closes is an open business decision; the
-- database keeps today's answer rather than silently inventing a stricter one.

CREATE OR REPLACE FUNCTION trip_costs_guard_update() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'editable'
     AND ROW(NEW.trip_id, NEW.category, NEW.amount, NEW.note)
         IS DISTINCT FROM
         ROW(OLD.trip_id, OLD.category, OLD.amount, OLD.note)
  THEN
    RAISE EXCEPTION
      'trip_costs %: an amount, category, note or trip can only change while the line is editable (state is %)',
      OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state = 'immutable'
     AND ROW(NEW.state, NEW.source, NEW.locked_at, NEW.locked_by,
             NEW.driver_assignment_id, NEW.vehicle_id, NEW.vehicle_ownership,
             NEW.created_by, NEW.created_at, NEW.client_request_id)
         IS DISTINCT FROM
         ROW(OLD.state, OLD.source, OLD.locked_at, OLD.locked_by,
             OLD.driver_assignment_id, OLD.vehicle_id, OLD.vehicle_ownership,
             OLD.created_by, OLD.created_at, OLD.client_request_id)
  THEN
    RAISE EXCEPTION
      'trip_costs %: the line is immutable; only voiding it is permitted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trip_costs_guard_update ON trip_costs;

CREATE TRIGGER trip_costs_guard_update
  BEFORE UPDATE ON trip_costs
  FOR EACH ROW
  EXECUTE FUNCTION trip_costs_guard_update();

-- --------------------------------------------------------- trip_cost_edits ----
--
-- ★ NAMED FOR ITS PARENT. The design document calls this "Expense Edit Log";
-- the table it logs is `trip_costs`, so it is `trip_cost_edits`. One vocabulary
-- per table beats matching a document's noun.
--
-- Append-only, one row per FIELD changed, holding the value before and the value
-- after. `trip_costs` still has no `updated_at` and still gets none: a single
-- timestamp saying "something changed at 14:02" answers nothing, and this log
-- answers "who changed the fuel figure from 500000 to 5000000, and when".
--
-- The values are TEXT on both sides because the columns they describe are not
-- one type — an amount, a category and a note all pass through here — and
-- because these are a record of what was typed, never something to compute with.

CREATE TABLE IF NOT EXISTS trip_cost_edits (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_id     UUID        NOT NULL REFERENCES trip_costs(id),
  field       TEXT        NOT NULL CHECK (field IN ('category', 'amount', 'note')),
  old_value   TEXT,
  new_value   TEXT,
  edited_by   UUID        NOT NULL REFERENCES users(id),
  edited_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_cost_edit_cost
  ON trip_cost_edits (cost_id, edited_at DESC);
