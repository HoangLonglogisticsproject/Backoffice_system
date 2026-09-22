-- provision-ai-roles.sql — the three PostgreSQL principals the AI Platform needs,
-- and the schema they meet in. ADR-0007.
--
-- NOT A MIGRATION, for the backend's reasons (scripts/provision-db-roles.sql):
-- roles are cluster-level, differ per environment and carry passwords. The
-- migration runner must never create the role it runs as.
--
-- Run ONCE per deployment, by a DBA, connected as a superuser to the
-- application database (it already exists — the backend created it):
--
--   psql -v ON_ERROR_STOP=1 -d backoffice \
--        -v db=backoffice \
--        -v ai_migrator_pw="$AI_MIGRATOR_PASSWORD" \
--        -v ai_app_pw="$AI_APP_PASSWORD" \
--        -v ai_maintenance_pw="$AI_MAINTENANCE_PASSWORD" \
--        -f AI/scripts/provision-ai-roles.sql
--
-- NO PASSWORD IS WRITTEN IN THIS FILE. Generate them (`openssl rand -base64 32`)
-- and never reuse one across environments or across roles.
--
-- ⚠ THIS SCRIPT CHANGES NOTHING ABOUT THE BACKEND'S CREDENTIALS. It adds
-- three roles and one schema. Whether the backend itself still runs as the
-- container superuser is a separate prerequisite (backend/.env.example) and
-- is NOT acceptable as the production boundary for the AI — the whole point
-- of the grants below is defeated if a superuser sits next to them.
--
-- ---------------------------------------------------------------------------
-- WHY THREE ROLES, AND WHY THESE THREE
--
--   ai_migrator     Owns schema `ai` and every object in it. Runs
--                   `npm run migrate` (AI/) at deploy time and NOTHING ELSE:
--                   not the runtime, not a cleanup job. DDL is the only thing
--                   it is for, so it is the only thing it does.
--
--   ai_app          The runtime. SELECT, INSERT, UPDATE on the tables the
--                   application owns. NO DELETE (history is the product),
--                   NO DDL (it does not own anything), and NO PRIVILEGE ON
--                   `public.*` — operational data reaches the AI through the
--                   backend's read API, never through this connection.
--
--   ai_maintenance  Retention, and nothing else. It will hold the one
--                   privilege the runtime is denied — DELETE — on the tables
--                   retention is approved for, named ONE BY ONE in
--                   provision-ai-grants.sql after the first migration. No
--                   INSERT, no DDL, nothing on `public.*`.
--
--                   ★ NOT `ai_migrator`, and this was decided explicitly.
--                   Using the schema owner for a recurring cleanup would hand
--                   a job that runs unattended the power to DROP the schema.
--                   Least privilege means the job that deletes rows cannot
--                   also delete tables.
--
-- ---------------------------------------------------------------------------

\if :{?db}
\else
  \warn 'ERROR: pass -v db=<database name>'
  \quit 1
\endif
\if :{?ai_migrator_pw}
\else
  \warn 'ERROR: pass -v ai_migrator_pw=…'
  \quit 1
\endif
\if :{?ai_app_pw}
\else
  \warn 'ERROR: pass -v ai_app_pw=…'
  \quit 1
\endif
\if :{?ai_maintenance_pw}
\else
  \warn 'ERROR: pass -v ai_maintenance_pw=…'
  \quit 1
\endif

-- ------------------------------------------------------------------ roles ----
-- LOGIN and nothing else: no SUPERUSER, no CREATEDB, no CREATEROLE, no
-- BYPASSRLS on any of the three.
CREATE ROLE ai_migrator    LOGIN PASSWORD :'ai_migrator_pw';
CREATE ROLE ai_app         LOGIN PASSWORD :'ai_app_pw';
CREATE ROLE ai_maintenance LOGIN PASSWORD :'ai_maintenance_pw';

GRANT CONNECT ON DATABASE :"db" TO ai_migrator, ai_app, ai_maintenance;

\connect :"db"

-- ----------------------------------------------------------------- schema ----
-- Owned by the migrator, so the migration runner never has to CREATE it and
-- never needs CREATE on the database. The runner checks the catalogue and
-- finds it already there.
CREATE SCHEMA ai AUTHORIZATION ai_migrator;

GRANT USAGE ON SCHEMA ai TO ai_app, ai_maintenance;

-- ★ DEFAULT PRIVILEGES for the runtime, not a list of tables — the tables do
-- not exist yet, and a list would rot the day a migration adds one. Anything
-- ai_migrator creates in `ai` from now on is readable and writable by ai_app,
-- and never deletable.
--
-- The one thing this over-grants is `ai.schema_migrations`, which the runtime
-- has no business reading. provision-ai-grants.sql takes it back.
ALTER DEFAULT PRIVILEGES FOR ROLE ai_migrator IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE ON TABLES TO ai_app;

-- ★ NO DEFAULT PRIVILEGES FOR ai_maintenance, on purpose. Its DELETE surface
-- is a named list of tables that retention has been approved for, not "every
-- table that ever appears". A new table is not deletable until somebody adds
-- it to provision-ai-grants.sql — which is the approval.

-- Nothing is granted on `public`. A role with no grants on a table cannot
-- read it, whoever owns it; the integration suite proves this for all three.

\echo ''
\echo 'AI roles created. Two steps remain, in this order:'
\echo ''
\echo '  1. Migrate AS THE MIGRATOR (not as the app role), from AI/:'
\echo '       DATABASE_URL=postgres://ai_migrator:PW@HOST/DB npm run migrate'
\echo ''
\echo '  2. Apply the per-table grants that need the tables step 1 creates:'
\echo '       psql -v ON_ERROR_STOP=1 -d DB -f AI/scripts/provision-ai-grants.sql'
\echo ''
\echo 'Then point the AI runtime at ai_app, and nothing else at ai_migrator.'
\echo ''
