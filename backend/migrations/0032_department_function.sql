-- 0032 · What a department DOES, so authorization can ask
-- ============================================================================
--
-- ★ ONE NULLABLE COLUMN, AND NO DEPARTMENT IS NAMED ANYWHERE IN THIS FILE.
--
-- The business rule that arrived is about KINDS of department, not about
-- seniority: everybody in Điều độ dispatches lorries and prices trips; nobody
-- in Kinh doanh or Kế toán does, however senior. The permission model until
-- now could only ask "is this caller a head of something", which answers the
-- wrong question — a head of Sales could dispatch, and a plain dispatcher
-- could not.
--
-- The fix is NOT a new role. A role is a fact about a PERSON (`role_assignments`),
-- and "may dispatch" is a fact about the UNIT they sit in. So the unit carries
-- it: `departments.function` says which kind of unit this is, and the
-- authorization context reads it off the caller's active membership.
--
-- ★ THREE VALUES, AND NULL. `sales`, `accounting` and `dispatch` are the three
-- kinds the business named; NULL is every other department, and it is the
-- DEFAULT — adding this column grants nothing to anybody until an administrator
-- sets it. Nothing here seeds a department, names a department, or guesses
-- which existing row is which. That is data an administrator enters through
-- `PATCH /departments/:id`, exactly as the name is.
--
-- ★ AT MOST ONE FUNCTION PER DEPARTMENT, by being one column rather than a
-- join table. A unit that is "sales and dispatch" is two units, and the model
-- refuses to pretend otherwise.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS`, and the CHECK is added inside a DO
-- block that swallows `duplicate_object` — the same pattern 0018 used for
-- `users.account_type`.
--
-- ★ `lock_timeout`, as in 0027–0029: ADD COLUMN and ADD CONSTRAINT both take
-- ACCESS EXCLUSIVE on `departments`. Landing behind a long transaction would
-- otherwise queue every authorization read (`loadContext` joins this table on
-- every request) behind this file. The runner wraps the file in one
-- transaction, so `SET LOCAL` scopes the limit to it.

SET LOCAL lock_timeout = '5s';

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS function TEXT;

DO $$
BEGIN
  ALTER TABLE departments
    ADD CONSTRAINT departments_function
    CHECK (function IS NULL OR function IN ('sales', 'accounting', 'dispatch'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Read on every authorized request, but always through the caller's ONE active
-- membership (`department_memberships.user_id`, already indexed) and then by
-- primary key on `departments`. No index on `function` itself: nothing lists
-- departments by function, and a filter over tens of rows needs none.
COMMENT ON COLUMN departments.function IS
  'What this unit does, for authorization: sales | accounting | dispatch | NULL (any other unit). Set by an administrator; never seeded. A member of a unit holds the permissions that function grants — see core/authorization/domain/permission.ts.';
