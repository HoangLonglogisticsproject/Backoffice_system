-- 0024_trip_price.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- The price agreed with the customer for one run — `GIÁ CƯỚC` — as a column on
-- the trip itself.
--
-- ★ WHY THIS IS NOT A `trip_costs` ROW, AND THE DIFFERENCE IS THE WHOLE POINT.
-- 0012 records what a run COSTS US: many lines per trip, each one a financial
-- record that is voided rather than edited, written by a driver or by the
-- backoffice, and readable only under `cost.read`. This is what we CHARGE, it
-- is agreed once when the trip is booked, and it is part of the booking a
-- dispatcher types — the same field, on the same form, as the cargo and the
-- addresses. Folding it into the cost ledger would make the quoted figure a
-- voidable financial record with a category it does not have.
--
-- ⚠ AND THEREFORE IT RIDES ON THE TRIP RESPONSE, which every signed-in account
-- can read. That is a deliberate widening of what the board carries: before
-- this column, no amount of any kind was in a trip payload. The cost ledger's
-- separation is untouched — nothing here exposes what a run cost us — but if
-- the quoted price should also be restricted, it needs its own permission and
-- its own projection, not a nullable column everybody selects.

ALTER TABLE trip_schedules
  -- NUMERIC(14,2), exactly as `trip_costs.amount` is, and for the same reason:
  -- binary floating point cannot hold a decimal, and `pg` hands NUMERIC back as
  -- a STRING so nothing on the way out can round it. Twelve digits before the
  -- point is far past any single freight charge in VND.
  ADD COLUMN IF NOT EXISTS price NUMERIC(14,2);

-- NULLABLE, and that is a real state rather than a zero: a trip is entered
-- before it is priced, exactly as it is entered before a truck is assigned
-- (the workbook's `ĐIỀN SAU` rows). Every trip written before this migration
-- is genuinely unpriced, and backfilling `0` would have been the system
-- asserting we hauled them for nothing.
ALTER TABLE trip_schedules
  DROP CONSTRAINT IF EXISTS trip_schedules_price_positive;

ALTER TABLE trip_schedules
  -- `> 0`, matching `trip_costs.amount`. A free run is recorded by leaving the
  -- column NULL and saying why in the note, not by storing a zero that reads
  -- as a priced trip worth nothing.
  ADD CONSTRAINT trip_schedules_price_positive
  CHECK (price IS NULL OR price > 0);
