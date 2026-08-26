-- 0010_trip_schedule.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- Replaces the shared workbook `LỊCH XE - CHI PHÍ XE.xlsx`, where dispatch kept
-- one sheet per month and one row per trip. Three tables, and the split is the
-- whole reason this is a migration rather than a spreadsheet import:
--
--   trip_vehicles    the trucks, as rows
--   trip_customers   the customers, as rows
--   trip_schedules   the trips — the sheet itself
--
-- ★ WHY THE FIRST TWO EXIST AT ALL. In the workbook the plate and the customer
-- are typed into the cell every time, and the data shows exactly what that
-- costs: `50H44266` and `50H49266` are two spellings of one truck, `51D.65233`
-- and `51D65233` are two more, and `VIỄN ĐẠT` and `VIẼN ĐẠT` are one customer
-- twice. Nothing can be counted per truck or per customer while that is true.
-- A foreign key makes the misspelling unrepresentable instead of merely
-- discouraged.
--
-- NO COST COLUMNS. The workbook has a second block (DẦU · CẦU TRẠM · PHÍ KHO ·
-- BỐC XẾP · TĂNG CA) filled in on two sheets out of seven. It is a different
-- workflow with a different approver, and guessing its shape from twelve filled
-- cells would be inventing a schema rather than recording one. It gets its own
-- migration when somebody specifies it.

-- ---------------------------------------------------------- trip_vehicles ----
CREATE TABLE IF NOT EXISTS trip_vehicles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactly as somebody typed it, and what every screen shows. Formatting is
  -- theirs; only matching is ours.
  plate       TEXT        NOT NULL CHECK (length(trim(plate)) > 0),

  -- ★ THE MATCHING KEY, and the reason this table stops the duplicates.
  --
  -- Generated rather than written by the application: a normalisation the
  -- service computes is a normalisation that is missed the day somebody inserts
  -- from a script, and then the unique index below silently stops meaning
  -- anything. Same technique as `requires_membership_status` in 0004.
  --
  -- Strips everything that is not a letter or a digit, so `51D.65233`,
  -- `51D 65233` and `51d-65233` all collide — which is precisely the collision
  -- the workbook could not produce.
  plate_key   TEXT        GENERATED ALWAYS AS
                          (upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))) STORED,

  note        TEXT,

  -- Archive, never delete: trips reference this row forever, and a truck
  -- leaving the fleet must not take its history with it.
  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),

  created_by  UUID        NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique among ACTIVE vehicles only. An archived plate must be re-registrable —
-- a truck can be sold and a plate reissued — and a permanent unique index would
-- make that impossible for no benefit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_vehicle_plate
  ON trip_vehicles (plate_key)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trip_vehicles_set_updated_at ON trip_vehicles;

CREATE TRIGGER trip_vehicles_set_updated_at
  BEFORE UPDATE ON trip_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------- trip_customers ----
CREATE TABLE IF NOT EXISTS trip_customers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  name        TEXT        NOT NULL CHECK (length(trim(name)) > 0),

  -- ⚠ WHAT THIS CATCHES, AND WHAT IT DOES NOT.
  --
  -- Case and runs of whitespace, so `WWL`, `wwl` and `W W L` collide, and so do
  -- the trailing spaces the workbook is full of.
  --
  -- It does NOT catch `VIỄN ĐẠT` against `VIẼN ĐẠT`. Those are different
  -- Unicode strings and no normalisation short of a similarity search would
  -- merge them — nor should one, since `VIỄN` and `VIẼN` could in principle be
  -- two real companies. What actually prevents that pair is that a dispatcher
  -- picks from a list instead of typing. This index is the second line, not the
  -- first.
  name_key    TEXT        GENERATED ALWAYS AS
                          (upper(trim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,

  note        TEXT,

  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),

  created_by  UUID        NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_customer_name
  ON trip_customers (name_key)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trip_customers_set_updated_at ON trip_customers;

CREATE TRIGGER trip_customers_set_updated_at
  BEFORE UPDATE ON trip_customers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------- trip_schedules ----
CREATE TABLE IF NOT EXISTS trip_schedules (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Column B of the sheet, and the ONLY column any reader filters on.
  --
  -- DATE, not TIMESTAMPTZ: this is the day of the dispatch board, a day on a
  -- wall calendar. Giving it a timezone would make "the trips on 4 August"
  -- depend on where the reader is standing.
  scheduled_on      DATE        NOT NULL,

  -- Column C. NULLABLE, and not by oversight: the workbook genuinely contains
  -- rows reading `ĐIỀN SAU` ("fill in later") — a trip is committed to a
  -- customer before a truck is assigned to it. Forcing a vehicle here would
  -- force dispatch to invent one.
  vehicle_id        UUID        REFERENCES trip_vehicles(id),

  -- Column D. Nullable for the same reason: internal moves have no customer.
  customer_id       UUID        REFERENCES trip_customers(id),

  -- Columns E–L, kept as free text on purpose. These are the parts of the sheet
  -- that are genuinely prose — multi-line addresses, driver names with licence
  -- numbers, carton counts in three notations. Modelling them would be
  -- modelling a guess; the two columns worth normalising were normalised above.
  cargo_info        TEXT,                          -- E  THÔNG TIN LÔ HÀNG
  pickup_address    TEXT,                          -- F  ĐỊA CHỈ LẤY HÀNG
  delivery_address  TEXT,                          -- G  ĐỊA CHỈ GIAO HÀNG
  pickup_contact    TEXT,                          -- H  LIÊN HỆ LẤY HÀNG
  delivery_contact  TEXT,                          -- I  LIÊN HỆ GIAO HÀNG

  -- Columns J and K. FULL TIMESTAMPS, not times of day.
  --
  -- The sheet writes `08H30` in one cell and `09H00 SÁNG 04 AUG 2026` in the
  -- next, because delivery routinely lands on a later day than pickup. A TIME
  -- column cannot represent that, and storing the overflow in the note is how
  -- the information stops being queryable.
  pickup_at         TIMESTAMPTZ,
  delivery_at       TIMESTAMPTZ,

  note              TEXT,                          -- L  GHI CHÚ

  -- ★ THE ROW COLOUR, PROMOTED TO A COLUMN.
  --
  -- In the workbook this is the fill colour of the row, with the legend written
  -- at the bottom of each sheet (rows 71–75 of "Tháng 8-2026"). A colour cannot
  -- be filtered, counted, or read by anyone who prints in greyscale — which is
  -- why it is the one derived field this table adds to the twelve columns.
  --
  --   awaiting_production   ĐANG ĐỢI SX                     (red)
  --   awaiting_vehicle      SX RỒI ĐANG ĐỢI XE              (yellow)
  --   needs_confirmation    THÔNG TIN CẦN XÁC NHẬN LẠI      (orange)
  --   external_booking      BOOK XE NGOÀI                   (blue)
  --   done                  ĐÃ XONG                         (green)
  status            TEXT        NOT NULL DEFAULT 'awaiting_production'
                                CHECK (status IN ('awaiting_production',
                                                  'awaiting_vehicle',
                                                  'needs_confirmation',
                                                  'external_booking',
                                                  'done')),

  -- The one thing the workbook could never answer: who wrote this row.
  created_by        UUID        NOT NULL REFERENCES users(id),

  -- Deleting a row is deleting a day's dispatch record, and B13 forbids the
  -- runtime issuing DELETE at all. Archiving keeps the row and takes it off
  -- every list. Both columns move together, as in 0006 and 0007, so a half-set
  -- archive cannot be stored.
  archived_at       TIMESTAMPTZ,
  archived_by       UUID        REFERENCES users(id),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT trip_schedules_archive_state
    CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

-- ★ The list index, and it must match the query exactly.
--
-- The only read of this table is "the trips between two dates, newest first",
-- and the ordering carries `id` as a tiebreaker so a page boundary inside a day
-- is stable. Index direction has to match the ORDER BY INCLUDING the
-- tiebreaker, or PostgreSQL adds an Incremental Sort on top of the scan — the
-- same finding 0009 recorded for the keyset lists.
--
-- Partial on `archived_at IS NULL` because archived rows are never listed, so
-- they have no business occupying the index.
CREATE INDEX IF NOT EXISTS idx_trip_schedule_page
  ON trip_schedules (scheduled_on DESC, id DESC)
  WHERE archived_at IS NULL;

-- Not for reading trips: these serve the foreign-key check PostgreSQL runs when
-- a vehicle or customer row is updated. Without them archiving one truck scans
-- the whole trip table.
CREATE INDEX IF NOT EXISTS idx_trip_schedule_vehicle
  ON trip_schedules (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_trip_schedule_customer
  ON trip_schedules (customer_id);

DROP TRIGGER IF EXISTS trip_schedules_set_updated_at ON trip_schedules;

CREATE TRIGGER trip_schedules_set_updated_at
  BEFORE UPDATE ON trip_schedules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
