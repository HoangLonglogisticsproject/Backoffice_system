-- 0012_trip_cost.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- The CHI PHÍ block that 0011 deliberately left out. It said the block would
-- "get its own migration when somebody specifies it"; this is that migration.
--
-- Two tables, and the split is the whole point:
--
--   trip_costs             what running OUR OWN truck cost, itemised
--   trip_outsource_hires   what we AGREED TO PAY somebody else's truck
--
-- ★ WHY THESE ARE NOT ONE TABLE WITH A SIXTH CATEGORY. They are different
-- shapes, not two flavours of one thing. An own-vehicle trip accumulates MANY
-- lines — fuel, then tolls, then overtime — each a separate thing bought on a
-- separate occasion. An outsourced trip has ONE agreed price, and the carrier
-- absorbs the fuel and the tolls into it: there is nothing to itemise, and
-- there IS a counterparty to name. Folding them together would mean a carrier
-- column that is meaningless for five of six values — a rule you have to
-- remember rather than one the schema states.
--
-- Both are money OUT. A trip's total cost is the sum of both, which is one
-- query; storing them apart costs nothing and keeps each shape honest.
--
-- ★ NOTHING HERE IS MONEY IN. Amounts recharged to a customer are a different
-- direction and a different workflow, and modelling one as a negative cost
-- would corrupt every total this table exists to produce. They are not in this
-- migration at all.
--
-- ⚠ WHAT THIS MIGRATION DOES NOT TOUCH. 0011 is unchanged: no column is added
-- to trip_schedules, and no amount ever reaches the trip API, because the
-- people allowed to enter a price are not the people allowed to read the board.
-- Keeping money in its own tables behind its own reads is what makes that
-- restriction possible at all.
--
-- ⚠ AND IT ADDS NO STATUS AND NO WORKFLOW. There is no approval column, no VAT
-- calculation, no payment, no invoice, no shipment. Each of those is a decision
-- nobody has taken, and a column that anticipates one is a column that gets
-- filled in wrongly for a year.

-- ------------------------------------------------------------- trip_costs ----
CREATE TABLE IF NOT EXISTS trip_costs (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ★ COST BELONGS TO THE TRIP, not to the truck. The workbook records these
  -- per ROW, and a row is one truck's run on one day: the fuel bought for
  -- Tuesday's job is a fact about that job, not an attribute of the lorry.
  -- Totals per vehicle or per month are then a GROUP BY over trips, which
  -- needs no second table to hold them.
  --
  -- No ON DELETE clause, deliberately: a trip is archived, never deleted
  -- (rule B13), so there is no deletion for this key to cascade from. Spelling
  -- one out would describe an event that cannot happen.
  trip_id       UUID          NOT NULL REFERENCES trip_schedules(id),

  -- The five headings the workbook's cost block actually has, and no others.
  --
  -- ⚠ THERE IS NO 'other'. A catch-all bucket is where a taxonomy goes to die:
  -- everything anybody is unsure about lands in it, and within a year the five
  -- named values describe a minority of the spending. A sixth REAL heading is
  -- welcome — as a sixth named value, added by a migration somebody had to
  -- write on purpose.
  category      TEXT          NOT NULL
                              CHECK (category IN ('fuel',       -- DẦU
                                                  'toll',       -- CẦU TRẠM
                                                  'warehouse',  -- PHÍ KHO
                                                  'loading',    -- BỐC XẾP
                                                  'overtime')), -- TĂNG CA

  -- ★ NUMERIC, NEVER float. `0.1 + 0.2` is not `0.3` in binary floating point,
  -- and a sum of a hundred fuel lines drifts by an amount nobody can explain
  -- and nobody can reproduce. 14 digits with 2 decimals holds a figure far past
  -- any single VND line without approximating it.
  --
  -- Currency is VND everywhere, so there is no currency column: one operator in
  -- one country, and a column nobody ever varies is a column nobody keeps
  -- correct.
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),

  note          TEXT,

  -- ★ NO `updated_at`, AND NO TRIGGER — THE ONE PLACE THIS SCHEMA DIFFERS FROM
  -- EVERY OTHER TABLE HERE. A financial record is not edited. A wrong figure is
  -- VOIDED and re-entered, so that what was believed on Tuesday is still
  -- readable on Friday. An `updated_at` column would advertise an in-place edit
  -- that the application must never perform.
  created_by    UUID          NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ★ VOID, NOT DELETE. The runtime never issues DELETE (rule B13), and for
  -- money that rule earns its keep twice over: a line that was counted in last
  -- month's total has to remain visible even once it is withdrawn, or the total
  -- can never be explained again.
  --
  -- All three columns move together — see the constraint below.
  voided_at     TIMESTAMPTZ,
  voided_by     UUID          REFERENCES users(id),
  void_reason   TEXT,

  -- ★ A HALF-SET VOID CANNOT BE STORED. The same shape as
  -- `trip_schedules_archive_state` in 0011, extended to three columns because
  -- withdrawing money without saying why is exactly the record somebody will
  -- come back to and be unable to explain.
  CONSTRAINT trip_costs_void_state
    CHECK (
      (voided_at IS NULL     AND voided_by IS NULL     AND void_reason IS NULL)
      OR
      (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
    ),

  -- A reason made of spaces is not a reason. Same guard 0011 puts on a plate.
  CONSTRAINT trip_costs_void_reason_not_blank
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

-- The only read: this trip's LIVE lines, and their total.
--
-- Partial on `voided_at IS NULL` because a voided line is excluded from every
-- total, so it has no business occupying the index that computes them. Not
-- unique on `(trip_id, category)`: two fuel fills on one run is ordinary data,
-- and a unique index there would refuse the second one.
CREATE INDEX IF NOT EXISTS idx_trip_cost_trip
  ON trip_costs (trip_id)
  WHERE voided_at IS NULL;

-- --------------------------------------------------- trip_outsource_hires ----
CREATE TABLE IF NOT EXISTS trip_outsource_hires (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  trip_id             UUID          NOT NULL REFERENCES trip_schedules(id),

  -- ★ A NAME, AND DELIBERATELY NOT A FOREIGN KEY — THE ONE PLACE THIS SCHEMA
  -- ARGUES AGAINST 0011 RATHER THAN COPYING IT.
  --
  -- 0011 built catalogues for plates and customers precisely so a misspelling
  -- would be unrepresentable, and the same argument plainly applies to
  -- `Hai Thành` typed forty times. It is not applied here YET for one reason:
  -- nobody knows what the row would be. The names in the data — `Hai Thành`,
  -- `Hải Râu`, `xe Út`, `Mr Đạt` — are a company, a nickname, somebody's lorry
  -- and a person. A catalogue built now would have to pick between carrier,
  -- vehicle and driver, and picking wrong means every row points at the wrong
  -- kind of thing.
  --
  -- So the name is recorded exactly as somebody typed it, which is the one
  -- thing that is certainly true and the one thing that cannot be recovered
  -- later if it is thrown away. When the shape is settled, a nullable
  -- `carrier_id` is added beside this column and backfilled FROM it. Nothing
  -- written before that day becomes wrong, and no row has to be re-entered.
  carrier_name        TEXT          NOT NULL CHECK (length(trim(carrier_name)) > 0),

  -- What was agreed for the run, whole. The carrier's own fuel and tolls are
  -- inside this figure; that is what buying a trip instead of running one means.
  agreed_amount       NUMERIC(14,2) NOT NULL CHECK (agreed_amount > 0),

  -- ★ WHETHER THE FIGURE ABOVE ALREADY CONTAINS VAT, AND NOTHING MORE.
  --
  -- `agreed_amount` alone cannot say. If somebody enters a gross price into a
  -- system that assumes net, every total is quietly wrong by ten percent and
  -- nothing in the data reveals which rows are affected. One boolean removes
  -- that entire class of error at the moment of entry.
  --
  -- ⚠ IT IS A RECORD, NOT A CALCULATION. There is no `vat_rate`, no
  -- `vat_amount`, and no arithmetic anywhere: how VAT is computed, reclaimed or
  -- reported has not been specified, and inventing it here would be inventing
  -- accounting. This column only preserves what the figure MEANS, so that
  -- whoever specifies the rest is not guessing about data already entered.
  amount_includes_vat BOOLEAN       NOT NULL DEFAULT false,

  -- The invoice or contract this price came from, as written on it.
  document_ref        TEXT,
  note                TEXT,

  -- Immutable, and voided rather than edited — as in trip_costs above, and for
  -- the same reason. No `updated_at`, no trigger.
  created_by          UUID          NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  voided_at           TIMESTAMPTZ,
  voided_by           UUID          REFERENCES users(id),
  void_reason         TEXT,

  CONSTRAINT trip_outsource_hires_void_state
    CHECK (
      (voided_at IS NULL     AND voided_by IS NULL     AND void_reason IS NULL)
      OR
      (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
    ),

  CONSTRAINT trip_outsource_hires_void_reason_not_blank
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

-- Same read, same shape as the cost index above.
--
-- ⚠ NOT UNIQUE ON `trip_id`. Whether a run may carry more than one hire — a
-- second lorry, waiting time agreed separately — is not settled, and a unique
-- index that turns out to be wrong REFUSES legitimate data at the moment
-- somebody is trying to record it. Permissive is the recoverable direction:
-- adding the constraint later is a migration, whereas data never entered is
-- gone.
CREATE INDEX IF NOT EXISTS idx_trip_outsource_hire_trip
  ON trip_outsource_hires (trip_id)
  WHERE voided_at IS NULL;
