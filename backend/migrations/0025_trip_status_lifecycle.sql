-- 0025_trip_status_lifecycle.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- The board's five workbook colours become four lifecycle states:
--
--   pending     chờ xử lý        the trip is booked, nothing is settled yet
--   confirmed   đã xác nhận      the run is arranged
--   executing   đang thực hiện   the lorry is on the road
--   finished    hoàn thành       delivered and closed
--
-- ★ WHAT THIS REPLACES, AND WHY THE OLD SET IS NOT SIMPLY RENAMED. 0011's five
-- values were the fill colours of the spreadsheet's rows: ĐANG ĐỢI SX, SX RỒI
-- ĐANG ĐỢI XE, THÔNG TIN CẦN XÁC NHẬN LẠI, BOOK XE NGOÀI, ĐÃ XONG. Four of them
-- describe the CARGO's readiness and one describes the ROUTE; none of them
-- describes where the run itself is. The four above are a lifecycle, in order,
-- which is what the business asked for.
--
-- ⚠ `external_booking` HAS NO SUCCESSOR, AND THAT IS A REAL LOSS TO NOTE. "Book
-- xe ngoài" said the run is on a hired lorry. It is mapped to `confirmed` below
-- because a booked carrier IS an arranged run — but the "hired" half of the
-- fact is no longer in this column. It is not lost from the SYSTEM: 0013 gives
-- every vehicle an `ownership` of `company` or `outsourced` with its carrier,
-- and 0012's `trip_outsource_hires` records what was agreed with them. Those
-- are where "this run is subcontracted" belongs; the status column was a second,
-- weaker copy of it.

-- ------------------------------------------------------ the guard, first ----
--
-- ★ ORDER MATTERS HERE AND THE MIGRATION FAILS LOUDLY IF IT IS WRONG. 0017's
-- trigger refuses any move out of `done`, so the remap below — `done` →
-- `finished` — is exactly the UPDATE that trigger exists to stop. It is dropped
-- before the remap and re-created afterwards around the new terminal value.
--
-- The trip is not being reopened: it is the same closed trip under the name the
-- board now uses for closed.

DROP TRIGGER IF EXISTS trip_schedules_guard_done ON trip_schedules;

-- ----------------------------------------------------------- the values ----

ALTER TABLE trip_schedules DROP CONSTRAINT IF EXISTS trip_schedules_status_check;
ALTER TABLE trip_schedules ALTER COLUMN status DROP DEFAULT;

UPDATE trip_schedules
   SET status = CASE status
         -- All three "waiting" colours meant the same thing about the run: it
         -- is not settled. Which KIND of waiting (no goods, no lorry, a
         -- question outstanding) is a note or a driver assignment, not a stage.
         WHEN 'awaiting_production' THEN 'pending'
         WHEN 'awaiting_vehicle'    THEN 'pending'
         WHEN 'needs_confirmation'  THEN 'pending'
         -- A booked carrier is an arranged run. See the warning in the header
         -- for the half of this fact that lives in 0013 and 0012 instead.
         WHEN 'external_booking'    THEN 'confirmed'
         WHEN 'done'                THEN 'finished'
         -- Anything else would be a value 0011's CHECK could not have stored.
         -- Left alone so the CHECK added below fails on it rather than this
         -- migration quietly inventing a state for a row nobody can explain.
         ELSE status
       END
 WHERE status IN ('awaiting_production', 'awaiting_vehicle',
                  'needs_confirmation', 'external_booking', 'done');

-- ★ `pending` IS THE DEFAULT because a trip is entered before anything about it
-- is settled — the same reason 0011 defaulted to `awaiting_production`.
ALTER TABLE trip_schedules ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE trip_schedules
  ADD CONSTRAINT trip_schedules_status_check
  CHECK (status IN ('pending', 'confirmed', 'executing', 'finished'));

-- --------------------------------------------- T1 · terminal, renamed ----
--
-- ★ `finished` INHERITS EVERY RULE `done` HAD. It is reached only by approving
-- a completion request — which freezes the trip's money and stamps who closed
-- it — and it cannot be left. Nothing about that changed; only the word did.

CREATE OR REPLACE FUNCTION trip_schedules_guard_finished() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'finished' AND NEW.status <> 'finished' THEN
    RAISE EXCEPTION
      'trip_schedules %: a completed trip cannot be reopened (finished -> %)',
      OLD.id, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trip_schedules_guard_finished ON trip_schedules;

CREATE TRIGGER trip_schedules_guard_finished
  BEFORE UPDATE ON trip_schedules
  FOR EACH ROW
  EXECUTE FUNCTION trip_schedules_guard_finished();

-- The old function has no trigger left pointing at it.
DROP FUNCTION IF EXISTS trip_schedules_guard_done();

-- ------------------------------------------- trip_status_history: LEFT ALONE ----
--
-- ★ THE HISTORY KEEPS THE WORDS IT WAS WRITTEN IN, AND THIS IS DELIBERATE.
--
-- Those rows say what somebody moved a trip to, on a day when the board offered
-- five choices. Rewriting them to today's vocabulary would put words in the
-- mover's mouth, and it cannot even be done consistently: the three waiting
-- values all collapse to `pending`, so a real move from `awaiting_vehicle` to
-- `needs_confirmation` becomes `pending` → `pending` — which 0017's
-- `trip_status_history_actually_changed` CHECK refuses, and whose row cannot be
-- deleted either, because `trip_status_history_deny_delete` is doing its job.
--
-- So the history is evidence in its original vocabulary. Readers of it must
-- expect the five legacy values alongside the four current ones; the domain
-- type says so out loud.
