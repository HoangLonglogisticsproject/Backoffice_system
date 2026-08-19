-- provision-db-roles.sql — the three PostgreSQL principals this deployment needs.
--
-- NOT A MIGRATION, and deliberately not in `migrations/`. Roles are cluster-level
-- objects, they differ per environment, and they carry passwords — three reasons
-- a migration is the wrong place. The migration runner must never create the
-- role it runs as.
--
-- Run ONCE per deployment, by a DBA, connected as a superuser to the `postgres`
-- database (not to the application database — this script creates it):
--
--   psql -v ON_ERROR_STOP=1 -d postgres \
--        -v db=backoffice \
--        -v migrator_pw="$MIGRATOR_PASSWORD" \
--        -v app_pw="$APP_PASSWORD" \
--        -v ops_pw="$OPS_PASSWORD" \
--        -f scripts/provision-db-roles.sql
--
-- NO PASSWORD IS WRITTEN IN THIS FILE. They arrive as psql variables from the
-- operator's environment, so this file is safe to commit and safe to read over
-- somebody's shoulder. Generate them with `openssl rand -base64 32` or a secret
-- manager, and never reuse one across environments.
--
-- ---------------------------------------------------------------------------
-- WHY THREE ROLES
--
-- Before this, one superuser role did everything — ran migrations, served
-- requests, bootstrapped accounts. That is one compromise away from total loss,
-- and `rolbypassrls` would silently defeat any row-level security added later.
--
-- The split is not a template. Each grant was derived from the statements the
-- code actually issues:
--
--   bo_migrator  Owns the database and every object in it. Runs
--                `npm run migrate`, which is ALREADY a separate entry point from
--                application boot (`migrate.cli.ts`) — so no code change was
--                needed to separate these two principals, only configuration.
--                Nothing in the request path ever uses it.
--
--   bo_app       The runtime. SELECT, INSERT, UPDATE. Nothing else.
--
--                ★ NO DELETE, which is the part worth reading twice. Every
--                repository was checked: the application issues no DELETE at
--                all. It disables users, archives departments, ends memberships
--                and revokes assignments — all UPDATEs, because keeping the
--                history is the whole design. Withholding DELETE turns that
--                decision into something PostgreSQL enforces rather than
--                something the next repository has to remember.
--
--   bo_ops       The session sweep, and nothing else. It needs the one
--                privilege the runtime is denied — DELETE on `sessions` — which
--                is exactly why it cannot be the same principal. It cannot read
--                `users`, and it has no INSERT on `sessions`, so it cannot forge
--                one either.
--
-- The bootstrap CLI (`npm run user:create`) deliberately uses bo_app. At the
-- database level it issues the same INSERTs the API already issues when a
-- SuperAdmin provisions somebody, so a fourth role would carry identical grants
-- and imply a boundary PostgreSQL is not enforcing. What actually gates
-- bootstrap is shell access and BOOTSTRAP_PASSWORD, not a GRANT.
--
-- No sequence grants appear below because there are no sequences: every primary
-- key is a UUID from `gen_random_uuid()`, built into PostgreSQL 13+.
-- ---------------------------------------------------------------------------

\if :{?db}
\else
  \warn 'ERROR: pass -v db=<database name>'
  \quit 1
\endif

-- ------------------------------------------------------------------ roles ----
-- LOGIN and nothing else. No SUPERUSER, no CREATEDB, no CREATEROLE, no
-- BYPASSRLS on any of the three — LOGIN is the entire attribute set a
-- connecting principal needs.
CREATE ROLE bo_migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE bo_app      LOGIN PASSWORD :'app_pw';
CREATE ROLE bo_ops      LOGIN PASSWORD :'ops_pw';

CREATE DATABASE :"db" OWNER bo_migrator;

-- PUBLIC holds CONNECT by default, which is a wider door than this deployment
-- ever needs.
REVOKE CONNECT ON DATABASE :"db" FROM PUBLIC;
GRANT  CONNECT ON DATABASE :"db" TO bo_migrator, bo_app, bo_ops;

\connect :"db"

GRANT USAGE ON SCHEMA public TO bo_app, bo_ops;

-- ★ DEFAULT PRIVILEGES, not a list of tables.
--
-- The tables do not exist yet — migrations have not run — and a grant cannot
-- name a table that is absent. Listing them after migrating would work once and
-- then rot: the next migration that adds a table would leave the runtime unable
-- to read it, and the failure would arrive in production rather than at deploy.
--
-- This says instead: anything bo_migrator creates in `public` from now on is
-- readable and writable by bo_app, and never deletable. New migrations need no
-- grant step, and cannot forget one.
--
-- The cost, stated because it is real: a blanket default also covers
-- `schema_migrations`, which the runtime has no business touching. Step 2 below
-- takes that one back. It is a single REVOKE rather than a hand-maintained list
-- of grants, so the failure mode is one line forgotten once, not one line
-- forgotten per future table.
ALTER DEFAULT PRIVILEGES FOR ROLE bo_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO bo_app;

\echo ''
\echo 'Roles created. Two steps remain, in this order:'
\echo ''
\echo '  1. Migrate AS THE MIGRATOR (not as the app role):'
\echo '       DATABASE_URL=postgres://bo_migrator:PW@HOST/DB npm run migrate'
\echo ''
\echo '  2. Grant the sweep, and take back the ledger — both need tables that'
\echo '     step 1 creates, so they cannot be granted above:'
\echo '       GRANT SELECT, DELETE ON sessions TO bo_ops;'
\echo '       REVOKE ALL ON schema_migrations FROM bo_app;'
\echo ''
\echo 'Then point the application at bo_app, and nothing else at bo_migrator.'
\echo ''
