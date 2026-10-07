-- 0037 · Fuel transactions — one real refuelling event, and its evidence
-- ============================================================================
--
-- ★ NOT A LEDGER. A fuel transaction holds no amount and no total ever reads
-- it. The money of a fill lives in EXACTLY ONE financial row — a lorry's
-- `vehicle_costs` line (0034) or, for fuel recorded before the lorry ledger
-- existed, a trip's `trip_costs` line (0012/0016). This table says which one,
-- and keeps what that row cannot hold: when the fill happened, who drove, the
-- station, the receipt — and, for a trip-backed fill, the lorry and readings
-- the trip line never had.
--
-- ★ NOTHING EXISTING IS ALTERED. No column, constraint or trigger is added to
-- `vehicle_costs` or `trip_costs`; every rule lives on the new tables. A
-- foreign key into them takes only FOR KEY SHARE, which a driver's edit or a
-- void (FOR NO KEY UPDATE) does not wait on.
--
-- ★ WRAPPED LAZILY. A fill gets a row the first time its cost receives
-- evidence or a descriptive fact; until then the read model shows the cost as
-- it is. The driver's write path is untouched.
--
-- ★ FIELD OWNERSHIP — each fact in one place:
--   amount            always the backing row, never here
--   vehicle, day      the vehicle cost (copied here, pinned by a foreign key)
--                     or, trip-backed, HERE — chosen by the office
--   liters, odometer  the vehicle cost, or HERE when trip-backed (CHECK)
--   time, driver, station, tax code, document series and number   HERE
-- Each descriptive fact may be ADDED once (NULL → value) and is then fixed;
-- `fuel_transaction_enrichments` says who added which, and when.
--
-- Four tables, in the runner's single transaction. Idempotent throughout.
--
-- ★ `lock_timeout`, as in 0027–0034: the foreign keys take a brief lock on
-- the tables they reference, which every board and driver read joins.

SET LOCAL lock_timeout = '5s';

-- --------------------------------------------------- 1. fuel transactions ----

CREATE TABLE IF NOT EXISTS fuel_transactions (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       UUID          NOT NULL REFERENCES trip_vehicles(id),
  business_date    DATE          NOT NULL,
  vehicle_cost_id  UUID          REFERENCES vehicle_costs(id),
  trip_cost_id     UUID          REFERENCES trip_costs(id),
  liters           NUMERIC(10,2) CHECK (liters IS NULL OR liters > 0),
  odometer_km      INTEGER       CHECK (odometer_km IS NULL OR odometer_km >= 0),
  occurred_at      TIMESTAMPTZ,
  driver_user_id   UUID          REFERENCES users(id),
  vendor_name      TEXT,
  vendor_tax_code  TEXT,
  document_series  TEXT,
  document_number  TEXT,
  created_by       UUID          NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  voided_at        TIMESTAMPTZ,
  voided_by        UUID          REFERENCES users(id),
  void_reason      TEXT,
  -- Exactly one financial backing: never both ledgers, never neither.
  CONSTRAINT fuel_transactions_one_backing
    CHECK ((vehicle_cost_id IS NULL) <> (trip_cost_id IS NULL)),
  -- A vehicle-backed copy of the lorry and the day cannot drift from the cost.
  CONSTRAINT fuel_transactions_vehicle_backing
    FOREIGN KEY (vehicle_cost_id, vehicle_id, business_date)
    REFERENCES vehicle_costs (id, vehicle_id, business_date),
  -- A vehicle cost already holds its readings; a second copy could disagree.
  CONSTRAINT fuel_transactions_readings_on_cost
    CHECK (vehicle_cost_id IS NULL OR (liters IS NULL AND odometer_km IS NULL)),
  CONSTRAINT fuel_transactions_occurred_on_day
    CHECK (occurred_at IS NULL OR (occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = business_date),
  CONSTRAINT fuel_transactions_vendor_name
    CHECK (vendor_name IS NULL OR (length(vendor_name) BETWEEN 1 AND 200 AND vendor_name = btrim(vendor_name))),
  CONSTRAINT fuel_transactions_vendor_tax_code
    CHECK (vendor_tax_code IS NULL OR vendor_tax_code ~ '^[0-9]{10}([0-9]{2})?(-[0-9]{3})?$'),
  CONSTRAINT fuel_transactions_document_series
    CHECK (document_series IS NULL OR document_series ~ '^[A-Z0-9][A-Z0-9/.-]{0,19}$'),
  CONSTRAINT fuel_transactions_document_number
    CHECK (document_number IS NULL OR document_number ~ '^[A-Z0-9][A-Z0-9/.-]{0,29}$'),
  CONSTRAINT fuel_transactions_void_state
    CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL)),
  CONSTRAINT fuel_transactions_void_reason_not_blank
    CHECK (void_reason IS NULL OR length(btrim(void_reason)) > 0)
);

-- One live fill per financial row, on each ledger.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_transaction_vehicle_cost
  ON fuel_transactions (vehicle_cost_id)
  WHERE vehicle_cost_id IS NOT NULL AND voided_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_transaction_trip_cost
  ON fuel_transactions (trip_cost_id)
  WHERE trip_cost_id IS NOT NULL AND voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_transaction_vehicle_day
  ON fuel_transactions (vehicle_id, business_date)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_transaction_document
  ON fuel_transactions (vendor_tax_code, document_number)
  WHERE voided_at IS NULL AND document_number IS NOT NULL;

-- What was written stays written: the lorry, the day, the backing and the
-- readings never change; each descriptive fact is added at most once; a void
-- happens once and freezes the row.
CREATE OR REPLACE FUNCTION fuel_transactions_guard_update() RETURNS trigger AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'fuel_transactions %: a voided fuel transaction cannot change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF ROW(NEW.id, NEW.vehicle_id, NEW.business_date, NEW.vehicle_cost_id, NEW.trip_cost_id,
         NEW.liters, NEW.odometer_km, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.vehicle_id, OLD.business_date, OLD.vehicle_cost_id, OLD.trip_cost_id,
         OLD.liters, OLD.odometer_km, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'fuel_transactions %: the lorry, day, backing and readings are fixed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.occurred_at     IS NOT NULL AND NEW.occurred_at     IS DISTINCT FROM OLD.occurred_at)
  OR (OLD.driver_user_id  IS NOT NULL AND NEW.driver_user_id  IS DISTINCT FROM OLD.driver_user_id)
  OR (OLD.vendor_name     IS NOT NULL AND NEW.vendor_name     IS DISTINCT FROM OLD.vendor_name)
  OR (OLD.vendor_tax_code IS NOT NULL AND NEW.vendor_tax_code IS DISTINCT FROM OLD.vendor_tax_code)
  OR (OLD.document_series IS NOT NULL AND NEW.document_series IS DISTINCT FROM OLD.document_series)
  OR (OLD.document_number IS NOT NULL AND NEW.document_number IS DISTINCT FROM OLD.document_number)
  THEN
    RAISE EXCEPTION 'fuel_transactions %: a recorded fact is never overwritten', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fuel_transactions_guard_update ON fuel_transactions;
CREATE TRIGGER fuel_transactions_guard_update
  BEFORE UPDATE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION fuel_transactions_guard_update();

-- ★ THE BACKING MUST BE WHAT THE ROW CLAIMS, checked when it is wrapped: a
-- live fuel line; the lorry a trip line names, or one the trip records (a
-- NULL-lorry line on a multi-lorry trip belongs to the ONE lorry the office
-- confirmed, never inferred from the trip). A driver is a driver account, and
-- the one the cost's own provenance names when it names one. Never a fixed
-- lorry → driver rule: a lorry has no permanent driver.
CREATE OR REPLACE FUNCTION fuel_transactions_validate() RETURNS trigger AS $$
DECLARE
  backing RECORD;
BEGIN
  IF NEW.driver_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.driver_user_id AND account_type = 'driver'
  ) THEN
    RAISE EXCEPTION 'fuel_transactions: the driver must be a driver account'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.vehicle_cost_id IS NOT NULL THEN
    SELECT category, voided_at, source, created_by AS provenance_driver INTO backing
      FROM vehicle_costs WHERE id = NEW.vehicle_cost_id;
    IF FOUND AND backing.source <> 'driver_portal' THEN backing.provenance_driver := NULL; END IF;
  ELSE
    SELECT tc.category, tc.voided_at, tc.vehicle_id, tc.trip_id, a.driver_user_id AS provenance_driver
      INTO backing
      FROM trip_costs tc
      LEFT JOIN trip_driver_assignments a ON a.id = tc.driver_assignment_id
     WHERE tc.id = NEW.trip_cost_id;
  END IF;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing backing
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF backing.category <> 'fuel' OR backing.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'fuel_transactions: the backing must be a live fuel cost'
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- The trip-line branch only: a row naming both backings is the CHECK's to refuse.
    IF NEW.vehicle_cost_id IS NULL THEN
      IF backing.vehicle_id IS NOT NULL AND backing.vehicle_id <> NEW.vehicle_id THEN
        RAISE EXCEPTION 'fuel_transactions: the trip cost names another lorry'
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF backing.vehicle_id IS NULL AND EXISTS (
        SELECT 1 FROM trip_driver_assignments WHERE trip_id = backing.trip_id AND vehicle_id IS NOT NULL
        UNION ALL
        SELECT 1 FROM trip_schedules WHERE id = backing.trip_id AND vehicle_id IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM trip_driver_assignments WHERE trip_id = backing.trip_id AND vehicle_id = NEW.vehicle_id
        UNION ALL
        SELECT 1 FROM trip_schedules WHERE id = backing.trip_id AND vehicle_id = NEW.vehicle_id
      ) THEN
        RAISE EXCEPTION 'fuel_transactions: that lorry is not on the trip'
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.driver_user_id IS NOT NULL AND backing.provenance_driver IS NOT NULL
     AND NEW.driver_user_id <> backing.provenance_driver THEN
    RAISE EXCEPTION 'fuel_transactions: the cost names another driver'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fuel_transactions_validate ON fuel_transactions;
CREATE TRIGGER fuel_transactions_validate
  BEFORE INSERT OR UPDATE OF driver_user_id ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION fuel_transactions_validate();

DROP TRIGGER IF EXISTS fuel_transactions_deny_delete ON fuel_transactions;
CREATE TRIGGER fuel_transactions_deny_delete
  BEFORE DELETE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

-- ------------------------------------------ 2. who added which fact, when ----

CREATE TABLE IF NOT EXISTS fuel_transaction_enrichments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_transaction_id UUID        NOT NULL REFERENCES fuel_transactions(id),
  field               TEXT        NOT NULL CHECK (field IN ('occurred_at', 'driver_user_id', 'vendor_name',
                                                         'vendor_tax_code', 'document_series', 'document_number')),
  value               TEXT        NOT NULL CHECK (length(value) > 0),
  recorded_by         UUID        NOT NULL REFERENCES users(id),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A fact is added once, so it is logged once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_transaction_enrichment_field
  ON fuel_transaction_enrichments (fuel_transaction_id, field);

-- ------------------------------------------------------------- 3. evidence ----

CREATE TABLE IF NOT EXISTS fuel_transaction_evidence (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256              TEXT        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Content-addressed: identical bytes are stored once, whoever sent them.
  storage_key         TEXT        NOT NULL,
  mime_type           TEXT        NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size           INTEGER     NOT NULL CHECK (byte_size BETWEEN 1 AND 2000000),
  original_filename   TEXT        CHECK (original_filename IS NULL OR length(original_filename) BETWEEN 1 AND 255),
  evidence_type       TEXT        CHECK (evidence_type IS NULL OR evidence_type IN
                                    ('pump_meter', 'timemark', 'fuel_voucher', 'receipt', 'tax_invoice')),
  -- Typed by a person from what the image shows; never EXIF, never a clock.
  captured_at         TIMESTAMPTZ,
  uploaded_by         UUID        NOT NULL REFERENCES users(id),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  discarded_at        TIMESTAMPTZ,
  discarded_by        UUID        REFERENCES users(id),
  fuel_transaction_id UUID        REFERENCES fuel_transactions(id),
  attached_by         UUID        REFERENCES users(id),
  attached_at         TIMESTAMPTZ,
  retired_at          TIMESTAMPTZ,
  retired_by          UUID        REFERENCES users(id),
  retire_reason       TEXT,
  CONSTRAINT fuel_transaction_evidence_key
    CHECK (storage_key = 'fuel-evidence/' || sha256),
  CONSTRAINT fuel_transaction_evidence_attached
    CHECK ((fuel_transaction_id IS NULL) = (attached_at IS NULL) AND (attached_at IS NULL) = (attached_by IS NULL)),
  CONSTRAINT fuel_transaction_evidence_discard_pair
    CHECK ((discarded_at IS NULL) = (discarded_by IS NULL)),
  CONSTRAINT fuel_transaction_evidence_discard_staged_only
    CHECK (discarded_at IS NULL OR attached_at IS NULL),
  CONSTRAINT fuel_transaction_evidence_retire_state
    CHECK ((retired_at IS NULL) = (retired_by IS NULL) AND (retired_at IS NULL) = (retire_reason IS NULL)),
  CONSTRAINT fuel_transaction_evidence_retire_attached_only
    CHECK (retired_at IS NULL OR attached_at IS NOT NULL),
  CONSTRAINT fuel_transaction_evidence_retire_reason_not_blank
    CHECK (retire_reason IS NULL OR length(btrim(retire_reason)) > 0)
);

-- ★ THE HARD RULE: the same image cannot be on the same fill twice. Across
-- fills it is a warning a person confirms, so `sha256` is NOT unique globally.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_evidence_on_transaction
  ON fuel_transaction_evidence (fuel_transaction_id, sha256)
  WHERE fuel_transaction_id IS NOT NULL AND retired_at IS NULL;

-- A retried upload is the same staged row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_evidence_staged
  ON fuel_transaction_evidence (uploaded_by, sha256)
  WHERE attached_at IS NULL AND discarded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_evidence_sha256
  ON fuel_transaction_evidence (sha256);

CREATE INDEX IF NOT EXISTS idx_fuel_evidence_transaction
  ON fuel_transaction_evidence (fuel_transaction_id, attached_at)
  WHERE fuel_transaction_id IS NOT NULL;

-- Staged → attached once, or → discarded once; attached → retired once. The
-- file itself never changes, and attached evidence never moves.
CREATE OR REPLACE FUNCTION fuel_transaction_evidence_guard_update() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.id, NEW.sha256, NEW.storage_key, NEW.mime_type, NEW.byte_size,
         NEW.original_filename, NEW.uploaded_by, NEW.uploaded_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.sha256, OLD.storage_key, OLD.mime_type, OLD.byte_size,
         OLD.original_filename, OLD.uploaded_by, OLD.uploaded_at)
  THEN
    RAISE EXCEPTION 'fuel_transaction_evidence %: the file is fixed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.discarded_at IS NOT NULL OR OLD.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'fuel_transaction_evidence %: discarded or retired evidence is a record', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.attached_at IS NOT NULL
     AND ROW(NEW.fuel_transaction_id, NEW.attached_by, NEW.attached_at, NEW.evidence_type,
             NEW.captured_at, NEW.discarded_at, NEW.discarded_by)
         IS DISTINCT FROM
         ROW(OLD.fuel_transaction_id, OLD.attached_by, OLD.attached_at, OLD.evidence_type,
             OLD.captured_at, OLD.discarded_at, OLD.discarded_by)
  THEN
    RAISE EXCEPTION 'fuel_transaction_evidence %: attached evidence is only ever retired', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fuel_transaction_evidence_guard_update ON fuel_transaction_evidence;
CREATE TRIGGER fuel_transaction_evidence_guard_update
  BEFORE UPDATE ON fuel_transaction_evidence
  FOR EACH ROW EXECUTE FUNCTION fuel_transaction_evidence_guard_update();

DROP TRIGGER IF EXISTS fuel_transaction_evidence_deny_delete ON fuel_transaction_evidence;
CREATE TRIGGER fuel_transaction_evidence_deny_delete
  BEFORE DELETE ON fuel_transaction_evidence
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

-- ------------------------------------- 4. duplicate warnings acknowledged ----

-- Written by the duplicate check (PR-2): "this looked like X, and the office
-- said it is a different fill". Created here so the foundation is one file.
CREATE TABLE IF NOT EXISTS fuel_match_acks (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_fuel_transaction_id UUID        NOT NULL REFERENCES fuel_transactions(id),
  matched_fuel_transaction_id UUID        REFERENCES fuel_transactions(id),
  matched_vehicle_cost_id     UUID        REFERENCES vehicle_costs(id),
  matched_trip_cost_id        UUID        REFERENCES trip_costs(id),
  level                       TEXT        NOT NULL CHECK (level IN ('exact', 'high', 'possible')),
  basis                       TEXT        NOT NULL CHECK (basis IN ('evidence_hash', 'document_identity', 'fingerprint')),
  evidence_id                 UUID        REFERENCES fuel_transaction_evidence(id),
  acknowledged_by             UUID        NOT NULL REFERENCES users(id),
  acknowledged_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_match_acks_one_match
    CHECK (num_nonnulls(matched_fuel_transaction_id, matched_vehicle_cost_id, matched_trip_cost_id) = 1),
  CONSTRAINT fuel_match_acks_not_self
    CHECK (matched_fuel_transaction_id IS DISTINCT FROM subject_fuel_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_match_ack_subject
  ON fuel_match_acks (subject_fuel_transaction_id);

-- ------------------------------------------------- append-only, both logs ----

CREATE OR REPLACE FUNCTION fuel_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% %: an append-only record cannot change', TG_TABLE_NAME, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fuel_transaction_enrichments_append_only ON fuel_transaction_enrichments;
CREATE TRIGGER fuel_transaction_enrichments_append_only
  BEFORE UPDATE ON fuel_transaction_enrichments
  FOR EACH ROW EXECUTE FUNCTION fuel_append_only();

DROP TRIGGER IF EXISTS fuel_transaction_enrichments_deny_delete ON fuel_transaction_enrichments;
CREATE TRIGGER fuel_transaction_enrichments_deny_delete
  BEFORE DELETE ON fuel_transaction_enrichments
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

DROP TRIGGER IF EXISTS fuel_match_acks_append_only ON fuel_match_acks;
CREATE TRIGGER fuel_match_acks_append_only
  BEFORE UPDATE ON fuel_match_acks
  FOR EACH ROW EXECUTE FUNCTION fuel_append_only();

DROP TRIGGER IF EXISTS fuel_match_acks_deny_delete ON fuel_match_acks;
CREATE TRIGGER fuel_match_acks_deny_delete
  BEFORE DELETE ON fuel_match_acks
  FOR EACH ROW EXECUTE FUNCTION deny_delete();
