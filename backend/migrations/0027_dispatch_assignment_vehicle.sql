-- 0027_dispatch_assignment_vehicle.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- A trip is dispatched with ONE OR MORE lorries, each with its own driver.
--
-- 0014 wrote "MVP SCOPE: 1 trip = 1 customer + 1 vehicle + 1 driver" and put
-- the lorry on `trip_schedules.vehicle_id`. The business has since changed
-- that rule (ADR-0004): one trip carries 0..N dispatch assignments, and every
-- assignment is a PAIR — a vehicle and a driver, never one without the other.
-- The same driver may hold several of them on one trip (one person, three
-- lorries, three turns); one lorry may not be on the same trip twice at once.
--
-- ★ NO NEW TABLE. `trip_driver_assignments` already is the assignment: it is
-- append-only, it carries who assigned and who ended each turn, and three
-- tables reference it through `(id, trip_id)`. What it lacked was the lorry.
-- A second assignment table would have meant re-pointing all three foreign
-- keys and splitting the provenance that already exists.
--
-- ★ `trip_schedules.vehicle_id` BECOMES LEGACY. The application stops writing
-- it from this release; it stays for the rows that still carry one (a trip
-- booked with a lorry and never crewed — the workbook's `ĐIỀN SAU` in
-- reverse). Nothing is dropped here, and nothing reads it as dispatch truth.
--
-- ★ NULLABLE COLUMN, CHECK `NOT VALID`. Production holds active assignments on
-- trips that have no lorry at all. A NOT NULL column would refuse this file;
-- inventing a lorry for them would be worse. The CHECK below is enforced for
-- every row written from now on and skipped for the rows that already exist.
-- A later migration runs `VALIDATE CONSTRAINT` once Operations has re-crewed
-- those rows — see 0029 for the counts that gate it.
--
-- ★ `lock_timeout`, as in 0010: DROP INDEX and ADD CONSTRAINT take ACCESS
-- EXCLUSIVE. Landing behind a long transaction would otherwise queue every
-- query on the table behind this file.

SET LOCAL lock_timeout = '5s';

ALTER TABLE trip_driver_assignments
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES trip_vehicles(id);

-- Serves the foreign-key check when a vehicle row is updated — the same reason
-- 0011 indexes `trip_schedules.vehicle_id`. Partial: legacy rows without a
-- lorry have no business in it.
CREATE INDEX IF NOT EXISTS idx_trip_driver_assignment_vehicle
  ON trip_driver_assignments (vehicle_id)
  WHERE vehicle_id IS NOT NULL;

-- ★ THE 1:1 RULE, REMOVED. This index was the whole enforcement of "one
-- driver per trip". Dropped and replaced in the same transaction, so no writer
-- sees a moment with neither.
DROP INDEX IF EXISTS uq_trip_active_driver_assignment;

-- ★ ONE ACTIVE TURN PER LORRY PER TRIP — ENFORCED BY POSTGRESQL. Two operators
-- adding the same lorry to the same trip both pass every application check;
-- one of them loses here at COMMIT. NULLs do not collide, so the legacy rows
-- without a lorry neither violate this nor block each other.
--
-- ⚠ DELIBERATELY NOTHING ON `(trip_id, driver_user_id)`. The same driver on
-- several lorries of one trip is a confirmed business case, not a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_active_vehicle_assignment
  ON trip_driver_assignments (trip_id, vehicle_id)
  WHERE state = 'active';

-- An assignment written from now on names its lorry. Guarded through
-- `pg_constraint` because `ADD CONSTRAINT` has no `IF NOT EXISTS`, and
-- `DROP ... IF EXISTS` + `ADD` would re-run the (skipped) validation on a
-- rerun, which is not the same as doing nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname  = 'trip_driver_assignments_active_has_vehicle'
       AND conrelid = 'trip_driver_assignments'::regclass
  ) THEN
    ALTER TABLE trip_driver_assignments
      ADD CONSTRAINT trip_driver_assignments_active_has_vehicle
      CHECK (state <> 'active' OR vehicle_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
