-- 0029_backfill_assignment_vehicle.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- Gives the assignments that already exist the lorry 0027 added a column for.
--
-- ★ DATA, NOT STRUCTURE, AND ONLY WHERE THE EVIDENCE IS CERTAIN. Every UPDATE
-- below is guarded by `vehicle_id IS NULL`, so the file can run again and
-- touches nothing it already wrote, and nothing a person has set since.
--
-- The cases, by evidence:
--
--   A  active assignment, trip has a lorry      copy `trip_schedules.vehicle_id`
--                                               — under the 1:1 model an active
--                                               turn IS the trip's lorry.
--   B  active assignment, trip has no lorry     nothing. Inventing one is worse
--                                               than NULL. Counted below;
--                                               Operations re-crews these, and
--                                               the CHECK is validated after.
--   C  ended assignment, its own execution      copy it — a snapshot written at
--      events name exactly one lorry            the moment, not a guess.
--   D  ended assignment, NO live event names     copy it, same reasoning.
--      any lorry at all, its own cost lines
--      name exactly one
--   E  ended assignment, evidence disagrees     nothing. NULL is the only true
--      or is absent                             statement; the snapshots stay
--                                               where they are. ★ Events that
--                                               disagree are NOT overruled by a
--                                               cost line: costs are consulted
--                                               only when no live event names
--                                               a lorry (see D).
--   F  trip has a legacy lorry, no assignment   nothing. There is no driver to
--                                               pair it with, and a lorry-only
--                                               assignment is not a thing.
--
-- ⚠ `trip_schedules.vehicle_id` IS NOT EVIDENCE FOR AN ENDED TURN. The board
-- edit could change it at any time without a trace, so for a turn that ended
-- weeks ago it says what the trip's lorry is today, not what it was then.

SET LOCAL lock_timeout = '5s';

-- A ---------------------------------------------------------------------------
UPDATE trip_driver_assignments a
   SET vehicle_id = t.vehicle_id
  FROM trip_schedules t
 WHERE t.id = a.trip_id
   AND a.state = 'active'
   AND a.vehicle_id IS NULL
   AND t.vehicle_id IS NOT NULL;

-- C ---------------------------------------------------------------------------
UPDATE trip_driver_assignments a
   SET vehicle_id = e.vehicle_id
  FROM (
    SELECT driver_assignment_id, (array_agg(DISTINCT vehicle_id))[1] AS vehicle_id
      FROM trip_execution_events
     WHERE vehicle_id IS NOT NULL AND voided_at IS NULL
     GROUP BY driver_assignment_id
    HAVING count(DISTINCT vehicle_id) = 1
  ) e
 WHERE e.driver_assignment_id = a.id
   AND a.state = 'ended'
   AND a.vehicle_id IS NULL;

-- D ---------------------------------------------------------------------------
UPDATE trip_driver_assignments a
   SET vehicle_id = c.vehicle_id
  FROM (
    SELECT driver_assignment_id, (array_agg(DISTINCT vehicle_id))[1] AS vehicle_id
      FROM trip_costs
     WHERE driver_assignment_id IS NOT NULL
       AND vehicle_id IS NOT NULL
       AND voided_at IS NULL
     GROUP BY driver_assignment_id
    HAVING count(DISTINCT vehicle_id) = 1
  ) c
 WHERE c.driver_assignment_id = a.id
   AND a.state = 'ended'
   AND a.vehicle_id IS NULL
   -- ★ ONLY WHEN THE EVENTS SAY NOTHING. A turn whose live events name two
   -- lorries is ambiguous (case E), and a cost line must not resolve that
   -- ambiguity for them: `a.vehicle_id IS NULL` alone would let it.
   AND NOT EXISTS (
     SELECT 1 FROM trip_execution_events e
      WHERE e.driver_assignment_id = a.id
        AND e.voided_at IS NULL
        AND e.vehicle_id IS NOT NULL);

-- Counts, for the release log and for the 0030 gate ---------------------------
DO $$
DECLARE
  case_b   integer;  -- active, still no lorry          → must reach 0 before 0030
  case_e   integer;  -- ended, still no lorry           → stays; informational
  case_f   integer;  -- legacy lorry, never crewed      → Operations re-dispatch
  dupes    integer;  -- active (trip, lorry) twice      → must be 0; the index forbids it
BEGIN
  SELECT count(*) INTO case_b FROM trip_driver_assignments
   WHERE state = 'active' AND vehicle_id IS NULL;

  SELECT count(*) INTO case_e FROM trip_driver_assignments
   WHERE state = 'ended' AND vehicle_id IS NULL;

  SELECT count(*) INTO case_f FROM trip_schedules t
   WHERE t.vehicle_id IS NOT NULL
     AND t.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM trip_driver_assignments a
                      WHERE a.trip_id = t.id AND a.state = 'active');

  SELECT count(*) INTO dupes FROM (
    SELECT trip_id, vehicle_id FROM trip_driver_assignments
     WHERE state = 'active' AND vehicle_id IS NOT NULL
     GROUP BY trip_id, vehicle_id HAVING count(*) > 1) d;

  RAISE NOTICE '0029 backfill: case B (active, no lorry) = %', case_b;
  RAISE NOTICE '0029 backfill: case E (ended, no lorry)  = %', case_e;
  RAISE NOTICE '0029 backfill: case F (legacy lorry, no crew) = %', case_f;

  IF dupes > 0 THEN
    RAISE EXCEPTION '0029: % (trip, lorry) pairs hold two active assignments; 0027''s index should have made this impossible', dupes
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;
