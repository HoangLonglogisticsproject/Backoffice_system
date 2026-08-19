# Security Hardening Audit — Production Backend

**Branch:** `feat/security-hardening-audit`
**Base:** `main` @ `2dee56e` (PR #3 merged)
**Date:** 2026-08-19
**Scope:** backend + database + operational configuration. No frontend file read or modified.
**Runtime under test:** PostgreSQL 17.11, Node 24.18, `NODE_ENV=production`

**Skills used:** `senior-backend`, `senior-data-engineer`, `security-review` (built-in).
**Skill not available:** there is **no `senior-security` skill in this session**. The
`security-review` skill loaded but its input is the branch diff, which was empty at audit
start, so it contributed methodology (severity bands, confidence scoring, false-positive
exclusions) rather than findings. Nothing below is attributed to a skill that did not run.

---

## 1. Executive summary

The authentication, authorization, session and workflow layers are in **good shape** and
the previous baseline holds up under independent adversarial testing. This audit did not
merely re-read the code — it booted the real application in `NODE_ENV=production` against
real PostgreSQL and ran **48 live attack cases**. Results are in §16 and the reproducible
plan is in [`security-test-plan.md`](security-test-plan.md).

**One real defect was found and fixed. One correction to a previous audit is recorded.
Nothing HIGH or CRITICAL was found, so no stop-and-report was triggered.**

### What was fixed

**A malformed UUID in a route parameter returned HTTP 500.** Guards compare the parameter
as a string, so a caller genuinely authorized for the route passed them and the raw value
reached PostgreSQL, which rejected the cast (SQLSTATE 22P02). That is not a `DomainError`,
so `DomainErrorFilter` did not map it and Nest's default filter answered 500.

- **No information leaked** — the body was Nest's generic `Internal server error`; the
  PostgreSQL detail (`routine: string_to_uuid`) went only to the log.
- **Not reachable anonymously** — 401 unauthenticated, 403 for a caller not authorized for
  that parameter. Only an already-authorized caller (in practice SUPERADMIN, or a
  global-permission route) could trigger it.
- **Severity: LOW.** A contract defect, not a confidentiality or integrity one — but §11 of
  the audit brief lists the status codes as a contract, and an endpoint that answers 500 to
  malformed input trains monitoring to ignore its own error rate.

Fixed by `src/common/http/uuid-param.pipe.ts`, applied to all 17 route parameters. Answers
**422** with the project's existing error shape — the same status a malformed *body*
already produced through `ZodValidationPipe`. One contract, not two. 14 regression tests
added; suite is now **543 passing, 0 skipped**.

### Correction to the previous audit

The database audit (PR #3, §16) recorded session cleanup as *"no sweep job found in `src/`
— worth confirming whether it is external or missing."* **It is neither missing nor
unclear.** `session.service.ts:29-46` documents it as an explicit deployment
responsibility and ships the exact statement to run, with the reasoning for keeping it out
of the application (a scheduler inside the app means a job runner, a leader-election story
for multiple replicas, and a failure mode, to run one statement cron already knows how to
run). `idx_sessions_expires_at` exists to make that delete cheap. **Reclassified from "open
question" to ACCEPTED / INTENTIONAL**, with a deployment-checklist item rather than a code
change.

### Also corrected during this audit

An early finding of *"CSRF regression coverage absent"* was **wrong and is withdrawn**. It
came from a case-sensitive grep for `x-requested-with` that missed `X-Requested-With`. All
seven security specs carry a dedicated `describe('CSRF')` block with negative tests. No
CSRF tests were needed and none were added.

### Findings at a glance

| # | Finding | Severity | Class |
|---|---|---|---|
| 1 | Malformed UUID path param → 500 | LOW | **FIX NOW** — fixed on this branch |
| 2 | App connects to PostgreSQL as a **superuser** role | MEDIUM | **FIX LATER** — deployment, not code |
| 3 | Login throttle is in-memory, per process | MEDIUM (multi-replica only) | **ACCEPTED** — documented deferral |
| 4 | `/health` unauthenticated, exposes `environment` + uptime | LOW | **OBSERVE** |
| 5 | scrypt `N=2^16`, one notch below current OWASP floor | LOW | **OBSERVE** — do not change without requirement |
| 6 | Session sweep is a deployment duty | INFO | **ACCEPTED / INTENTIONAL** |
| 7 | No independent penetration test has been performed | — | **OPEN** — see §15 |

---

## 2. Authentication

Read in full (`authentication.service.ts`), then attacked live.

| Property | Verdict | Evidence |
|---|---|---|
| Account enumeration | **Not possible** | Unknown subject and wrong password return byte-identical `{"error":{"code":"UNAUTHORIZED","message":"Invalid credentials."}}` at 401 |
| Timing side channel | **Not observable** | Unknown: `0.108 0.107 0.107 0.126 0.108`s · Wrong password: `0.109 0.108 0.121 0.136 0.128`s — overlapping distributions. `hasher.fakeVerify()` burns matching work on the unknown-subject path |
| Disabled account leak | **Not possible** | Status is checked **after** the password, deliberately — checking first would reveal which accounts are disabled without knowing a password |
| Broken credential row | Handled | `secretHash === null` takes the `fakeVerify` path, not a crash |
| Brute force | **Throttled** | 401×4 then 429 from attempt 5 (subject counter already loaded by prior cases); `Retry-After: 898` |
| Throttle bypass with correct password | **Not possible** | Correct password during throttle → **429**, not 200 |
| Throttle cost ordering | Correct | `throttle.check()` runs **before** any DB work or hashing, so a blocked caller costs nothing and cannot be used to exhaust scrypt |

**Password storage** (`scrypt-password-hasher.ts`): scrypt (RFC 7914) `N=65536, r=8, p=1`
≈ 64 MB / ~100 ms, 16-byte random salt per hash, `timingSafeEqual` comparison, NFKC
normalisation, and a **self-describing digest** — cost parameters stored alongside the hash,
so raising cost later does not invalidate existing rows. Policy floor 12 chars for a chosen
password (NIST SP 800-63B floor is 8), 8 for a temporary one.

See finding 5 for the one observation, which is deliberately **not** acted on.

## 3. Session

| Property | Verdict | Evidence |
|---|---|---|
| Token entropy | **256 bits** | `randomBytes(32).toString('base64url')` — observed 43-char token |
| Storage | **Hash only** | SHA-256 of the token; a dump of `sessions` yields nothing presentable |
| Why SHA-256 not a KDF | Correct | The token is 256 random bits — there is no dictionary to slow down, and a memory-hard hash on every authenticated request would be a self-inflicted DoS |
| Transport | **Cookie only** | No `Authorization: Bearer` fallback anywhere; `sessionTokenFrom()` reads the cookie exclusively |
| Token in response body | **No** | Login returns `{user, expiresAt}` only — verified live |
| Expiry | 12 h fixed | No sliding expiry, no refresh token |
| Revoked replay | **Refused** | Captured token replayed after logout → **401** |
| Forged / injected token | **Refused** | `deadbeef`, empty, `../../etc/passwd`, `' OR 1=1--` → all **401** |
| Disabled mid-session | **Refused** | `resolve()` re-checks `u_status` on **every** request, not just at login |
| Password change | **Revokes every session incl. caller's own** | One transaction; old session → 401 immediately after |
| Disable account | **Revokes every session** | Same transaction as role revocation and membership close |
| Session fixation | **Not applicable** | No session exists before authentication; `issue()` always mints a fresh token |

## 4. Cookie

Observed live with `NODE_ENV=production`:

```
Set-Cookie: bo_session=<43-char base64url>; Path=/; Expires=…; HttpOnly; Secure; SameSite=Strict
```

| Attribute | Value | Verdict |
|---|---|---|
| `HttpOnly` | set | ✅ unreadable from script — an XSS cannot walk away with the credential |
| `Secure` | set in production | ✅ driven by `AppConfig.isProduction`; off in dev only because localhost has no certificate |
| `SameSite` | **Strict** | ✅ stronger than Lax — removes CSRF as a class rather than mitigating it |
| `Path` | `/` | ✅ the API is the whole app; no narrower path exists |
| `Domain` | **absent** | ✅ host-only cookie — the tightest possible scope, never sent to a sibling subdomain |
| `Expires` | matches server-side expiry | ✅ browser stops sending a cookie the server would only reject |

`clearSessionCookieOptions` mirrors the same attributes, which is required for a clear to
actually take effect.

**HSTS and CSP are deliberately not set by the application** and this is correct: HSTS is a
property of the TLS terminator (setting it from an app reachable over plain HTTP in dev
either does nothing or locks a developer out of localhost for months), and CSP describes
where the *frontend's* assets come from — this API serves none and cannot know.
**Deployment owns both.**

## 5. CORS

Configuration is exact-allowlist from `CORS_ORIGINS`, **empty by default** (CORS off,
same-origin only — the production shape). The schema **refuses `*`** outright, because a
wildcard cannot carry credentials.

Attacked live with `CORS_ORIGINS=https://app.hoanglong.test`:

| Attack | `Access-Control-Allow-Origin` | Verdict |
|---|---|---|
| `https://evil.example.com` | **none** | ✅ browser blocks |
| `https://app.hoanglong.test` (allowed) | echoed exactly | ✅ |
| `https://app.hoanglong.test.evil.com` (suffix) | **none** | ✅ no prefix matching |
| `https://evil.com?https://app.hoanglong.test` (query smuggle) | **none** | ✅ no substring matching |
| `http://app.hoanglong.test` (scheme downgrade) | **none** | ✅ scheme-sensitive |
| `https://APP.hoanglong.test` (case) | **none** | ✅ case-sensitive |
| `null` origin | **none** | ✅ sandboxed-iframe vector closed |

`Access-Control-Allow-Credentials: true` appears **only** alongside an exact origin, never
with a wildcard. `Vary: Origin` is present, so a shared cache cannot serve one origin's
CORS decision to another.

> A refused preflight still answers `204` with `Allow-Methods`/`Allow-Headers` but **no
> `Allow-Origin`**. That is correct — the browser blocks on the missing header — but it
> reads like success to a human skimming curl output. Noted so it is not re-reported.

## 6. CSRF

Two independent layers:

1. **`SameSite=Strict`** — the primary defence. The browser never attaches the cookie to a
   cross-site request.
2. **`CsrfGuard`** — requires the `x-requested-with` header on every unsafe method. A form,
   an `<img>` or a `fetch` from another origin cannot set a custom header without a
   preflight, and that preflight fails (CORS off ⇒ never answered; CORS on ⇒ attacker's
   origin is not on the allowlist).

**Coverage verified by enumeration, not assumption.** All **17** mutating routes carry
`CsrfGuard`:

| Controller | Mutating routes | All guarded |
|---|---|---|
| `auth` | login, logout, password | ✅ 3/3 |
| `organization` | create, rename, archive, transfer-in | ✅ 4/4 |
| `users` | create, set-status | ✅ 2/2 |
| `department-head` | assign, revoke | ✅ 2/2 |
| `membership-request` | create, approve, reject | ✅ 3/3 |
| `account-invitation` | create, approve, reject | ✅ 3/3 |

Live: `POST /auth/login` without the header → **403**
`{"error":{"code":"FORBIDDEN","message":"State-changing requests must send the x-requested-with header."}}`;
with the header → **200**.

Regression coverage exists in all seven security specs (`describe('CSRF')`) — see the
withdrawn finding in §1.

## 7. Authorization

The model is **relation-based, not role-based**: `can()` decides from `global` / `headOf` /
`memberOf`, which are what the database actually stores, so no derived role label can drift
out of step with its rows.

Three properties that matter more than the table:

- **Context is loaded from the database on every request.** Not cached, not in the cookie.
  A revoked role stops working on the next request, with no invalidation to get wrong.
- **Scope comes from the ROUTE, never the body.** `@RequirePermission(key, 'departmentId')`
  names a route parameter. A body that named the department could name any of them.
- **Fail-closed everywhere.** A handler behind `PermissionGuard` with no declared permission
  is refused. A scoped permission asked with no target returns `false`.

| Permission | Requirement | Effect |
|---|---|---|
| `unit.read` | member | member of that department, or global |
| `unit.member.read` | head | head of that department, or global |
| `unit.write` · `unit.member.write` · `role.assign` · `user.write` | global | **SUPERADMIN only** |

`AuthGuard` is **opt-in per route**, not global-with-`@Public`. This was checked by
enumerating every route rather than trusting the pattern: **all 20 routes carry the correct
chain**; the only unguarded route is `GET /health`, which is intentional (finding 4).

## 8. IDOR

Attacked live as the **head of department A** against department B and against global
routes. Every attempt refused:

| Attack | Result |
|---|---|
| `GET /departments/A/members` (own) | **200** ✅ legitimate |
| `GET /departments/B/members` | **403** |
| `GET /departments/B` | **403** |
| `GET`/`POST /departments/B/membership-requests` | **403** |
| `POST /departments/B/account-invitations` | **403** |
| `GET /departments` (list all) | **403** |
| `POST /departments` (create) | **403** |
| `POST /users` (provision) | **403** |
| `GET /membership-requests` (global queue) | **403** |
| `GET /account-invitations` (global queue) | **403** |
| `POST /departments/A/head` (self-promote in own dept) | **403** |
| `GET /departments/A/head` (read own dept's role) | **403** |
| `PATCH /users/<self>/status` (self-disable) | **403** |

**Body tampering** is closed by construction: the zod DTOs strip unknown keys, so
`role`, `permissions`, `global`, `status`, `requestedBy`, `decidedBy` sent in a body are
discarded before the service sees them — and the existing specs assert this
(`.send({ ...body, role: 'SUPERADMIN', global: true, permissions: ['role.assign'] })`).
Identity-bearing values come from the session (`actor.id`) or the route, never the body.

**Temporary-credential gate**, attacked live on a freshly provisioned head:

| Route | Result |
|---|---|
| `GET /auth/me` | 200 — by design, the only readable route |
| `GET /authorization/me` | **403** `PASSWORD_CHANGE_REQUIRED` |
| `GET /departments`, `/departments/:id/members`, `/membership-requests` | **403** |
| `POST /departments/:id/membership-requests` | **403** |
| `POST /auth/password` | 204 — the one route that resolves the state |

After the change, the old session was **401**: every session died with the password change.

## 9. Approval workflows

Every attack case in the brief's §6 is already covered by existing integration tests that
assert **final PostgreSQL state**, not just HTTP status. Verbatim test names:

| Attack | Existing test |
|---|---|
| Head loses role before approve | *refuses when the requester is no longer the head* |
| Target moved department before approve | *refuses when the target moved department after the request was raised* |
| Department archived meanwhile | *refuses when the department was archived in the meantime* |
| Self-approval | *refuses a self-decision* **and** *refuses a self-approval at the database level too* |
| Double approve | *approving twice in sequence is a conflict, and moves nobody twice* |
| Concurrent approve race | *lets exactly one of two concurrent approvals win* |
| Concurrent invitation race | *lets exactly one of two concurrent approvals create the account* |
| Duplicate pending request | *refuses a duplicate pending request* |
| Duplicate invitation, any department | *refuses a second pending invitation for the same email, from ANY department* |
| Concurrent disable race | *lets exactly one of two concurrent disables win* |
| Approve after reject | *allows a fresh request after a rejection* · *rejecting changes nothing but the request* |
| Source department from client | *records the source department read from the database, not from the caller* |
| Hybrid decision state | *refuses a hybrid decision state* |
| Offboarding a head vs invariant #6 | *offboards a HEAD without tripping invariant #6* |

Concurrency is enforced pessimistically and in the right place: `SELECT … WHERE status =
'pending' FOR UPDATE` makes the status predicate part of the lock, so the loser of a race
sees zero rows rather than making a second decision. **No new tests were needed here.**

## 10. Secrets

| Check | Result |
|---|---|
| Secret reaching a logger | **None** — no `console.log`/`logger.*` call anywhere touches a password, secret, token or hash |
| Secret in a response DTO | **None** — `secret_hash` is never selected into a response type |
| Password echoed back on create | **No** — deliberate: the caller supplied it, echoing adds a leak site and tells them nothing |
| `temporaryPassword` | Appears **only** in the invitation-approval response (the agreed contract) and in `account-provisioning.service.ts` when generated |
| `temporaryPassword` persisted | **No** — asserted by tests: *returns a temporary password, and no column anywhere holds it*, and `JSON.stringify(stored.rows[0])` must not contain it |
| Secret in URL / query string | **None** — all credentials travel in bodies or cookies |
| Hardcoded credentials in `src/` | **None** |
| Secret in a migration | **None** — migrations create structure only; no business data seeded |
| Bootstrap CLI password | Read from prompt or `BOOTSTRAP_PASSWORD`, **never argv** — argv is visible in `ps` and lands in shell history |
| Debug logging of request bodies | **None** |

## 11. Database security

| Check | Result |
|---|---|
| **SQL injection** | **None.** All 66 query sites use literal SQL with `$n` placeholders. The only variable-SQL call sites are the generic executor (text originates from repository literals) and the migration runner (file contents from disk) |
| Live injection attempt | `bo_session=' OR 1=1--` → **401**, no SQL error |
| Dynamic SQL / string building | **None** — grep for interpolation inside query calls returns only an error message and a log string |
| Transaction boundaries | Correct — repositories never open their own (enforced by boundary check **B11**); services own them |
| Invariants | FK + partial-unique + CHECK, verified live at scale in the PR #3 audit |
| Extensions | `plpgsql` only — `gen_random_uuid()` is built in since PG13, so no `pgcrypto` needed. Minimal surface |
| `search_path` | Default `"$user", public`. Not independently exploitable: shadowing would require CREATE SCHEMA rights, which implies the privilege problem below |
| Destructive migrations | None — forward-only, additive, `IF NOT EXISTS` guarded |
| **DB role privileges** | ⚠ **Finding 2** — see below |
| Credentials in `DATABASE_URL` | Environment only, validated by parsing at boot; never logged |

### Finding 2 — the application connects as a PostgreSQL superuser

```
 rolsuper | rolcreatedb | rolcreaterole | rolbypassrls
 t        | t           | t             | t
```

This is the `docker-compose.yml` development default (`POSTGRES_USER` becomes a superuser in
the official image). Nothing in the repository documents that **production must not do the
same**, and nothing checks it at boot.

- **Exploitability today: low.** There is no SQL injection vector (verified above), so
  there is currently no way to reach this privilege from outside.
- **Impact if ever reached: severe.** Superuser removes the last containment layer, and
  `rolbypassrls` would silently defeat any row-level security added later.
- **Not fixable in application code** — the app cannot choose its own role. This is a
  provisioning and deployment-checklist item.

**Recommended:** a dedicated least-privilege role for the runtime connection —
`CONNECT` on the database, `USAGE` on `public`, and `SELECT/INSERT/UPDATE` (no `DELETE`, no
`TRUNCATE`) on the application tables — with migrations run by a **separate, higher-privileged
role** at deploy time. Classified **FIX LATER**: it changes deployment, not code, and it
should be done deliberately with the ops owner rather than invented here.

## 12. Operational security

| # | Item | Verdict |
|---|---|---|
| 1 | Production env variables | Validated once at boot by zod; every problem reported at once |
| 2 | Safe defaults | **Fail-closed**: `CORS_ORIGINS` empty (CORS off), `TRUST_PROXY_HOPS=0` (X-Forwarded-For ignored) |
| 3 | Missing env behaviour | **Refuses to start** — no guessed defaults for `DATABASE_URL` |
| 4 | Logging / PII | No secret logged; log level configurable, default `log` |
| 5 | Error response leakage | Generic bodies only — see §13 |
| 6 | Stack traces in production | **None reach the client** |
| 7 | Health endpoint | Unauthenticated by necessity — **finding 4** |
| 8 | Metrics endpoint | None exists |
| 9 | Debug endpoints | None exists |
| 10 | Swagger / OpenAPI | **Not installed** — no schema exposure |
| 11 | Bootstrap CLI | Local shell only; reads secret from prompt/env, never argv; deliberately exempt from the last-SuperAdmin guard so a locked-out deployment can recover |
| 12 | DB credentials | Environment only |
| 13 | Docker exposure | `docker-compose.yml` publishes `5432:5432` — **development file**; production must not bind PostgreSQL to a public interface |
| 14 | Port exposure | App binds `PORT`; expected behind a reverse proxy |
| 15 | CORS config | Env-driven, `*` refused by schema |
| 16 | Cookie config | `Secure` driven by `NODE_ENV=production` |
| 17 | Rate limiter storage | ⚠ **Finding 3** — in-memory, per process |
| 18 | Session cleanup | **ACCEPTED / INTENTIONAL** — finding 6 |
| 19 | Backup / restore | Not addressed in-repo; deployment responsibility |
| 20 | Migration execution | Runs at app boot via the runner; see finding 2 for the privilege split |
| — | `x-powered-by` | **Disabled** — no framework fingerprint |
| — | Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` — all confirmed live |

### Finding 3 — login throttle is in-memory and per-process

`login-throttle.service.ts` holds counters in a `Map`. With more than one replica an
attacker gets N× the budget, and a restart clears the counters.

**This is already documented in the source as a deliberate deferral** for the
single-instance deployment this foundation targets. It is recorded here as
**ACCEPTED**, with the condition made explicit: *before running more than one replica,
move the throttle to a shared store or an edge rate limiter.* The per-IP key is also only
meaningful when `TRUST_PROXY_HOPS` matches reality — already handled, and defaulted to 0.

### Finding 4 — `/health` is unauthenticated

Returns `{"status","uptimeSeconds","environment","checks":{"database"}}`. It **must** be
unauthenticated — a probe that needs a token cannot run before the app is healthy — and it
exposes no user data. `environment` and `uptimeSeconds` are minor reconnaissance.

**OBSERVE.** If the deployment exposes `/health` beyond the load balancer, restrict it at
the reverse proxy, or drop `environment` from the public payload. Not changed here: it
would be hardening without a concrete threat, and the endpoint's shape is a deployment
contract.

## 13. Error handling and information leakage

Tested live as an authenticated SUPERADMIN in `NODE_ENV=production`:

| Case | Status | Body | Leak |
|---|---|---|---|
| Malformed UUID in path | **422** *(was 500)* | `{"error":{"code":"VALIDATION_FAILED","message":"Malformed identifier."}}` | none |
| Malformed JSON body | 400 | `{"message":"Unexpected end of JSON input","error":"Bad Request","statusCode":400}` | none |
| Schema violation | 422 | `{"error":{"code":"VALIDATION_FAILED","details":{…}}}` | field names only — intended |
| Unknown route | 404 | `{"message":"Cannot GET /does/not/exist",…}` | none |
| Wrong method | 404 | `{"message":"Cannot DELETE /departments",…}` | none |
| Valid but absent UUID | 404 | `{"error":{"code":"NOT_FOUND","message":"Department not found."}}` | none |
| Unauthenticated | 401 | `{"error":{"code":"UNAUTHORIZED","message":"Authentication required."}}` | none |

**No stack trace, no SQL, no filesystem path, no DB credential, no internal class name
reaches a client in any case.** The `401 / 403 / 404 / 409 / 422 / 429` contract holds, and
the 500 that broke it is fixed.

## 14. Dependencies

```
npm audit --omit=dev  →  found 0 vulnerabilities
npm audit (all)       →  {info:0, low:0, moderate:0, high:0, critical:0, total:0}
```

No dependency was updated. Per the brief, only critical/high with a reachable path would
have been reported, and there are none.

## 15. Penetration testing gap

**This audit is NOT a penetration test, and must not be recorded as one.**

| | Automated security regression | This audit | Independent pentest |
|---|---|---|---|
| Performed | ✅ 543 tests | ✅ 48 live attack cases | ❌ **not performed** |
| Independence | authored with the code | **same agent that reviewed the code** | independent party |
| Creativity | fixed cases | adversarial, but scoped by the brief | unscripted |
| Infrastructure/network | ❌ | ❌ | ✅ |
| Social engineering | ❌ | ❌ | typically in scope |

What this audit **did** provide: an internal adversarial test plan, executed against a
production-mode instance, covering the OWASP-relevant application classes for this design
(auth, session, access control, CSRF, CORS, injection, error handling, secrets).

What it **cannot** provide: independence, and any assurance about the network, TLS
termination, host, container runtime, or the reverse proxy — **none of which exist in this
repository**.

**Recommendation before production:** commission an independent test covering TLS/HSTS at
the terminator, reverse-proxy header handling (especially `X-Forwarded-For` versus
`TRUST_PROXY_HOPS`), container and host hardening, database network exposure, and backup
handling. The application-layer surface audited here is the smaller half of that scope.

## 16. Findings

### Finding 1 — Malformed UUID path parameter answered 500 · **FIX NOW** · fixed

- **Evidence:** live, `NODE_ENV=production`, authenticated SUPERADMIN — `GET
  /departments/not-a-uuid`, `GET /departments/not-a-uuid/members`, `PATCH
  /users/not-a-uuid/status`, `POST /membership-requests/not-a-uuid/approve`, `POST
  /account-invitations/not-a-uuid/approve` all returned **500**. Log showed `routine:
  string_to_uuid` (SQLSTATE 22P02).
- **Production impact:** no data exposure. A wrong status code, and 500s that mask genuine
  faults in error-rate monitoring.
- **Likelihood:** high that it occurs (any typo'd link), low that it is weaponised.
- **Severity:** LOW. **Exploitability:** low — 401 anonymous, 403 for a caller not
  authorized for that parameter; only an authorized caller reached it.
- **Remediation:** `UuidParam` pipe on all 17 route parameters → **422**, `VALIDATION_FAILED`,
  same shape as body validation. Verified live; valid UUIDs unchanged (200), absent-but-valid
  still 404. 14 regression tests added.

> **A note worth keeping:** guards run **before** pipes in NestJS. That is why a scoped
> caller always got 403 and never saw the 500 — and why the new tests must seed a *global*
> context to exercise the path that actually failed. Discovered when the first version of
> the tests failed with 403.

### Finding 2 — Application connects to PostgreSQL as superuser · **FIX LATER**

- **Evidence:** `rolsuper=t, rolcreatedb=t, rolcreaterole=t, rolbypassrls=t`.
- **Production impact:** removes the last containment layer; `rolbypassrls` defeats future RLS.
- **Likelihood:** low today — no injection vector exists. **Severity:** MEDIUM.
  **Exploitability:** low in isolation, catastrophic in combination with any future injection.
- **Remediation:** least-privilege runtime role; migrations under a separate role.
- **Why not now:** it changes deployment topology, not code. Inventing a role split without
  the ops owner would be guessing at infrastructure the repository does not describe.

### Finding 3 — In-memory login throttle · **ACCEPTED** (conditional)

- **Evidence:** `Map` in `login-throttle.service.ts`; documented in-source as a deferral.
- **Production impact:** none at one replica. At N replicas an attacker gets N× budget.
- **Severity:** MEDIUM *only* if the deployment scales out. **Remediation:** shared store or
  edge rate limiter. **Why not now:** the target deployment is single-instance and the
  trade-off is already recorded. Promoted to a deployment-checklist precondition.

### Finding 4 — `/health` unauthenticated · **OBSERVE**

- **Evidence:** `{"status":"ok","uptimeSeconds":14,"environment":"production","checks":{"database":"up"}}`.
- **Severity:** LOW. Must stay unauthenticated. **Remediation:** restrict at the proxy or
  drop `environment`. **Why not now:** hardening without a concrete threat; the payload is a
  deployment contract.

### Finding 5 — scrypt `N=2^16` · **OBSERVE** · deliberately not changed

- **Evidence:** `COST = { N: 65_536, r: 8, p: 1 }` ≈ 64 MB / ~100 ms.
- Current OWASP guidance for scrypt is `N=2^17, r=8, p=1`; this is one notch below, and
  comfortably above the older widely-cited floor.
- **Severity:** LOW. The digest is **self-describing**, so cost can be raised later without
  invalidating existing rows — the expensive property is already in place.
- **Why not now:** the brief is explicit — do not raise policy on best-practice grounds
  without evidence or a requirement. Doubling cost doubles login latency and the DoS surface
  the throttle exists to bound. Raise it deliberately, with the throttle reviewed alongside.

### Finding 6 — Session sweep is a deployment duty · **ACCEPTED / INTENTIONAL**

- **Evidence:** `session.service.ts:29-46` documents the decision and ships the statement.
  Rows are inert — `resolve()` rejects expired and revoked — so this is table size, not access.
- **Remediation:** add to the deployment checklist:
  ```sql
  DELETE FROM sessions
   WHERE expires_at < now() - interval '30 days'
      OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days');
  ```
- **This supersedes the open question raised in the PR #3 audit.**

### Finding 7 — No independent penetration test · **OPEN**

See §15. Not a defect in the code; a gap in assurance.

## 17. Production risk matrix

| Area | Risk | Basis |
|---|---|---|
| Authentication | **Low** | No enumeration, no timing signal, throttled, scrypt + per-hash salt |
| Session | **Low** | 256-bit tokens, hash-at-rest, replay refused, revocation immediate |
| Cookie | **Low** | HttpOnly · Secure · SameSite=Strict · host-only · expiry matched |
| CORS | **Low** | Exact allowlist, no reflection, `*` refused by schema |
| CSRF | **Low** | SameSite=Strict + header guard on all 17 mutations, both layers tested |
| Authorization / IDOR | **Low** | Relation-based, route-scoped, per-request DB load, 13/13 attacks refused |
| Approval workflows | **Low** | DB-enforced invariants; every race covered with state assertions |
| Secrets | **Low** | Nothing logged, nothing echoed, nothing persisted |
| Input validation | **Low** | No injection; malformed identifiers now 422 |
| Error handling | **Low** | No leakage in any tested case |
| Dependencies | **Low** | 0 vulnerabilities |
| **Database privileges** | **Medium** | Superuser runtime role — finding 2 |
| **Rate-limit durability** | **Medium at >1 replica** | In-memory — finding 3 |
| Infrastructure / TLS / proxy | **Unknown** | Out of repository scope — finding 7 |

## 18. Fixes performed

| File | Change |
|---|---|
| `src/common/http/uuid-param.pipe.ts` | **new** — `UuidParam`, `ParseUUIDPipe` raising the project's `ValidationError` (422) |
| `organization.controller.ts` · `users.controller.ts` · `department-head.controller.ts` · `membership-request.controller.ts` · `account-invitation.controller.ts` | 17 `@Param` sites validated |
| 4 security specs | 14 regression tests — `describe('malformed identifier in the path')`, seeded with a **global** context because guards run before pipes |

**Business semantics unchanged.** No permission, workflow, schema, migration or response
contract altered. Valid identifiers behave exactly as before; only inputs that previously
produced a 500 changed, and they now produce the documented validation error.

### Verification

| Gate | Result |
|---|---|
| `npm run check` (B1–B12) | ✅ all 12 boundaries clean |
| `npm run typecheck` | ✅ exit 0 |
| `npm run build` | ✅ exit 0 |
| `npm test` (real PostgreSQL 17.11) | ✅ **543 passed / 543**, 33 suites, **0 skipped** |
| Live re-test in `NODE_ENV=production` | ✅ 422 on all five previously-500 routes; 200 valid; 404 absent |

## 19. Remaining risks

1. **Database runtime role is a superuser** (finding 2) — deployment fix required.
2. **Throttle does not survive scale-out or restart** (finding 3) — precondition for >1 replica.
3. **No independent penetration test** (finding 7) — application layer only is covered here.
4. **Infrastructure is out of scope and unverified**: TLS termination, HSTS, reverse-proxy
   header handling, container/host hardening, PostgreSQL network exposure, backups. The
   repository contains none of it, so this audit says nothing about it.
5. **`docker-compose.yml` publishes `5432:5432`** — correct for development, must not be
   reproduced in production.
6. **`ALLOWED_EMAIL_DOMAINS` defaults to unrestricted** — a documented, deliberate trade-off
   for a clonable foundation. A deployment that meant to restrict and forgot will accept
   outside addresses. Belongs on the deployment checklist.

## 20. Recommendations

**Before staging**
1. Provision a least-privilege PostgreSQL role; run migrations under a separate role (finding 2).
2. Add the session-sweep statement to cron (finding 6).
3. Set `CORS_ORIGINS`, `TRUST_PROXY_HOPS` and `ALLOWED_EMAIL_DOMAINS` for the real topology.
4. Terminate TLS and set HSTS at the proxy; set CSP where the frontend is served.
5. Restrict `/health` and PostgreSQL to internal networks.

**Before production**
6. Commission an independent penetration test covering infrastructure (finding 7).
7. If scaling beyond one replica, move the login throttle to a shared store (finding 3).

**Deliberately not done**
- No caching of the authorization context — revocation must stay immediate.
- No role in the session — the database stays the only authority.
- No CSRF relaxation, no wildcard CORS.
- No scrypt cost change without a requirement (finding 5).
- No cron worker added inside the application (finding 6) — the architecture puts it outside.
