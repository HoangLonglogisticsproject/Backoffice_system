-- 0019_trip_location.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- Where the two ends of a trip ARE, and where the driver WAS when they said
-- they had got there.
--
-- 0011 keeps `pickup_address` and `delivery_address` as free text, on purpose:
-- the workbook's address cells are prose. Prose cannot be measured against a
-- GPS reading, which is the whole of GAP-14 — the design doc names "the
-- coordinates of the SCSC and WENDELBO warehouses" as the data that had to be
-- collected before any location check could exist. This migration is the place
-- that data goes. It does not collect it: every existing trip keeps NULL on all
-- four columns, and Operations enters the coordinates as they are known.
--
-- ★ DOUBLE PRECISION, NOT NUMERIC, AND NOT BY OVERSIGHT. A coordinate is a
-- MEASUREMENT with a stated error of metres; money is a COUNT with a stated
-- error of zero. `NUMERIC` exists for the second. A float64 carries ~15
-- significant digits, which at the equator is a nanometre — the sixth decimal
-- place anybody actually stores is 11 cm, and the GPS behind it is 5 m on a
-- good day. `pg` also hands float8 back as a JavaScript number and NUMERIC back
-- as a string, so the honest type is also the one that needs no cast on read.
--
-- ★ THE RANGE CHECKS ARE IN THE DATABASE, NOT ONLY IN THE DTO. A latitude of
-- 91 is not a value with a meaning nobody has decided yet; it is not a
-- latitude. The application validates first, for a readable message, and the
-- column refuses regardless of which script wrote it.
--
-- ⚠ AND `>= 0` ALONE DOES NOT REFUSE `NaN` OR `Infinity`. PostgreSQL orders
-- NaN ABOVE every other float, Infinity included, so `'NaN' >= 0` is TRUE and
-- so is `'Infinity' >= 0`. A BETWEEN with an upper bound already excludes both
-- (NaN is above 90 as well); the one-sided checks on `accuracy_m` and
-- `distance_m` need the upper bound spelled out: `< 'Infinity'` is false for
-- Infinity and false for NaN, which is exactly the pair to keep out of a
-- column something will one day take an average of.
--
-- ★ PLAIN `ADD CONSTRAINT`, NOT `NOT VALID` + `VALIDATE`. That split lets the
-- table be validated under a weaker lock — but only when the two run in
-- DIFFERENT transactions. The runner wraps every migration file in one
-- transaction, so the ACCESS EXCLUSIVE lock `ADD CONSTRAINT` takes is held to
-- COMMIT whatever follows it, and a VALIDATE in the same file scans under that
-- same lock. Two statements for the price of one, and the tables are small.

-- ------------------------------------------ trip_schedules: the destinations ----

ALTER TABLE trip_schedules
  ADD COLUMN IF NOT EXISTS pickup_latitude    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_longitude   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION;

ALTER TABLE trip_schedules
  DROP CONSTRAINT IF EXISTS trip_schedules_pickup_coordinates,
  DROP CONSTRAINT IF EXISTS trip_schedules_delivery_coordinates;

-- A point has both halves or neither. A latitude with no longitude is not
-- "half a location" — it is nowhere, and a geofence check against it would
-- have to invent the other half.
ALTER TABLE trip_schedules
  ADD CONSTRAINT trip_schedules_pickup_coordinates
    CHECK (
      (pickup_latitude IS NULL) = (pickup_longitude IS NULL)
      AND (pickup_latitude  IS NULL OR pickup_latitude  BETWEEN -90  AND 90)
      AND (pickup_longitude IS NULL OR pickup_longitude BETWEEN -180 AND 180)
    ),
  ADD CONSTRAINT trip_schedules_delivery_coordinates
    CHECK (
      (delivery_latitude IS NULL) = (delivery_longitude IS NULL)
      AND (delivery_latitude  IS NULL OR delivery_latitude  BETWEEN -90  AND 90)
      AND (delivery_longitude IS NULL OR delivery_longitude BETWEEN -180 AND 180)
    );

-- ------------------------------------ trip_execution_events: the evidence ----
--
-- ★ EVIDENCE, NOT PROOF. Contract §11 is explicit that a browser's GPS is a
-- verification SIGNAL and never "absolute proof": nothing here claims the
-- driver was at the point, only that the handset REPORTED being there, with
-- the accuracy the handset itself stated, and that the server measured the
-- distance and reached a verdict. All of it is kept beside the event so the
-- verdict can be re-examined later without trusting the verdict.
--
-- ★ ONE READING PER MILESTONE, NEVER A TRACK. This is not a GPS log. A
-- position is stored only on the row that records an authoritative milestone,
-- and there is deliberately no table for readings between milestones.
--
-- Nullable throughout: every event written before this migration has no
-- reading, and an arrival reported without one is still an arrival.

ALTER TABLE trip_execution_events
  ADD COLUMN IF NOT EXISTS latitude             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude            DOUBLE PRECISION,
  -- The handset's own estimate of its error, in metres, as the Geolocation API
  -- reports it. A reading with `accuracy_m = 500` is a reading of a district.
  ADD COLUMN IF NOT EXISTS accuracy_m           DOUBLE PRECISION,
  -- When the HANDSET says the fix was taken. Its clock, like
  -- `device_reported_at` — diagnostic, and never what `actual_at` is set from.
  ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ,
  -- The server's verdict and the figure it was reached from, for the milestones
  -- that are geofenced. NULL where no check applied.
  ADD COLUMN IF NOT EXISTS geofence_passed      BOOLEAN,
  ADD COLUMN IF NOT EXISTS distance_m           DOUBLE PRECISION;

ALTER TABLE trip_execution_events
  DROP CONSTRAINT IF EXISTS trip_execution_events_location_shape;

-- The reading moves as one: a latitude implies a longitude, an accuracy and a
-- capture time, and a verdict implies a reading it was reached from.
ALTER TABLE trip_execution_events
  ADD CONSTRAINT trip_execution_events_location_shape
    CHECK (
      (
        latitude IS NULL AND longitude IS NULL AND accuracy_m IS NULL
        AND location_captured_at IS NULL AND geofence_passed IS NULL AND distance_m IS NULL
      )
      OR
      (
        latitude IS NOT NULL AND longitude IS NOT NULL
        AND accuracy_m IS NOT NULL AND location_captured_at IS NOT NULL
        AND latitude  BETWEEN -90  AND 90
        AND longitude BETWEEN -180 AND 180
        AND accuracy_m >= 0 AND accuracy_m < 'Infinity'::DOUBLE PRECISION
        AND (distance_m IS NULL
             OR (distance_m >= 0 AND distance_m < 'Infinity'::DOUBLE PRECISION))
        AND ((geofence_passed IS NULL) = (distance_m IS NULL))
      )
    );
