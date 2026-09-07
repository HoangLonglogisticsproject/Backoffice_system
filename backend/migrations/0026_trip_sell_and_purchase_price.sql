-- 0026_trip_sell_and_purchase_price.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- One price becomes two: what we CHARGE the customer (`GIÁ CƯỚC BÁN`) and what
-- we PAY the carrier for the same run (`GIÁ CƯỚC MUA`).
--
-- ★ `price` IS RENAMED RATHER THAN JOINED BY A SIBLING. 0024's column already
-- held exactly one of these two figures — its own header says "what we CHARGE,
-- agreed once when the trip is booked" — so it IS the sell price and every row
-- in it is already correct under the new name. Adding `purchase_price` beside a
-- column still called `price` would have left the codebase with one field whose
-- meaning you can only learn by reading a migration, standing next to one that
-- says what it is. A rename carries the data across for free; a new pair of
-- columns would have needed a backfill and a window where both were half-true.
--
-- ⚠ THIS BREAKS THE API SHAPE ON PURPOSE. `price` disappears from every trip
-- payload and `sellPrice` takes its place. There is no deprecation window: the
-- only client is this repository's frontend, shipped from the same commit, and
-- a nullable alias kept "for safety" is a second source of truth for a figure
-- that is money.
--
-- ★ AND THE MARGIN IS NOT A COLUMN. sell − purchase is a subtraction over two
-- values that are already here, and storing it would create a third figure that
-- can disagree with the two it came from. Nothing computes it in SQL either;
-- see the note on visibility below for why no total belongs on this table.

ALTER TABLE trip_schedules
  RENAME COLUMN price TO sell_price;

-- The CHECK travels with the column but keeps 0024's name, which now names a
-- column that no longer exists. Renamed so the constraint a violation reports
-- is one somebody can grep for.
ALTER TABLE trip_schedules
  RENAME CONSTRAINT trip_schedules_price_positive TO trip_schedules_sell_price_positive;

ALTER TABLE trip_schedules
  -- NUMERIC(14,2) and NULLABLE, both for 0024's reasons exactly: `pg` hands
  -- NUMERIC back as a STRING so nothing on the way out can round it, and a
  -- trip whose buying price is not yet agreed is a real state rather than a
  -- zero. Most trips run on our own lorries and never get one at all.
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(14,2);

ALTER TABLE trip_schedules
  DROP CONSTRAINT IF EXISTS trip_schedules_purchase_price_positive;

ALTER TABLE trip_schedules
  -- `> 0`, matching the sell price and `trip_costs.amount`. A run bought for
  -- nothing is recorded by leaving this NULL, not by storing a zero that reads
  -- as a real agreement worth nothing.
  ADD CONSTRAINT trip_schedules_purchase_price_positive
  CHECK (purchase_price IS NULL OR purchase_price > 0);

-- ---------------------------------------------------------- visibility -----
--
-- ★ NEITHER FIGURE RIDES ON THE TRIP RESPONSE ANY MORE, AND THAT IS A
-- NARROWING OF WHAT 0024 DID.
--
-- 0024 accepted, in writing, that putting the quoted price on `trip_schedules`
-- widened the board: `trip.read` is `'any'`, so every finished account could
-- read it. It also wrote down the condition for taking that back — "if the
-- quoted price should also be restricted, it needs its own permission and its
-- own projection". That has now been asked for, and both halves exist:
--
--   permission   `trip.price.read`, requirement `'head-anywhere'` — a global
--                administrator or the head of some department, and nobody else.
--   projection   the API blanks BOTH columns to `null` for a caller who does
--                not hold it, rather than the query omitting them. See
--                `redactPrices` in the trip-schedule domain for why null and
--                not absent.
--
-- ⚠ THE COLUMNS THEMSELVES ARE NOT PROTECTED BY THE DATABASE. Any SELECT that
-- names them gets them; the restriction lives in one function that every trip
-- read passes through. That is the same arrangement `trip_costs` has and it has
-- the same failure mode — a new query that forgets it. The integration suite
-- asserts against real rows for exactly this reason.
--
-- ★ THE DRIVER READ MODEL NEEDED NO CHANGE. `DriverTrip` is a whitelist that
-- names its columns one by one and has never joined a price. A driver could not
-- see the old column and cannot see either of the new ones.
