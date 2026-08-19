# Internal Adversarial Test Plan

Companion to [`security-hardening-audit.md`](security-hardening-audit.md).

**This is an internal adversarial test plan, executed by the same agent that reviewed the
code. It is NOT an independent penetration test and must not be recorded as one.** See §5
and §7 for what that distinction costs.

**Executed:** 2026-08-19 · PostgreSQL 17.11 · Node 24.18 · `NODE_ENV=production` ·
`CORS_ORIGINS=https://app.hoanglong.test` · `TRUST_PROXY_HOPS=0`

---

## 1. Threat actors

| Actor | Access | What they want |
|---|---|---|
| **A1 · Anonymous internet** | Network reach only | Any authenticated action; account discovery |
| **A2 · Malicious website** | Victim's browser, victim already logged in | CSRF; read cross-origin responses |
| **A3 · Authenticated MEMBER** | Valid session, no elevated role | Read/act outside their department; escalate |
| **A4 · Authenticated DEPARTMENT_HEAD** | Valid session, head of one unit | Act on another unit; reach global routes; self-promote |
| **A5 · Departed employee** | Recently disabled account, session token possibly captured | Continue acting after offboarding |
| **A6 · Newly provisioned user** | Temporary credential, not yet changed | Act before finishing provisioning |
| **A7 · Insider with DB read** | A dump of the database | Recover live credentials or session tokens |
| **A8 · Compromised frontend (XSS)** | Script in the victim's page | Steal a credential that outlives the page |
| **A9 · Holder of the runtime DB connection** | The application's PostgreSQL credentials | Erase the audit trail, escalate inside the database, exfiltrate to disk |

Explicitly **out of scope** (no independent tester, no infrastructure in this repository):
network position/MITM, TLS configuration, host and container escape, physical access,
social engineering, supply-chain compromise of npm.

## 2. Attack surface

| Surface | Detail |
|---|---|
| HTTP routes | 20 (17 mutating, all behind `CsrfGuard`) |
| Credential transport | One — `bo_session` HttpOnly cookie. No bearer fallback |
| Unauthenticated routes | `POST /auth/login`, `GET /health` |
| Trust boundaries | Cookie → `AuthGuard`; route params → `PermissionGuard`/`HeadOfRouteDepartmentGuard`; body → zod DTO |
| Data stores | PostgreSQL only. No cache, no queue, no session store outside the DB |
| Secrets at rest | `identities.secret_hash` (scrypt), `sessions.token_hash` (SHA-256). Nothing else |
| Config inputs | `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, `ALLOWED_EMAIL_DOMAINS`, `NODE_ENV`, `DATABASE_URL` |

## 3. Attack cases and results — round 1 (application layer)

**48 cases executed live**, numbered 1–48. Round 2 adds cases 49–72 in §6.
`PASS` = the system refused the attack.

### 3.1 Authentication — A1

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 1 | Login, unknown account | 401, generic | `401 Invalid credentials.` | PASS |
| 2 | Login, known account, wrong password | 401, **byte-identical to #1** | identical | PASS |
| 3 | Timing: unknown vs wrong password, 5 samples | indistinguishable | `.108/.107/.107/.126/.108` vs `.109/.108/.121/.136/.128` | PASS |
| 4 | Login as a disabled account with the correct password | 401, generic | `401 Invalid credentials.` | PASS |
| 5 | Brute force, 12 attempts on one subject | throttled | 401×4 → **429** from #5 | PASS |
| 6 | `Retry-After` present on 429 | header set | `Retry-After: 898` | PASS |
| 7 | **Correct** password while throttled | still 429 | **429** | PASS |

### 3.2 Session — A1, A5, A7, A8

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 8 | Token in login response body | absent | `{user, expiresAt}` only | PASS |
| 9 | Token entropy | ≥128 bits | 43-char base64url = **256 bits** | PASS |
| 10 | Forged token `deadbeef` | 401 | 401 | PASS |
| 11 | Empty cookie value | 401 | 401 | PASS |
| 12 | Path traversal `../../etc/passwd` | 401 | 401 | PASS |
| 13 | SQL injection `' OR 1=1--` | 401, no SQL error | 401 | PASS |
| 14 | **Replay a captured token after logout** | 401 | 401 | PASS |
| 15 | Session after password change | 401 | 401 | PASS |
| 16 | Token recoverable from a DB dump | no | SHA-256 hash only | PASS |
| 17 | Token readable by script | no | `HttpOnly` set | PASS |

### 3.3 Cookie — A2, A8

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 18 | `HttpOnly` in production | set | set | PASS |
| 19 | `Secure` in production | set | set | PASS |
| 20 | `SameSite` | `Strict` | `Strict` | PASS |
| 21 | `Domain` scope | host-only | **absent** = host-only | PASS |
| 22 | `Path` scope | `/` | `/` | PASS |
| 23 | Expiry matches server session | yes | matched | PASS |

### 3.4 CORS — A2

| # | Origin | Expected | Observed | |
|---|---|---|---|---|
| 24 | `https://evil.example.com` | no ACAO | none | PASS |
| 25 | `https://app.hoanglong.test` (allowed) | exact echo | exact | PASS |
| 26 | `https://app.hoanglong.test.evil.com` | no ACAO | none | PASS |
| 27 | `https://evil.com?https://app.hoanglong.test` | no ACAO | none | PASS |
| 28 | `http://app.hoanglong.test` (scheme downgrade) | no ACAO | none | PASS |
| 29 | `https://APP.hoanglong.test` (case) | no ACAO | none | PASS |
| 30 | `null` origin | no ACAO | none | PASS |
| 31 | Wildcard with credentials | never | exact origin + `Vary: Origin` | PASS |

### 3.5 CSRF — A2

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 32 | `POST /auth/login` without `x-requested-with` | 403 | 403 | PASS |
| 33 | Same request with the header | 200 | 200 | PASS |
| 34 | All 17 mutating routes carry `CsrfGuard` | 17/17 | 17/17 by enumeration | PASS |

### 3.6 Access control — A1, A3, A4

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 35 | Unauthenticated on 5 protected routes | 401 | 401 ×5 | PASS |
| 36 | HEAD(A) → `GET /departments/B/members` | 403 | 403 | PASS |
| 37 | HEAD(A) → `GET /departments/B` | 403 | 403 | PASS |
| 38 | HEAD(A) → `GET`/`POST /departments/B/membership-requests` | 403 | 403 | PASS |
| 39 | HEAD(A) → `POST /departments/B/account-invitations` | 403 | 403 | PASS |
| 40 | HEAD(A) → `GET /departments` (list all) | 403 | 403 | PASS |
| 41 | HEAD(A) → `POST /departments`, `POST /users` | 403 | 403 | PASS |
| 42 | HEAD(A) → global queues (requests, invitations) | 403 | 403 | PASS |
| 43 | HEAD(A) → `POST /departments/A/head` (self-promote) | 403 | 403 | PASS |
| 44 | HEAD(A) → `PATCH /users/<self>/status` | 403 | 403 | PASS |
| 45 | Body tampering: `role`, `global`, `permissions` | stripped | stripped by zod; asserted in specs | PASS |

### 3.7 Provisioning gate — A6

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 46 | Temporary credential → 5 protected routes | 403 `PASSWORD_CHANGE_REQUIRED` | 403 ×5 | PASS |
| 47 | Temporary credential → `POST /auth/password` | allowed | 204, all sessions revoked | PASS |

### 3.8 Error handling and injection — A1, A3

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 48 | Malformed UUID in path | 4xx, no leak | **500 before fix → 422 after** | **FIXED** |
| — | Malformed JSON | 400, no stack | 400 generic | PASS |
| — | Schema violation | 422, field names only | 422 | PASS |
| — | Unknown route / wrong method | 404, no internals | 404 | PASS |
| — | Valid but absent UUID | 404 | 404 | PASS |
| — | SQL injection via cookie | 401, no SQL error | 401 | PASS |
| — | Stack trace / SQL / path / credential in any response | never | never | PASS |

## 4. Evidence

- **Live instance:** real application in `NODE_ENV=production` against PostgreSQL 17.11,
  bootstrapped with a real SUPERADMIN, two departments and a real department head.
- **Automated regression:** 543 tests, 33 suites, 0 skipped, real PostgreSQL — including
  146 HTTP security assertions and workflow-race tests that assert final database state.
- **Static verification:** all 66 SQL call sites parameterised; guard chain enumerated
  route-by-route; secret grep across the repository; `npm audit` clean.
- Environment (`sec_audit` database, temp files, running process) was **torn down** after
  the run. No fixture or credential from this plan is committed.

## 5. Remaining assumptions

Each of these is an assumption this plan **could not test**, not a finding:

1. **TLS terminates correctly upstream.** `Secure` cookies and HSTS depend on it; neither
   the certificate nor the terminator exists in this repository.
2. **The reverse proxy sets `X-Forwarded-For` honestly and `TRUST_PROXY_HOPS` matches the
   real hop count.** A mismatch turns the per-IP throttle budget into a formality.
3. **PostgreSQL is not reachable from outside the deployment network.** `docker-compose.yml`
   publishes `5432:5432`, which is correct for development only.
4. **The runtime database role is least-privilege.** It is currently a **superuser** —
   finding 2 in the audit.
5. **One replica.** The login throttle is per-process; N replicas give N× the budget.
6. **The session-sweep cron is installed.** Rows are inert without it, but the table grows.
7. **`ALLOWED_EMAIL_DOMAINS` is set** where provisioning should be restricted; it defaults
   to unrestricted by design.
8. **The frontend has no XSS.** `HttpOnly` means a script cannot steal the cookie, but it
   can still act as the user while the page is open. CSP is the deployment's to set.
9. **No independent tester has looked at this.** Every result above was produced by the
   same agent that reviewed the code, so it shares that agent's blind spots. This is the
   single most important limitation of this document.


---

## 6. Attack cases and results — round 2 (database containment)

Added after the least-privilege roles landed (audit §21.2). These test the **containment**
layer: what an attacker reaches if they somehow obtain the runtime's database connection —
through a future SQL-injection bug, a leaked `DATABASE_URL`, or a compromised process.

**Threat actor A9 · holder of the runtime DB connection.** Not currently reachable — there
is no injection vector (§11 of the audit) — which is exactly why this is a containment
test rather than an exploitability one.

### 6.1 What `bo_app` must not be able to do

Executed as `bo_app` against a fully provisioned PostgreSQL 17.11 database.

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 49 | `DELETE FROM users` | denied | `permission denied for table users` | PASS |
| 50 | `DELETE FROM sessions` (mass logout) | denied | `permission denied for table sessions` | PASS |
| 51 | `TRUNCATE users` | denied | `permission denied for table users` | PASS |
| 52 | `DROP TABLE sessions` | denied | `must be owner of table sessions` | PASS |
| 53 | `ALTER TABLE users ADD COLUMN …` | denied | `must be owner of table users` | PASS |
| 54 | `CREATE TABLE evil(...)` | denied | `permission denied for schema public` | PASS |
| 55 | `SELECT * FROM schema_migrations` | denied | `permission denied for table schema_migrations` | PASS |
| 56 | `CREATE ROLE eviluser LOGIN` (escalation) | denied | `permission denied to create role` | PASS |
| 57 | `COPY users TO '/tmp/x.csv'` (exfiltration to disk) | denied | `permission denied to COPY to a file` | PASS |

Erasing the audit trail — the thing the whole disable/archive design exists to preserve —
is now refused by PostgreSQL rather than by convention.

### 6.2 What `bo_ops` must not be able to do

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 58 | `SELECT * FROM users` | denied | `permission denied for table users` | PASS |
| 59 | `DELETE FROM users` | denied | `permission denied for table users` | PASS |
| 60 | `INSERT INTO sessions …` (forge a session) | denied | `permission denied for table sessions` | PASS |
| 61 | Sweep expired/revoked sessions | allowed | `DELETE 4` | PASS |

The sweep role can remove dead sessions and read nothing about people.

### 6.3 The application still works under least privilege

Containment is worthless if it breaks the product. Full flow as `bo_app`:

| # | Case | Observed | |
|---|---|---|---|
| 62 | Bootstrap CLI creates the first SuperAdmin | created | PASS |
| 63 | login · create department · provision user · assign head | 200 / 201 | PASS |
| 64 | `GET /authorization/me`, `GET /departments/:id/members` | 200 | PASS |
| 65 | Invitation approval (user + identity + membership, one tx) | 201, secret returned once | PASS |
| 66 | Revoke head, disable user (5 writes, one tx) | 200 | PASS |
| 67 | Logout (UPDATE sessions) | 204 | PASS |
| 68 | Round-1 fixes still hold (malformed UUID, CSRF) | 422 / 403 | PASS |
| 69 | Permission errors in the application log | **zero** | PASS |
| 70 | Full automated suite as `bo_migrator` | 543/543, 0 skipped | PASS |

### 6.4 Source-level guard

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 71 | Inject a `DELETE FROM …` into a repository | `npm run check` fails | B13 fails, exit 1, names file and line | PASS |
| 72 | Remove it again | check passes | `✔ B13 runtime ↛ DELETE` | PASS |

Without 71 the grant model would fail in production instead of at CI, so this case is the
one that keeps the other nine honest.

## 7. Assumptions retired and remaining

**Retired in round 2** — assumption 4 of §5 ("the runtime database role is least
privilege") is no longer an assumption. It is provisioned by
`backend/scripts/provision-db-roles.sql`, verified above, and guarded at CI by B13.

**Still standing:** assumptions 1, 2, 3, 5, 6, 7, 8 and 9 of §5 — TLS termination, proxy
header handling, database network exposure, single replica, the session-sweep cron,
`ALLOWED_EMAIL_DOMAINS`, frontend XSS, and above all the absence of an independent tester.

**Still true, and the reason this document exists:** `PENTEST = NOT PERFORMED`.

## 8. Re-running this plan

Requirements: Docker PostgreSQL, a built backend, a free port.

```bash
docker exec backoffice-postgres psql -U backoffice -d postgres -c "CREATE DATABASE sec_audit;"
cd backend && npm run build
export DATABASE_URL="postgres://backoffice:backoffice@localhost:5432/sec_audit" \
       NODE_ENV=production PORT=3999 LOG_LEVEL=error \
       CORS_ORIGINS="https://app.hoanglong.test" TRUST_PROXY_HOPS=0
npm run migrate
BOOTSTRAP_PASSWORD='<choose one>' npm run user:create -- \
  --email boss@example.test --name "Global Boss" --superadmin
node dist/main.js &
```

Then exercise §3 with `curl`. Two notes that cost time when missed:

- **The throttle is per process.** Section 3.1 leaves the subject blocked for 15 minutes;
  restart the app to reset counters before re-running 3.2 onward.
- **Guards run before pipes.** A scoped caller is refused 403 before a malformed parameter
  is ever validated, so case 48 is only observable as a caller authorized for that route
  (SUPERADMIN, or a global-permission route).

Tear down afterwards:

```bash
docker exec backoffice-postgres psql -U backoffice -d postgres -c "DROP DATABASE sec_audit;"
```
