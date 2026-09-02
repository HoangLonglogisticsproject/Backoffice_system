-- 0013_trip_carrier_and_vehicle_ownership.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- The first of five migrations that turn the dispatch board into an operational
-- lifecycle. This one answers a single question the board has never been able to
-- answer: WHOSE LORRY IS THIS?
--
-- 0012 recorded a hired lorry's price against a carrier NAME typed as free text,
-- and said why: the real names — `Hai Thành`, `Hải Râu`, `xe Út`, `Mr Đạt` — are
-- a company, a nickname, somebody's lorry and a person, and nobody knew whether
-- the catalogue row should be a carrier, a vehicle or a driver. The business
-- contract has since settled it: a CARRIER is an entity, and a carrier owns
-- vehicles. So the catalogue is built now, and `trip_vehicles` gains the
-- ownership the board never had.
--
-- ★ THIS MIGRATION DELIBERATELY BACKFILLS NOTHING.
--
-- `ownership` is added NULLABLE, with NO DEFAULT, and it stays that way. A
-- default would write a fact about every lorry that ever ran without anybody
-- asserting it — "all company" invents a fleet, "all unknown" invents a
-- category the business does not have. Both are the same mistake: making the
-- database claim something no human said. The classification is a later,
-- evidence-based migration; until then NULL honestly means NOT YET CLASSIFIED,
-- which is the only true statement available.
--
-- ⚠ THE BUSINESS ENUM HAS EXACTLY TWO VALUES. There is no `unknown`. A lorry is
-- ours or it is hired; that is the whole of the model. NULL is the ABSENCE of a
-- classification, not a third kind of lorry — which is precisely why it lives in
-- the column's nullability rather than in the CHECK.

-- ------------------------------------------------------------ trip_carriers ----
--
-- The counterparty a hired lorry belongs to. Shaped exactly like `trip_customers`
-- from 0011, and for the same reasons: a normalisation column so `HAI THANH` and
-- `Hai  Thành` cannot both be registered, `archived` rather than DELETE so a
-- carrier that stops trading keeps every historical row explicable.

CREATE TABLE IF NOT EXISTS trip_carriers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  name_key    TEXT        GENERATED ALWAYS AS
                          (upper(trim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,
  note        TEXT,
  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),
  created_by  UUID        NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique among ACTIVE carriers only — the same rule 0011 applies to plates and
-- customer names, so an archived carrier's name can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_carrier_name
  ON trip_carriers (name_key)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trip_carriers_set_updated_at ON trip_carriers;

CREATE TRIGGER trip_carriers_set_updated_at
  BEFORE UPDATE ON trip_carriers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------- trip_vehicles: whose lorry is it ----

ALTER TABLE trip_vehicles
  ADD COLUMN IF NOT EXISTS ownership TEXT,
  ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES trip_carriers(id),
  -- ★ WHO SAID SO, AND WHEN.
  --
  -- Ownership is not derivable from anything already recorded — that is the
  -- entire finding that produced this migration. So every non-null value has to
  -- name the human who asserted it, or the column becomes a fact with no author
  -- and the "no invented ownership" rule has nothing holding it up. These two
  -- columns are what makes the backfill auditable rather than merely careful.
  ADD COLUMN IF NOT EXISTS ownership_set_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS ownership_set_at TIMESTAMPTZ;

-- Two values, and no `unknown`. NULL carries "not yet classified" instead.
ALTER TABLE trip_vehicles
  DROP CONSTRAINT IF EXISTS trip_vehicles_ownership_values;

ALTER TABLE trip_vehicles
  ADD CONSTRAINT trip_vehicles_ownership_values
    CHECK (ownership IS NULL OR ownership IN ('company', 'outsourced'));

-- A hired lorry names its carrier; ours cannot name one.
--
-- ★ WRITTEN AS A `CASE`, AND THE REASON IS A BUG A REAL DATABASE CAUGHT.
--
-- The obvious spelling is a disjunction of the three legal shapes:
--
--   (ownership IS NULL       AND carrier_id IS NULL)
--   OR (ownership = 'company'    AND carrier_id IS NULL)
--   OR (ownership = 'outsourced' AND carrier_id IS NOT NULL)
--
-- That is WRONG, and wrong in the direction that lets bad data in. With
-- `ownership` NULL and a carrier set, the third branch evaluates
-- `NULL = 'outsourced'` → NULL, and `NULL AND true` → NULL. The whole
-- expression becomes `false OR false OR NULL` = NULL, and a CHECK ACCEPTS
-- NULL. An unclassified lorry could carry a carrier — the exact row the
-- constraint exists to refuse.
--
-- `CASE` has no such hole: an unmatched value, NULL included, falls to `ELSE`,
-- and every branch yields a plain boolean. Three-valued logic is why this
-- constraint is not written the way it reads most naturally.
ALTER TABLE trip_vehicles
  DROP CONSTRAINT IF EXISTS trip_vehicles_ownership_carrier;

ALTER TABLE trip_vehicles
  ADD CONSTRAINT trip_vehicles_ownership_carrier
    CHECK (
      CASE ownership
        WHEN 'outsourced' THEN carrier_id IS NOT NULL
        WHEN 'company'    THEN carrier_id IS NULL
        -- Not yet classified. It may not point at a carrier either.
        ELSE                   carrier_id IS NULL
      END
    );

-- The classification and its provenance arrive together or not at all — the same
-- shape 0012 gives the void trio, for the same reason: a half-set row is a fact
-- nobody can attribute.
ALTER TABLE trip_vehicles
  DROP CONSTRAINT IF EXISTS trip_vehicles_ownership_provenance;

ALTER TABLE trip_vehicles
  ADD CONSTRAINT trip_vehicles_ownership_provenance
    CHECK (
      (ownership IS NULL     AND ownership_set_by IS NULL     AND ownership_set_at IS NULL)
      OR
      (ownership IS NOT NULL AND ownership_set_by IS NOT NULL AND ownership_set_at IS NOT NULL)
    );

-- Serves the foreign-key check PostgreSQL runs when a carrier row is updated —
-- the same reason 0011 indexes `trip_schedules.vehicle_id`. Partial, because a
-- company lorry has no carrier and has no business in this index.
CREATE INDEX IF NOT EXISTS idx_trip_vehicle_carrier
  ON trip_vehicles (carrier_id)
  WHERE carrier_id IS NOT NULL;

-- ------------------------------------- trip_outsource_hires: naming the carrier ----
--
-- ★ THE FREE-TEXT NAME STAYS, AND IS STILL THE ONLY REQUIRED ONE.
--
-- 0012 records `carrier_name` as typed and explains why: the real values are a
-- company, a nickname, somebody's lorry and a person, and the name as written is
-- the one fact that is certainly true and cannot be recovered if thrown away.
-- That argument has not expired. What changes is that a hire MAY now also point
-- at a catalogue row, for the carriers somebody has actually registered.
--
-- ⚠ NOTHING CONVERTS THE EXISTING NAMES. Matching `xe Út` to a carrier row is a
-- judgement about who a counterparty IS, and getting it wrong points historical
-- money at the wrong company. That is a later migration, made from evidence,
-- with a human deciding each match — not a `LIKE` in this file.

ALTER TABLE trip_outsource_hires
  ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES trip_carriers(id);

CREATE INDEX IF NOT EXISTS idx_trip_outsource_hire_carrier
  ON trip_outsource_hires (carrier_id)
  WHERE carrier_id IS NOT NULL;

-- ------------------------------------------------- the classification backlog ----
--
-- ★ EVERY VEHICLE ROW IS UNCLASSIFIED THE MOMENT THIS MIGRATION FINISHES, and
-- that is the intended end state, not an unfinished job. The next migration in
-- this sequence sets `ownership` from evidence, one asserted batch at a time.
--
-- Until then the rule the application must hold is the honest one: a trip whose
-- vehicle has no ownership yet cannot record an ownership snapshot, so the
-- snapshot columns 0016 adds are nullable too. Nothing downstream is allowed to
-- read NULL as `company`.
