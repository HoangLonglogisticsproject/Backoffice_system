-- 0020_void_reason_optional.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- A withdrawal no longer has to carry a written reason.
--
-- 0012 made `void_reason` mandatory on a voided row, and said why: a figure
-- that was counted in last month's total has to stay explicable. That is still
-- true of WHO withdrew it and WHEN — those two columns keep moving together
-- with `voided_at`, and nothing here relaxes them. What changed is the product
-- decision above them: withdrawing a cost line is now a plain confirmation in
-- the interface, with no field to type into, so the runtime has no reason to
-- send and the column would only ever receive a value somebody invented to
-- satisfy a constraint. A fabricated reason is worse than none — it reads as
-- testimony and is not.
--
-- ★ THE COLUMN STAYS, AND SO DOES ITS NOT-BLANK GUARD. Every reason already
-- written is still there and still shown beside the row it explains; the API
-- still accepts one when a caller sends it. This migration widens what is
-- allowed, it does not delete anything and does not rewrite a single row.

ALTER TABLE trip_costs DROP CONSTRAINT IF EXISTS trip_costs_void_state;

-- Two columns, not three. A void still cannot be half-set: it is either not
-- voided at all, or voided by somebody at a known time.
ALTER TABLE trip_costs
  ADD CONSTRAINT trip_costs_void_state
    CHECK (
      (voided_at IS NULL     AND voided_by IS NULL)
      OR
      (voided_at IS NOT NULL AND voided_by IS NOT NULL)
    );

-- A reason belongs to a void. Without this, a live row could carry an
-- explanation for a withdrawal that never happened — which the three-column
-- constraint used to rule out on its own.
ALTER TABLE trip_costs DROP CONSTRAINT IF EXISTS trip_costs_void_reason_needs_void;
ALTER TABLE trip_costs
  ADD CONSTRAINT trip_costs_void_reason_needs_void
    CHECK (void_reason IS NULL OR voided_at IS NOT NULL);

ALTER TABLE trip_outsource_hires DROP CONSTRAINT IF EXISTS trip_outsource_hires_void_state;

ALTER TABLE trip_outsource_hires
  ADD CONSTRAINT trip_outsource_hires_void_state
    CHECK (
      (voided_at IS NULL     AND voided_by IS NULL)
      OR
      (voided_at IS NOT NULL AND voided_by IS NOT NULL)
    );

ALTER TABLE trip_outsource_hires
  DROP CONSTRAINT IF EXISTS trip_outsource_hires_void_reason_needs_void;
ALTER TABLE trip_outsource_hires
  ADD CONSTRAINT trip_outsource_hires_void_reason_needs_void
    CHECK (void_reason IS NULL OR voided_at IS NOT NULL);
