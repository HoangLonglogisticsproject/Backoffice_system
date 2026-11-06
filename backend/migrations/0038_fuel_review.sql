-- 0038 · Fuel review — a driver's fill, checked by Accounting and marked paid
-- ============================================================================
--
-- ★ NO SECOND SOURCE OF TRUTH. A driver's fill is already a `vehicle_costs`
-- row (0034: the money, the lorry, the day, the readings) wrapped by a
-- `fuel_transactions` row (0037: the station, the receipt, the images). What
-- was missing is the WORKFLOW: submitted → checked → paid. This table holds
-- that and only that — no amount, lorry, day, driver, liters, station or
-- invoice is copied here.
--
-- ★ APPEND-ONLY. Each step is a row: who moved the fill to which state, when,
-- and why. The current state is the latest row; approving and paying are two
-- rows, never one. Nothing is updated or deleted, so the history is the audit.
--
--   (none)      → submitted                        the driver records the fill
--   submitted   → needs_info | approved | rejected Accounting checks it
--   needs_info  → submitted  | rejected            the driver answers, or Accounting gives up
--   approved    → paid                             Accounting paid the station, outside the system
--   paid, rejected                                 final
--
-- ★ No payment is executed here and no banking detail is stored: `paid` says a
-- person paid, with an optional note (a transfer reference they typed).
--
-- Additive: one new table; one CHECK on `fuel_transaction_evidence` widened
-- to take a picture of the station's payment QR (`payment_qr`) — an image
-- like any other, never parsed. Idempotent throughout.

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------ 1. review events ----

CREATE TABLE IF NOT EXISTS fuel_review_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_transaction_id UUID        NOT NULL REFERENCES fuel_transactions(id),
  -- 1, 2, 3… per fill: two writers deciding the same step cannot both land.
  seq                 INTEGER     NOT NULL CHECK (seq >= 1),
  status              TEXT        NOT NULL CHECK (status IN ('submitted', 'needs_info', 'approved', 'paid', 'rejected')),
  note                TEXT        CHECK (note IS NULL OR (length(btrim(note)) BETWEEN 1 AND 1000)),
  actor               UUID        NOT NULL REFERENCES users(id),
  at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Asking for more, or refusing, says why.
  CONSTRAINT fuel_review_events_reason
    CHECK (status NOT IN ('needs_info', 'rejected') OR note IS NOT NULL),
  CONSTRAINT fuel_review_events_step UNIQUE (fuel_transaction_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_fuel_review_latest
  ON fuel_review_events (fuel_transaction_id, seq DESC);

-- ★ THE STATE MACHINE, held by the database: each row is exactly the next
-- step, an allowed move from the state before it. A driver's submit or
-- resubmit is the fill's own driver; a voided fill takes no review.
CREATE OR REPLACE FUNCTION fuel_review_events_validate() RETURNS trigger AS $$
DECLARE
  prior RECORD;
  fill  RECORD;
BEGIN
  SELECT driver_user_id, voided_at INTO fill FROM fuel_transactions WHERE id = NEW.fuel_transaction_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF fill.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'fuel_review_events: a voided fuel transaction takes no review'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT status, seq INTO prior FROM fuel_review_events
   WHERE fuel_transaction_id = NEW.fuel_transaction_id ORDER BY seq DESC LIMIT 1;
  IF NEW.seq <> COALESCE(prior.seq, 0) + 1 THEN
    RAISE EXCEPTION 'fuel_review_events: step % is not the next one after %', NEW.seq, COALESCE(prior.seq, 0)
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (
       (prior.status IS NULL         AND NEW.status = 'submitted')
    OR (prior.status = 'submitted'   AND NEW.status IN ('needs_info', 'approved', 'rejected'))
    OR (prior.status = 'needs_info'  AND NEW.status IN ('submitted', 'rejected'))
    OR (prior.status = 'approved'    AND NEW.status = 'paid')
  ) THEN
    RAISE EXCEPTION 'fuel_review_events: % → % is not a move a fill can make', COALESCE(prior.status, '(none)'), NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'submitted' AND NEW.actor IS DISTINCT FROM fill.driver_user_id THEN
    RAISE EXCEPTION 'fuel_review_events: only the fill''s own driver submits it'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fuel_review_events_validate ON fuel_review_events;
CREATE TRIGGER fuel_review_events_validate
  BEFORE INSERT ON fuel_review_events
  FOR EACH ROW EXECUTE FUNCTION fuel_review_events_validate();

DROP TRIGGER IF EXISTS fuel_review_events_append_only ON fuel_review_events;
CREATE TRIGGER fuel_review_events_append_only
  BEFORE UPDATE ON fuel_review_events
  FOR EACH ROW EXECUTE FUNCTION fuel_append_only();

DROP TRIGGER IF EXISTS fuel_review_events_deny_delete ON fuel_review_events;
CREATE TRIGGER fuel_review_events_deny_delete
  BEFORE DELETE ON fuel_review_events
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

-- ------------------------------------------- 2. the station's payment QR ----

ALTER TABLE fuel_transaction_evidence DROP CONSTRAINT IF EXISTS fuel_transaction_evidence_evidence_type_check;
ALTER TABLE fuel_transaction_evidence DROP CONSTRAINT IF EXISTS fuel_transaction_evidence_type;
ALTER TABLE fuel_transaction_evidence
  ADD CONSTRAINT fuel_transaction_evidence_type
    CHECK (evidence_type IS NULL OR evidence_type IN
      ('pump_meter', 'timemark', 'fuel_voucher', 'receipt', 'tax_invoice', 'payment_qr'));
