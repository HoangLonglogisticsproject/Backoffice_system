-- 0003_organization.sql — where a person sits in the organization.
--
-- Two tables, and the split between them is the point:
--
--   departments             the units themselves. Rows, never code — a unit's
--                           name is data an administrator types, so no name
--                           appears anywhere in this repository.
--
--   department_memberships  WHO is in WHICH unit, over time. Not a column on
--                           `users`: a column holds one value and forgets the
--                           previous one, and "which unit did this person
--                           belong to when they authored that record" has to
--                           stay answerable after they move.
--
-- No roles here. Being a member is an organizational fact; being allowed to do
-- something is a separate question, and 0004 answers it in its own table.
--
-- THE INVARIANT THIS FILE CARRIES:
--
--   an active user holds EXACTLY ONE active membership.
--
-- Only half of that is expressible in schema. "At most one" is the partial
-- unique index below. "At least one" is a statement about the absence of a row
-- in another table, which no CHECK, FK or index can express — so it lives in
-- the service, which never creates an active user without a membership and
-- never ends a membership without disabling the user. The half that CAN be
-- enforced here is, because that half is the one that breaks under concurrency.

-- ------------------------------------------------------------- departments ----
CREATE TABLE IF NOT EXISTS departments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable identifier for URLs and configuration. Separate from `name` because
  -- renaming a unit is routine and must not invalidate anything that pointed at
  -- it.
  slug        TEXT        NOT NULL CHECK (length(trim(slug)) > 0),

  -- What people call it. Changes freely.
  name        TEXT        NOT NULL CHECK (length(trim(name)) > 0),

  -- Archive, never delete: memberships and authored records keep referencing
  -- this row long after a unit is dissolved.
  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT departments_slug_key UNIQUE (slug)
);

-- `updated_at` maintained by the trigger 0002 installed, for the same reason it
-- was installed there: a column that looks like an audit field and silently is
-- not is worse than no column.
DROP TRIGGER IF EXISTS departments_set_updated_at ON departments;

CREATE TRIGGER departments_set_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------- department_memberships ----
CREATE TABLE IF NOT EXISTS department_memberships (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Deliberately NOT `ON DELETE CASCADE`, unlike identities and sessions in
  -- 0001. Those cascade because they are worthless without their user. A
  -- membership is history: it records that a person was somewhere at some time,
  -- and a stray manual DELETE on `users` during an incident must fail loudly
  -- rather than silently erase that. Users are never hard-deleted anyway
  -- (0001), so the cascade would protect nothing and cost history.
  user_id        UUID        NOT NULL REFERENCES users(id),
  department_id  UUID        NOT NULL REFERENCES departments(id),

  status         TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'ended')),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ,

  -- The two columns cannot disagree about whether this membership is over.
  CONSTRAINT memberships_state_consistent
    CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);

-- ★ At most one active membership per user, across the WHOLE system.
--
-- Note what this does NOT say: it does not mention department_id. Two active
-- memberships in different units are exactly what it forbids — a person belongs
-- to one unit at a time, so a transfer must end the old membership before it
-- opens the new one. That ordering is not a convention anyone has to remember;
-- doing it backwards violates this index and the transaction rolls back.
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_membership
  ON department_memberships (user_id)
  WHERE status = 'active';

-- Supports "who is in this unit right now", the query every unit screen runs.
CREATE INDEX IF NOT EXISTS idx_membership_department_active
  ON department_memberships (department_id)
  WHERE status = 'active';

-- Supports reading one person's history, which is not filtered by status.
CREATE INDEX IF NOT EXISTS idx_membership_user
  ON department_memberships (user_id);
