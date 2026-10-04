-- 0034 · A lorry's daily fuel: its policy, its cost ledger, its daily check
-- ============================================================================
--
-- ★ FUEL BELONGS TO THE LORRY, NOT TO THE FIRST TRIP OF THE DAY. A tank filled
-- at 06:00 serves every run the lorry makes, so it cannot be a line on one of
-- them: every trip total (board, history, export, cost-summary) sums
-- `trip_costs` by `trip_id`, and the morning fill would land in whichever run
-- happened to start first. So the lorry gets a ledger of its own, and a trip
-- or an assignment appears on it only as PROVENANCE — where the declaration
-- was made, never whose money it is. Nothing here touches `trip_costs`.
--
-- Three parts, in the runner's single transaction:
--
--   1. `trip_vehicles.daily_fuel_check_required` — the POLICY. A structured
--      flag rather than the note ("Xe cty" is text nobody can enforce on), and
--      not `ownership`, which no write path sets yet (0013): gating on it would
--      gate nothing, and reading NULL as `company` is forbidden. DEFAULT false,
--      so no existing lorry is gated by the deploy; an administrator turns it
--      on in "Danh mục xe & khách". Never on for a hired lorry — its fuel is
--      inside the carrier's price (contract §8.6).
--
--   2. `vehicle_costs` — the LEDGER. Starts with `fuel`. Liters and odometer
--      are optional readings; price per liter is not stored (amount ÷ liters).
--      Immutable once written; withdrawn by a void, never deleted.
--      ⚠ That a row's `vehicle_id` is the lorry of its `source_assignment_id`
--      is an APPLICATION invariant (`VehicleFuelService` reads the lorry off
--      the locked assignment), not a foreign key: no constraint here says it.
--
--   3. `vehicle_daily_fuel_checks` — the OBLIGATION, one row per lorry per
--      business day (Asia/Ho_Chi_Minh). `fuel_added` links the fill it
--      recorded; `no_fuel` records the answer with no 0-đồng cost. A fact, not
--      a ledger entry: voiding its fill does not undo the check. Fuel fills
--      themselves stay 0..N a day — nothing limits `vehicle_costs` per day.
--
-- ★ THE PRIMARY KEY IS THE CONCURRENCY GUARANTEE. Two drivers on two trips of
-- the same lorry declare in the same instant: both `INSERT … ON CONFLICT
-- (vehicle_id, business_date) DO NOTHING`, PostgreSQL makes the second wait
-- for the first to commit, and the loser reads the winner's check. The fill a
-- check names is written AFTER the check, in the same transaction, which is
-- why that foreign key is DEFERRABLE: the loser never writes a fill at all.
--
-- Idempotent: `IF NOT EXISTS` / `DROP … IF EXISTS` throughout.
--
-- ★ `lock_timeout`, as in 0027–0033: the ALTER takes ACCESS EXCLUSIVE on
-- `trip_vehicles`, which every board and driver read joins. Adding a column
-- with a constant default is metadata-only, so the lock is held for an instant
-- — but queueing behind a long transaction would stall every one of them.

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------- 1. policy ----

ALTER TABLE trip_vehicles
  ADD COLUMN IF NOT EXISTS daily_fuel_check_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE trip_vehicles
  DROP CONSTRAINT IF EXISTS trip_vehicles_fuel_check_not_outsourced;

ALTER TABLE trip_vehicles
  ADD CONSTRAINT trip_vehicles_fuel_check_not_outsourced
  CHECK (NOT daily_fuel_check_required OR ownership IS DISTINCT FROM 'outsourced');

-- ------------------------------------------------------------- 2. ledger ----

CREATE TABLE IF NOT EXISTS vehicle_costs (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id           UUID          NOT NULL REFERENCES trip_vehicles(id),
  business_date        DATE          NOT NULL,
  category             TEXT          NOT NULL CHECK (category IN ('fuel')),
  amount               NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  liters               NUMERIC(10,2) CHECK (liters IS NULL OR liters > 0),
  odometer_km          INTEGER       CHECK (odometer_km IS NULL OR odometer_km >= 0),
  note                 TEXT,
  source               TEXT          NOT NULL CHECK (source IN ('driver_portal', 'backoffice')),
  -- Provenance only: where the declaration was made, never who owns the money.
  source_trip_id       UUID,
  source_assignment_id UUID,
  client_request_id    TEXT          CHECK (client_request_id IS NULL OR length(trim(client_request_id)) > 0),
  created_by           UUID          NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  voided_at            TIMESTAMPTZ,
  voided_by            UUID          REFERENCES users(id),
  void_reason          TEXT,
  -- What a daily check's foreign key points at: the fill, on that lorry, that day.
  CONSTRAINT vehicle_costs_id_vehicle_day UNIQUE (id, vehicle_id, business_date),
  CONSTRAINT vehicle_costs_provenance_pair
    CHECK ((source_trip_id IS NULL) = (source_assignment_id IS NULL)),
  CONSTRAINT vehicle_costs_driver_provenance
    CHECK (source <> 'driver_portal' OR source_assignment_id IS NOT NULL),
  CONSTRAINT vehicle_costs_source_assignment
    FOREIGN KEY (source_assignment_id, source_trip_id)
    REFERENCES trip_driver_assignments (id, trip_id),
  CONSTRAINT vehicle_costs_void_state
    CHECK ((voided_at IS NULL) = (voided_by IS NULL)),
  CONSTRAINT vehicle_costs_void_reason_needs_void
    CHECK (void_reason IS NULL OR voided_at IS NOT NULL),
  -- 0012's rule for trip_costs: a reason, when given, is not whitespace.
  CONSTRAINT vehicle_costs_void_reason_not_blank
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_cost_vehicle_day
  ON vehicle_costs (vehicle_id, business_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_cost_client_request
  ON vehicle_costs (vehicle_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- A figure is final once written: only the void columns may change, once.
CREATE OR REPLACE FUNCTION vehicle_costs_guard_update() RETURNS trigger AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL
     OR ROW(NEW.id, NEW.vehicle_id, NEW.business_date, NEW.category, NEW.amount,
            NEW.liters, NEW.odometer_km, NEW.note, NEW.source, NEW.source_trip_id,
            NEW.source_assignment_id, NEW.client_request_id, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM
        ROW(OLD.id, OLD.vehicle_id, OLD.business_date, OLD.category, OLD.amount,
            OLD.liters, OLD.odometer_km, OLD.note, OLD.source, OLD.source_trip_id,
            OLD.source_assignment_id, OLD.client_request_id, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'vehicle_costs %: a vehicle cost is immutable; only voiding it once is permitted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicle_costs_guard_update ON vehicle_costs;
CREATE TRIGGER vehicle_costs_guard_update
  BEFORE UPDATE ON vehicle_costs
  FOR EACH ROW EXECUTE FUNCTION vehicle_costs_guard_update();

DROP TRIGGER IF EXISTS vehicle_costs_deny_delete ON vehicle_costs;
CREATE TRIGGER vehicle_costs_deny_delete
  BEFORE DELETE ON vehicle_costs
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

-- --------------------------------------------------------- 3. obligation ----

CREATE TABLE IF NOT EXISTS vehicle_daily_fuel_checks (
  vehicle_id           UUID        NOT NULL REFERENCES trip_vehicles(id),
  business_date        DATE        NOT NULL,
  outcome              TEXT        NOT NULL CHECK (outcome IN ('fuel_added', 'no_fuel')),
  vehicle_cost_id      UUID,
  source_trip_id       UUID        NOT NULL,
  source_assignment_id UUID        NOT NULL,
  client_request_id    TEXT        NOT NULL CHECK (length(trim(client_request_id)) > 0),
  created_by           UUID        NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, business_date),
  -- A fill when fuel was added; no 0-đồng cost when it was not.
  CONSTRAINT vehicle_daily_fuel_checks_outcome_cost
    CHECK ((outcome = 'fuel_added') = (vehicle_cost_id IS NOT NULL)),
  -- ponytail: `fuel` is the only category, so the FK does not name it; add
  -- `category` to it when the ledger gains a second one.
  CONSTRAINT vehicle_daily_fuel_checks_cost
    FOREIGN KEY (vehicle_cost_id, vehicle_id, business_date)
    REFERENCES vehicle_costs (id, vehicle_id, business_date)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT vehicle_daily_fuel_checks_source_assignment
    FOREIGN KEY (source_assignment_id, source_trip_id)
    REFERENCES trip_driver_assignments (id, trip_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_daily_fuel_check_client_request
  ON vehicle_daily_fuel_checks (vehicle_id, client_request_id);

-- A fact: never rewritten, never removed. Its own function rather than 0017's
-- `deny_delete()`, which names the row by an `id` this table does not have.
CREATE OR REPLACE FUNCTION vehicle_daily_fuel_checks_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'vehicle_daily_fuel_checks (%, %): a daily fuel check is a recorded fact and cannot be changed or deleted',
    OLD.vehicle_id, OLD.business_date
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicle_daily_fuel_checks_immutable ON vehicle_daily_fuel_checks;
CREATE TRIGGER vehicle_daily_fuel_checks_immutable
  BEFORE UPDATE OR DELETE ON vehicle_daily_fuel_checks
  FOR EACH ROW EXECUTE FUNCTION vehicle_daily_fuel_checks_immutable();
