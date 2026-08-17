-- 0002_users_updated_at.sql — make `users.updated_at` tell the truth.
--
-- 0001 gave the column a DEFAULT and nothing else, so it recorded the moment
-- the row was created and then never moved again. A column that looks like an
-- audit field and silently isn't is worse than no column: the first person to
-- sort by it, or to build "changed since" on it, gets a wrong answer with no
-- reason to doubt it.
--
-- A TRIGGER rather than application code, deliberately. This is an invariant of
-- the table, and there is currently no UPDATE path in the codebase at all —
-- meaning the rule would have to be remembered by whoever writes the first one,
-- and by everyone after them, and by anyone running a manual UPDATE during an
-- incident. The database is the only place that cannot forget.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DROP + CREATE rather than CREATE OR REPLACE: PostgreSQL has no
-- `CREATE OR REPLACE TRIGGER` before 14, and this must stay re-runnable.
DROP TRIGGER IF EXISTS users_set_updated_at ON users;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
