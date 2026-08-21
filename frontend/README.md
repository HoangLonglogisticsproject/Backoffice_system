# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Running the integration suite locally

`npm test` is the unit suite and needs nothing. `npm run test:integration` talks
to a REAL backend and a REAL PostgreSQL, so it needs both running and it needs a
bootstrapped SuperAdmin to sign in as.

### Required environment

| Variable | Required | Meaning |
|---|---|---|
| `API_BASE_URL` | no — defaults to `http://localhost:3000` | where the backend is listening |
| `BOSS_EMAIL` | **yes** | the bootstrapped SuperAdmin |
| `BOSS_PASSWORD` | **yes** | its password |

**There is deliberately no default credential.** A fallback password in a spec
file becomes a real password the moment `API_BASE_URL` points at a real
deployment, and it is one that lives in git forever. The suite refuses to start
without both variables and names the ones that are missing:

```text
Missing required environment variable(s): BOSS_EMAIL, BOSS_PASSWORD.
```

Passwords for the accounts a spec provisions itself are generated per run — see
`src/test/integration-credentials.ts`. Nothing stores them and nothing needs to.

### From scratch

```bash
# 0. the two required variables, plus an admin connection to create the database
export BOSS_EMAIL='boss@hoanglonglti.com'
export BOSS_PASSWORD="$(openssl rand -base64 24)"   # yours, not written down
export ADMIN_URL='postgres://backoffice:backoffice@localhost:5432/postgres'

# 1. a database that is NAMED as a test database — the specs wipe schemas
cd ../backend && docker compose up -d
psql "$ADMIN_URL" -c 'CREATE DATABASE backoffice_itest;'

# 2. schema, then a SuperAdmin whose password you choose here and now
export DATABASE_URL='postgres://backoffice:backoffice@localhost:5432/backoffice_itest'
npm run migrate
BOOTSTRAP_PASSWORD="$BOSS_PASSWORD" npm run user:create -- --email "$BOSS_EMAIL" --name 'Local SuperAdmin' --superadmin

# 3. the backend, in the shape the suite was written against
NODE_ENV=production PORT=3000 CORS_ORIGINS='' TRUSTED_PROXIES='' node dist/main.js

# 4. the suite
cd ../frontend && npm run test:integration
```

CI does the same thing and mints a throwaway credential per run, masked in the
log — see `.github/workflows/ci.yml`.
