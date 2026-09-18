-- 0033 · A fourth kind of department: customer service
-- ============================================================================
--
-- ★ ONE CHECK CONSTRAINT WIDENED, AND NOTHING ELSE. 0032 gave `departments`
-- a `function` column and named three kinds — sales, accounting, dispatch.
-- The business has since named a fourth (DL-111): customer service books
-- runs like sales does, and must be a kind of its own so that authorization
-- can grant it exactly that and nothing more.
--
-- ★ NO ROW IS TOUCHED. Every value the column holds today still satisfies the
-- new CHECK, so this is a metadata change: no rewrite, no UPDATE, no seed.
-- Which unit IS customer service stays what it always was — data an
-- administrator enters, through `POST /departments` with the function, or
-- `PATCH /departments/:id` on an existing row. See ADR-0005.
--
-- ★ 0032 IS NOT EDITED. It has run in production; its checksum is recorded.
-- A migration is a fact about the past, and the way to change a constraint
-- it created is a later migration that drops and recreates it — which is
-- what this file does, in the runner's single transaction, so no moment
-- exists in which the column is unconstrained and visible to anybody.
--
-- Idempotent: `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`, and the
-- second run finds the constraint already carrying the four values; dropping
-- and re-adding it is harmless.
--
-- ★ `lock_timeout`, as in 0027–0029 and 0032: both statements take ACCESS
-- EXCLUSIVE on `departments`, which `loadContext` joins on every authorized
-- request. Queueing behind a long transaction would stall every one of them.

SET LOCAL lock_timeout = '5s';

ALTER TABLE departments
  DROP CONSTRAINT IF EXISTS departments_function;

ALTER TABLE departments
  ADD CONSTRAINT departments_function
  CHECK (function IS NULL OR function IN ('sales', 'accounting', 'dispatch', 'customer_service'));

COMMENT ON COLUMN departments.function IS
  'What this unit does, for authorization: sales | accounting | dispatch | customer_service | NULL (any other unit). Set by an administrator; never seeded. A member of a unit holds the permissions that function grants — see core/authorization/domain/permission.ts.';
