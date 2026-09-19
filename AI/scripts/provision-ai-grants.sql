-- provision-ai-grants.sql — the grants that need tables to exist.
--
-- Run AFTER `npm run migrate` (AI/), connected to the application database as
-- a superuser or as ai_migrator (the owner). Plain SQL, no psql variables, so
-- it is also what the integration suite executes to prove the boundary.
-- Re-runnable: every statement is idempotent.
--
--   psql -v ON_ERROR_STOP=1 -d backoffice -f AI/scripts/provision-ai-grants.sql

-- The runtime must not read the migration ledger. The default privileges in
-- provision-ai-roles.sql granted it along with everything else; take it back.
REVOKE ALL ON ai.schema_migrations FROM ai_app;

-- ★ THE RETENTION SURFACE, NAMED TABLE BY TABLE. This list IS the approval:
-- a table not on it cannot be pruned, whatever a future job is told to do.
--
-- SELECT is included because a `DELETE … WHERE resolved_at < …` needs to read
-- the columns in its predicate; PostgreSQL refuses the statement otherwise.
-- It is SELECT on these three tables only, not on the schema.
GRANT SELECT, DELETE ON ai.alerts, ai.alert_transition_history, ai.scan_runs TO ai_maintenance;
