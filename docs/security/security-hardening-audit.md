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
| 2 | App connects to PostgreSQL as a **superuser** role | MEDIUM | **FIX NOW** — resolved in round 2, see §21 |
| 3 | Login throttle is in-memory, per process | MEDIUM (multi-replica only) | **ACCEPTED / INTENTIONAL** — 1 replica confirmed, §22.2 |
| 4 | `/health` unauthenticated, exposes `environment` + uptime | LOW | **OBSERVE** |
| 5 | scrypt `N=2^16`, one notch below current OWASP floor | LOW | **KEEP** — benchmarked in round 2, see §21 |
| 6 | Session sweep is a deployment duty | INFO | **ACCEPTED / INTENTIONAL** |
| 7 | No independent penetration test has been performed | — | **OPEN** — see §15, §22.5 |
| 8 | `TRUST_PROXY_HOPS=0` behind Cloudflare makes the throttle global | MEDIUM | **FIX NOW** — fixed in round 4, §23 |

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

### 10b. Temporary credential generation — audited

Audited at the source rather than inferred from behaviour. What each column
below rests on is stated, because "we saw two different passwords" proves
nothing about a generator.

| Property | Value | Evidence |
|---|---|---|
| Where | `account-provisioning.service.ts`, `provision()` | source |
| Primitive | `randomBytes(24).toString('base64url')` | source |
| Random source | `node:crypto.randomBytes` — the platform CSPRNG | source |
| Length | 24 bytes → **32 characters** (base64url, unpadded) | source |
| Alphabet | base64url: `A–Z a–z 0–9 - _` (64 symbols) | source |
| Entropy | **192 bits** — 24 bytes in, and base64url is lossless | source |
| Collision risk | Birthday bound ≈ 2⁹⁶. Not a risk that needs managing. | arithmetic |
| Generated when | **Only** when no `initialPassword` was supplied — i.e. the invitation-approval path. `POST /users` always supplies one. | source |
| Persistence | scrypt hash only (`N=2¹⁶, r=8, p=1`, 16-byte salt, 64-byte key). Plaintext is never written. | source + test |
| Plaintext lifetime | One process, one response. Held in a local, returned, never stored, never re-derivable. | source |
| Returned again? | **No.** The value lives on no entity: `AccountInvitation` has no such column, so list/detail/reject/409 cannot carry it. A second approve is 409. | source + schema |
| In logs? | **No** — no logger or `console.*` call touches it. The bootstrap CLI prints only the created user's id and name. | source |
| Marked temporary | `must_change_secret = true`, set in the same transaction | source |

**What the tests actually prove** — narrower than the table above, and worth
separating:

- the approval response carries a string, and it is ≥ 12 characters
- the stored `secret_hash` does not contain the plaintext
- `JSON.stringify` of the stored invitation row does not contain the plaintext
- nothing is returned when `initialPassword` was supplied

**What no test asserts:** the randomness source, the entropy, the alphabet, or
that two calls differ. Those are established by reading `provision()`, not by
the suite. A regression that swapped `randomBytes` for `Math.random` would keep
every existing assertion green — the length and non-persistence checks would
still pass. That is a real gap in coverage, not a claim of weakness: the shipped
primitive is sound.

**What UAT can observe:** that the reveal appears once, that copying works, and
that a second approve is refused. UAT cannot observe entropy, and should not be
cited as evidence of it.

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

### Finding 2 — Application connects to PostgreSQL as superuser · **FIX NOW** · resolved in round 2 (§21)

- **Evidence:** `rolsuper=t, rolcreatedb=t, rolcreaterole=t, rolbypassrls=t`.
- **Production impact:** removes the last containment layer; `rolbypassrls` defeats future RLS.
- **Likelihood:** low today — no injection vector exists. **Severity:** MEDIUM.
  **Exploitability:** low in isolation, catastrophic in combination with any future injection.
- **Remediation:** least-privilege runtime role; migrations under a separate role.
- **Why not now:** it changes deployment topology, not code. Inventing a role split without
  the ops owner would be guessing at infrastructure the repository does not describe.

### Finding 3 — In-memory login throttle · **ACCEPTED / INTENTIONAL** (conditional, §21)

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

### Finding 5 — scrypt `N=2^16` · **KEEP** · benchmarked in round 2 (§21)

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
| Database privileges | **Low** | Three least-privilege roles, runtime has no DELETE and no DDL — §21 |
| **Rate-limit durability** | **Medium at >1 replica** | In-memory — precondition documented, §21 |
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

---

# 21. Round 2 — hardening the accepted findings

Second pass on the same branch. Round 1 audited and fixed one defect; this round takes the
three findings left open, resolves the one that can be resolved inside the repository, and
settles the other two with measurement rather than opinion.

**No security semantics changed.** No permission, workflow, cookie attribute,
authentication rule or business lifecycle was touched.

## 21.1 Required decision matrix

| Finding | Severity | Production impact | Decision | Evidence | Follow-up |
|---|---|---|---|---|---|
| **DB superuser** | MEDIUM | Runtime held `rolsuper` + `bypassrls`: no containment if ever reached, and future RLS silently void | **FIX NOW** — done | Three roles provisioned and exercised on real PostgreSQL 17.11; full business flow passes as `bo_app`; DDL/DELETE/TRUNCATE/COPY/CREATE ROLE all denied (§21.2) | DBA runs `provision-db-roles.sql` per environment |
| **Distributed throttle** | MEDIUM *only* at >1 replica | At N replicas an attacker gets N× the login budget; restart clears counters | **ACCEPTED / INTENTIONAL** | Repository contains **zero** production deployment artifacts — no k8s, Terraform, Dockerfile or Procfile; only a local `docker-compose.yml`. No multi-replica target stated anywhere (§21.3) | README §8 precondition: shared store **before** the second replica |
| **scrypt cost** | LOW | Raising it triples the cost of the attack the throttle bounds | **KEEP** at `N=2^16` | Benchmarked: `2^17` costs **6.6×** single-hash latency (104 ms → 693 ms), throughput 30 → 9 hash/s, at 2× memory (§21.4) | Revisit if auth gets dedicated capacity; digest self-describing, no reset ever needed |
| **Pentest** | — | Application layer covered; infrastructure entirely unverified | **OPEN — NOT PERFORMED** | No independent tester exists. §15 and the test plan both say so plainly | Commission before production |
| **Session cleanup** | INFO | Table growth only; rows are inert | **ACCEPTED / INTENTIONAL** | `session.service.ts` documents it and ships the statement; `idx_sessions_expires_at` makes it cheap | `bo_ops` now exists precisely to run it (§21.2) |
| **Malformed UUID → 500** | LOW | Wrong status code; 500s mask real faults | **FIX NOW** — done in round 1 | 5 routes verified 500 → 422 live; 14 regression tests | none |

## 21.2 PostgreSQL least privilege — implemented and proven

**Before:** one role, `backoffice`, holding `rolsuper`, `rolcreatedb`, `rolcreaterole` and
`rolbypassrls`, used for migrations, runtime, bootstrap and tests alike.

**The enabling discovery:** `migrate.cli.ts` is *already* a separate entry point from
application boot, deliberately — "migrating is a deploy step, not a boot step". So the
runtime never needed DDL: **only the configuration conflated the principals, not the code**.
No application change was required to split them.

| Role | Used by | Privileges |
|---|---|---|
| `bo_migrator` | `npm run migrate`, deploy step | owns the database and every object in it |
| `bo_app` | runtime + bootstrap CLI | `SELECT, INSERT, UPDATE` — **no DELETE**, no DDL |
| `bo_ops` | session-sweep cron | `SELECT, DELETE` on `sessions` only |

**The runtime has no DELETE, and that is evidence-based.** Every repository was read: the
application issues **no DELETE at all**. It disables users, archives departments, ends
memberships and revokes assignments — all UPDATEs, because keeping history is the design.
Withholding DELETE turns that decision into something PostgreSQL enforces rather than
something the next repository has to remember.

Grants use `ALTER DEFAULT PRIVILEGES FOR ROLE bo_migrator`, so tables added by *future*
migrations are covered automatically. A hand-maintained grant list would rot at the next
migration and fail in production rather than at deploy. The one cost is stated in the
script itself: a blanket default also covers `schema_migrations`, which step 2 revokes.

Bootstrap deliberately shares `bo_app`: at the database level it issues the same INSERTs
the API already issues when a SuperAdmin provisions somebody, so a fourth role would carry
identical grants and imply a boundary PostgreSQL is not enforcing. What gates bootstrap is
shell access and `BOOTSTRAP_PASSWORD`, not a GRANT.

### Verified on real PostgreSQL 17.11

| Check | Result |
|---|---|
| `provision-db-roles.sql` from a clean cluster | ✅ roles created; no elevated attribute on any of the three |
| Migrations `0001`→`0008` as `bo_migrator` (non-superuser) | ✅ 8 applied; all objects owned by `bo_migrator` |
| Default privileges reached migration-created tables | ✅ all 9 tables granted `INSERT,SELECT,UPDATE` automatically |
| Bootstrap CLI as `bo_app` | ✅ SuperAdmin created |
| Full business flow as `bo_app` | ✅ login · create department · provision user · assign head · `/authorization/me` · list members · revoke head · disable user (5 writes, 1 tx) · logout — **zero permission errors** |
| Invitation approval as `bo_app` | ✅ provisions user + identity + membership in one transaction; temporary secret returned once |
| Session sweep as `bo_ops` | ✅ 4 rows swept |
| Previous round-1 fixes still hold | ✅ malformed UUID → 422, CSRF without header → 403 |
| Full test suite as `bo_migrator` | ✅ **543 passed / 543**, 33 suites, **0 skipped** |

### Negative boundaries — every one denied for `bo_app`

```
DELETE FROM users           ERROR:  permission denied for table users
DELETE FROM sessions        ERROR:  permission denied for table sessions
TRUNCATE users              ERROR:  permission denied for table users
DROP TABLE sessions         ERROR:  must be owner of table sessions
ALTER TABLE users ADD ...   ERROR:  must be owner of table users
CREATE TABLE evil(...)      ERROR:  permission denied for schema public
SELECT * schema_migrations  ERROR:  permission denied for table schema_migrations
CREATE ROLE eviluser        ERROR:  permission denied to create role
COPY users TO '/tmp/x.csv'  ERROR:  permission denied to COPY to a file
```

For `bo_ops`: reading `users`, deleting `users` and inserting a forged session are all
denied. It can sweep sessions and nothing else.

### B13 — the invariant the grant model rests on

The grant model assumes the application never issues a DELETE. If someone adds one, the
failure surfaces in **production** as `permission denied` while a reviewer sees nothing
wrong. So the assumption is now checked at CI, in the mechanism this repository already
uses for architectural rules:

```
✔ B13 runtime ↛ DELETE
```

Proven to catch a real violation: injecting `DELETE FROM department_memberships` into a
repository makes `npm run check` exit 1 and name the file and line; removing it makes the
check pass again. A check that has never failed is not a check.

**No credentials are committed.** `provision-db-roles.sql` takes passwords as psql
variables from the operator's environment, so the file is safe to commit and safe to read
over somebody's shoulder.

## 21.3 Distributed throttle — ACCEPTED, with the precondition made binding

The brief's rule was to build a shared store only if production already targets more than
one replica. The repository was searched for that target and **there is none**: no
Kubernetes manifest, no Terraform, no Dockerfile, no Procfile, no process-manager config.
The only YAML is `docker-compose.yml`, which starts a local PostgreSQL for development.

Adding Redis on that evidence would be exactly what the brief forbids — a new
infrastructure dependency, with its own availability and failure semantics, bought for a
limit that does not yet exist.

**Decision: ACCEPTED / INTENTIONAL**, and the deferral is upgraded from a note to a
precondition in README §8: *before running more than one replica*, move the throttle to a
shared store or put the rate limit at the edge.

> The production replica count is the one input this audit could not derive from the
> repository. **If the target is already more than one, this decision flips** and the
> shared store should be designed before launch.

## 21.4 scrypt cost — KEEP, measured not assumed

Benchmarked on the audit machine (Intel i5-13500HX, Node 24.18, `UV_THREADPOOL_SIZE` default 4):

| Parameters | Single hash | Memory/hash | 30 concurrent | Throughput |
|---|---|---|---|---|
| **`N=2^16, r=8, p=1` (current)** | **104 ms** | **64 MiB** | 933 ms | **30 hash/s** |
| `N=2^17, r=8, p=1` (OWASP) | 693 ms | 128 MiB | 3,228 ms | 9 hash/s |

Raising N costs **6.6×**, not the 2× the parameter change suggests: at 128 MiB per hash
scrypt falls out of cache and memory bandwidth dominates. Throughput drops to a third, and
30 concurrent logins — the per-IP budget the throttle already permits — would reserve
3.8 GiB instead of 1.9 GiB.

That interacts badly with the control protecting this endpoint. The throttle exists
*because* each login costs ~100 ms of memory-hard work; tripling that cost triples the
leverage of the attack it bounds.

**Backward compatibility was proven, not assumed.** Digests are self-describing
(`scrypt$N$r$p$salt$hash`) and `verify()` reads the cost from the digest, so both costs
coexist in one table:

```
old digest   scrypt$65536$8$1    correct pw → verifies    wrong pw → rejected
new digest   scrypt$131072$8$1   correct pw → verifies    wrong pw → rejected
```

**Decision: KEEP.** 104 ms sits in the band OWASP itself targets, no requirement exists,
and the expensive property — raising cost later without invalidating a single stored
password or forcing a reset — is already in place. **RAISE LATER** if authentication gets
dedicated capacity or the threat model changes; new passwords would take the new cost, old
digests keep verifying, and re-hash on successful login is available if wanted.

## 21.5 Files changed in round 2

| File | Change |
|---|---|
| `backend/scripts/provision-db-roles.sql` | **new** — three-role provisioning, no credentials, run once by a DBA |
| `backend/scripts/check-boundaries.sh` | **B13 runtime ↛ DELETE**, proven to fail on a real violation |
| `backend/README.md` | new §7 (three PostgreSQL principals); §8 throttle deferral upgraded to a precondition |
| `backend/.env.example` | `DATABASE_URL` documented as the runtime role; migration command shown separately |
| `docs/security/security-hardening-audit.md` | this section, the decision matrix, and updated cross-references |
| `docs/security/security-test-plan.md` | database-privilege attack cases added |

**No application source changed in round 2.** The privilege split needed configuration and
documentation, not code — because `migrate.cli.ts` had already made the separation possible.

---

# 22. Round 3 — confirmed topology, posture, and PR readiness

The production topology was confirmed by the project owner after round 2:

```
Cloudflare  →  1 VPS  →  1 backend replica  →  PostgreSQL
```

That settles the one input the previous rounds could not derive from the repository. It
also surfaced a new finding, because a proxy in front of the application changes what the
login throttle is actually counting (§22.3).

## 22.1 Security posture

| Area | Status | Basis |
|---|---|---|
| Authentication / session | **PASS** | No enumeration, no timing signal, throttle holds against the correct password, 256-bit tokens hashed at rest, replay refused, revocation immediate |
| Authorization / IDOR | **PASS** | Relation-based, route-scoped, context reloaded per request; 13/13 cross-department and global attacks refused |
| Cookie / CORS / CSRF | **PASS** | `HttpOnly; Secure; SameSite=Strict; Path=/`, host-only; exact-match CORS with 7 bypasses refused; all 17 mutations behind `CsrfGuard` |
| Secret handling | **PASS** | Nothing logged, echoed or persisted; temporary secret only in its agreed response |
| **DB least privilege** | **PASS** | Three roles; runtime has no DELETE and no DDL; verified on PostgreSQL 17.11 (§21.2, §22.6) |
| DB invariants / race | **PASS** | FK + partial-unique + CHECK, proven live at 1M-row scale in the PR #3 audit |
| Approval / bypass | **PASS** | Every race and self-decision case covered with final-state assertions |
| Automated security regression | **PASS** | 543/543, 0 skipped, real PostgreSQL |
| Malformed input handling | **PASS** | 17/17 UUID params → 422 in one envelope; no injection anywhere |
| Distributed throttle | **ACCEPTED** | 1-replica constraint — §22.2 |
| scrypt cost | **KEEP / OBSERVE** | Benchmarked; `2^17` costs 6.6× — §21.4 |
| Client IP attribution | **PASS** | `TRUSTED_PROXIES` trusts the peer, not a hop count — §23 |
| **Origin restriction** | ⚠ **DEPLOYMENT — REQUIRED** | Not enforceable in code; checklist §3 |
| External pentest | **NOT PERFORMED** | No independent tester — §22.5 |
| Infrastructure security | **NOT AUDITED** | Outside this repository — §22.5 |

## 22.2 Distributed throttle — ACCEPTED / INTENTIONAL

> **Login throttle is process-local by design because current production topology has one
> backend replica. Before horizontal scale-out to 2+ replicas, the throttle must move to a
> shared atomic store and this becomes a production launch precondition.**

Nothing was implemented. No Redis, no KV, no shared store, no multi-replica infrastructure.

**Attacker budget, stated precisely.** `WINDOW_MS` 15 minutes, `MAX_PER_SUBJECT` 10,
`MAX_PER_IP` 30, counters in a `Map` in the single Node process:

| Topology | Effective budget |
|---|---|
| **1 replica (today)** | 10 per account and 30 per source IP per 15 min — process-local *is* global |
| 2 replicas | 20 per account, 60 per source IP — an attacker simply spreads requests |
| N replicas | N × the intended limit |
| After any restart | Counters reset to zero |

The restart reset is accepted: an attacker who can restart the process has already won more
than a throttle.

**Exact trigger to revisit** — written down so it is not a memory:

| Condition | Required action |
|---|---|
| A second backend replica | **Blocking.** Move to a shared atomic store *before* it serves traffic |
| Any multi-instance load balancer | Same |
| A limit that must survive restart | Shared store, or rate limit at Cloudflare |
| Still one replica | Nothing |

If that day comes, the shape is already implied by the current key scheme: the same
normalised subject and IP keys, atomic increment with TTL, and a fail decision that must be
chosen deliberately — failing open turns the store's outage into an open door, failing
closed turns it into a login outage. Neither is free, and neither should be picked in an
audit that has no requirement in front of it.

## 22.3 ⚠ NEW FINDING — `TRUST_PROXY_HOPS` under the confirmed topology

**Severity: MEDIUM · Decision: FIX BEFORE LAUNCH · Configuration only, no code change.**

This did not exist as a finding until the topology was confirmed. With Cloudflare in front
of the application, `TRUST_PROXY_HOPS=0` — the current default — makes Express ignore
`X-Forwarded-For` and take `req.ip` from the socket, which is **Cloudflare's edge address,
not the caller's**. The login throttle keys on `req.ip`.

**Demonstrated live**, `NODE_ENV=production`, `TRUST_PROXY_HOPS=0`, a proxy simulated by
`X-Forwarded-For`:

```
36 failed logins, each from a DIFFERENT client IP and a different account:
  attempts  1–30 → 401
  attempts 31–36 → 429      ← distinct clients shared ONE bucket

then, a brand-new client IP with the CORRECT password:
  → 429                      ← locked out by other people's failures
```

Two consequences, and the first is the one that bites:

1. **Availability.** The per-source throttle degenerates into a *global* one. Thirty failed
   logins anywhere — one confused user with caps lock, or one attacker — lock out **every
   user of the deployment** for fifteen minutes. That is a one-command denial of service
   against login.
2. **Security.** The per-source isolation the code intends does not exist, so an attacker
   gets no worse treatment than a legitimate user, and legitimate users absorb the penalty.

**With `TRUST_PROXY_HOPS=1`, both are fixed** — same build, same code:

```
36 failed logins from 36 different client IPs  → all 401, no shared lockout
legitimate user from a fresh client IP         → 200
one client brute-forcing 35 times              → 401 ×30 then 429   (still contained)
```

### The companion control this REQUIRES

Trusting `X-Forwarded-For` is only safe if the header cannot be written by the caller. In
the test above **the header was set by curl** — which is exactly the attack: with
`TRUST_PROXY_HOPS=1` and an origin reachable directly, an attacker rotates
`X-Forwarded-For` and mints an unlimited number of fresh throttle buckets, voiding the
control completely.

So the two settings are a pair, and neither is correct alone:

| | Origin open to the internet | Origin restricted to Cloudflare |
|---|---|---|
| `TRUST_PROXY_HOPS=0` | throttle is global → lockout DoS | throttle is global → lockout DoS |
| `TRUST_PROXY_HOPS=1` | **throttle void** — attacker forges XFF | ✅ **correct** |

**Required before launch, both together:**

1. Set `TRUST_PROXY_HOPS` to the real hop count between the caller and the application.
2. Restrict the origin so only Cloudflare can reach it — firewall to Cloudflare's published
   ranges, or Cloudflare Tunnel so the origin has no public listener at all.

### Determining the hop count

The value is the number of proxies that append to `X-Forwarded-For`, and it depends on
something this repository cannot see — whether nginx sits on the VPS between Cloudflare and
Node:

| Actual path | `TRUST_PROXY_HOPS` |
|---|---|
| Cloudflare → Node directly | `1` |
| Cloudflare → nginx → Node | `2` |

**Confirm it rather than assume it.** Temporarily log `req.ip` alongside
`req.headers['x-forwarded-for']` on a staging request from a known address, and pick the
value that makes `req.ip` equal that address. Setting it too high is as bad as too low: the
caller's own forged entry starts being believed.

> **Cloudflare's `CF-Connecting-IP` is deliberately not used.** Reading it would be a code
> change, and it is only trustworthy under the same condition — that the request really came
> from Cloudflare. It buys nothing over a correct hop count plus a restricted origin, and it
> would add a provider-specific header to an application that currently has none.

## 22.4 Session cleanup — ACCEPTED / INTENTIONAL

No scheduler was added to the backend: the deployment layer is not in this repository, and
a job runner with leader election would be more machinery than the single statement needs.

| | |
|---|---|
| **Owner** | Deployment / ops — cron on the VPS |
| **Principal** | `bo_ops`, which holds `SELECT, DELETE` on `sessions` and nothing else |
| **Command** | `DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days');` |
| **Recommended frequency** | Daily, off-peak. The 30-day window means being several days late costs nothing |
| **If it stops** | Table growth only — **no loss of safety**. `resolve()` already refuses expired and revoked sessions, so dead rows are inert. The cost is disk and a larger index |
| **Monitoring** | Alert when `SELECT count(*) FROM sessions` exceeds a threshold set from user count, or when the job has not run for 7 days |

`idx_sessions_expires_at` exists to keep the delete cheap. Verified live: `bo_ops` swept
sessions successfully and could neither read `users` nor forge a session.

## 22.5 Assurance status — read this before saying "secure"

| Activity | Status | By whom |
|---|---|---|
| **Automated security regression** | **PASS** — 543/543, 0 skipped | The test suite, in CI |
| **Internal adversarial testing** | **PERFORMED** — 72 live cases across 3 rounds | The same agent that reviewed the code |
| **External penetration test** | **NOT PERFORMED** | — no independent tester has examined this system |
| **Infrastructure security** | **NOT AUDITED** | Cloudflare configuration, VPS hardening, TLS, firewall, backups — none of it is in this repository |

**This system is not certified secure, and this audit does not claim it is.** What it
claims is narrower and checkable: the application-layer controls listed in §22.1 were
tested and held. The internal adversarial testing shares the blind spots of the person who
wrote the code being tested, which is precisely what an external test exists to correct.

Now that the topology is known, an external test has a concrete scope: Cloudflare
configuration and origin exposure, TLS and HSTS at the edge, VPS hardening and SSH,
PostgreSQL network reachability, backup handling, and the `TRUST_PROXY_HOPS` pairing in
§22.3 as deployed rather than as documented.

## 22.6 Round 3 re-verification on PostgreSQL 17.11

The roles were dropped and re-provisioned from the committed script, from a clean cluster.

| Check | Result |
|---|---|
| Role attributes | ✅ `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolbypassrls` all **false** on all three |
| Migrations as `bo_migrator` | ✅ 8 applied |
| `bo_app` DELETE / DELETE sessions | ✅ `permission denied` |
| `bo_app` TRUNCATE | ✅ `permission denied` |
| `bo_app` DROP TABLE | ✅ `must be owner` |
| `bo_app` ALTER TABLE | ✅ `must be owner` |
| `bo_app` CREATE TABLE | ✅ `permission denied for schema public` |
| `bo_app` CREATE INDEX | ✅ `must be owner` |
| `bo_app` CREATE ROLE | ✅ `permission denied to create role` |
| `bo_app` read `schema_migrations` | ✅ `permission denied` |
| `bo_app` `COPY … TO FILE` | ✅ `permission denied` |
| `bo_app` GRANT itself DELETE | ✅ `no privileges were granted` — it is not the owner |
| `bo_app` SELECT / INSERT / UPDATE | ✅ all work — runtime is fully functional |
| `bo_ops` read or delete `users` | ✅ `permission denied` |
| `bo_ops` forge a session | ✅ `permission denied` |
| `bo_ops` sweep sessions | ✅ works |
| **B13** | ✅ passes clean; proven in round 2 to fail with exit 1 on an injected DELETE |
| UUID params | ✅ 17/17 covered; all malformed values → 422 in one envelope |

## 22.7 PR readiness

**Ready.** Scope is security audit documentation, the two focused fixes already agreed, and
database privilege configuration. No frontend file, no business feature, no change to the
authorization model, session semantics or cookie semantics, and no new infrastructure
dependency.

One item must not be lost between merge and launch, because it is configuration rather than
code and therefore invisible to CI: **`TRUST_PROXY_HOPS` and origin restriction (§22.3)**.
It belongs on the launch checklist, not in the merge.

---

# 23. Round 4 — finding 8 fixed: trust the peer, not a hop count

Round 3 raised finding 8 and left it as a launch-checklist item. This round fixes it in the
application, because the mechanism itself — not just its value — was wrong.

## 23.1 The finding, and its root cause

**Symptom** (measured in round 3): behind Cloudflare with `TRUST_PROXY_HOPS=0`, 30 failed
logins from 30 *different* client IPs exhausted one shared bucket, and a new client with the
correct password was then refused 429. The per-source throttle had become global.

**The obvious fix is also wrong.** Setting the count to `1` makes `req.ip` the forwarded
address — but a hop count believes `X-Forwarded-For` **regardless of which peer connected**.
Measured on Express 5.2.1, peer `127.0.0.1`, `trust proxy = 1`:

| Header sent | `req.ip` |
|---|---|
| *(none)* | `127.0.0.1` |
| `X-Forwarded-For: 203.0.113.9` | **`203.0.113.9`** |

So with the origin reachable, an attacker rotates the header and mints a fresh throttle
budget per request. The two failure modes are opposite and a single number cannot avoid
both.

**Root cause: the setting expressed the wrong idea.** A hop count answers "how many proxies
are in front", which is a fact about topology that the code cannot verify and that changes
silently when someone adds nginx. The question that actually decides safety is *"did this
request arrive through a proxy we trust?"* — a fact about the **peer**, which the runtime can
check on every request.

## 23.2 The fix

`TRUST_PROXY_HOPS` (a number) is replaced by `TRUSTED_PROXIES` (a list of IPs, CIDR blocks,
or the presets Express understands). Express checks the list against the peer instead of
counting.

Measured on the same Express version, same requests:

| `trust proxy` | peer | `X-Forwarded-For: 203.0.113.9` → `req.ip` |
|---|---|---|
| `false` *(default)* | `127.0.0.1` | `127.0.0.1` — header ignored |
| `1` *(old mechanism)* | `127.0.0.1` | `203.0.113.9` — **forgeable** |
| `['127.0.0.1']` | `127.0.0.1` — **listed** | `203.0.113.9` — believed, correctly |
| `['198.51.100.1']` | `127.0.0.1` — **not listed** | `127.0.0.1` — **header ignored entirely** |

The last row is the fix: a forged header from a direct connection changes nothing.

**It also removes the question nobody could answer.** Express walks the forwarded chain from
the right, discarding listed addresses and stopping at the first one that is not — the real
client. With `['loopback', '172.20.0.0/16']` and `X-Forwarded-For: 203.0.113.9, 172.20.0.5`,
`req.ip` is `203.0.113.9`. So the same configuration is correct whether the chain is
`Cloudflare → node` or `Cloudflare → nginx → node`, and **nobody has to count hops**. Adding
a proxy later does not silently change the meaning of a number.

**Default is `false`, not `[]`.** An empty array is still a list, and Express reads it as
"consult the chain"; only `false` means trust nobody. Development, where nothing is in
front, is therefore safe with no configuration at all.

**Typos are refused at boot.** An entry that is not an IP, CIDR or preset stops the process.
That matters because the failure would otherwise be silent and inverted: the entry never
matches, no peer is trusted, every caller collapses onto the proxy's address, and the per-IP
throttle becomes global — which looks like working software until it locks everybody out.

**Nothing else changed.** `WINDOW_MS`, `MAX_PER_SUBJECT` (10) and `MAX_PER_IP` (30) are
untouched, the throttle stays in memory, no store was added, and no authentication, session,
cookie or authorization behaviour was modified. The fix changes *who is counted*, not *how
counting works*.

## 23.3 The regression tests, and proof they discriminate

`src/core/identity/api/trusted-proxy.security.spec.ts` — 7 cases driving the real
`AuthenticationService` and the real `LoginThrottleService` over HTTP. Supertest always
connects from `127.0.0.1`, so listing that address models "arrived through the trusted
chain" and omitting it models "reached the origin directly".

| Case | Asserts |
|---|---|
| 36 distinct clients | 36 separate budgets, no 429 — the round-3 symptom cannot return |
| one source guessing | first 30 → 401, rest → **429** — the control still bites |
| noisy client vs everyone else | blocked source gets 429 while another client's **correct** login gets 200 |
| ordinary login | 200, `HttpOnly` cookie, token still absent from the body |
| **spoofed header, untrusted peer** | 36 rotated addresses collapse to one bucket and hit **429** — no unlimited buckets |
| socket vs claimed address | one key, not two |
| no proxy configured | header ignored entirely |

**A regression test that cannot fail is not a test**, so both historical mechanisms were
replayed against this suite:

| Mechanism replayed | Result |
|---|---|
| `trust proxy = false` behind a proxy *(the original bug)* | **2 fail** — "36 distinct clients", "does not lock out everybody else" |
| `trust proxy = 1` *(the plausible wrong fix)* | **1 fails** — "cannot mint unlimited budgets" |
| `trust proxy = ['127.0.0.1']` *(the fix)* | **7 pass** |

Each failure mode is caught by the suite, and by a different case.

## 23.4 Origin restriction — **not enforceable by this application**

`TRUSTED_PROXIES` decides *whom to believe*. It cannot stop anyone **reaching** the origin,
and no amount of application code can: by the time a request is in Express, the connection
has already been accepted.

| | Origin reachable directly | Origin restricted to Cloudflare |
|---|---|---|
| `TRUSTED_PROXIES` empty | throttle global → lockout | throttle global → lockout |
| `TRUSTED_PROXIES` set | **throttle void** — header forged | ✅ correct |

Only the bottom-right cell is safe, and reaching it needs a control outside this repository.
The options are in [`production-launch-checklist.md`](production-launch-checklist.md) §3 —
Cloudflare Tunnel (no public listener at all), a firewall allowlist of Cloudflare's ranges,
or Authenticated Origin Pulls. Each is a documented product feature; **none is invented
here, and this repository cannot verify that any of them is in place.**

The check that actually settles it is behavioural, not configurational: from a host outside
Cloudflare, request the VPS directly and confirm the connection is refused.

## 23.5 Residual risk

| Risk | Status |
|---|---|
| **Origin reachable directly** | **OPEN — deployment.** With `TRUSTED_PROXIES` set, this is the one condition that voids the throttle. Checklist §3, and it is the single most important item there |
| Wrong entries in `TRUSTED_PROXIES` | **Reduced.** A malformed entry stops the boot; a *well-formed but wrong* address still fails silently toward "trust nobody" — the safe direction, but it makes the throttle global. Checklist §1 verifies it with a real request |
| Cloudflare ranges change | **OPEN — deployment.** Ranges are published and do change; a stale list degrades to "trust nobody". Re-check on change, or use a mechanism that does not depend on IP ranges |
| Throttle resets on restart | **ACCEPTED.** Someone who can restart the process has already won more than a throttle |
| Throttle is process-local | **ACCEPTED** at one replica; blocking before a second (§22.2) |
| `X-Forwarded-For` trusted transitively | **ACCEPTED.** Once the peer is a trusted proxy, the chain it reports is believed as far as the first unlisted entry. That is the standard model and it rests on the proxy not forwarding client-supplied headers unchanged — Cloudflare replaces the header rather than appending to it |
| Application enforcing origin restriction | **Not possible.** Stated here so no reader assumes the code covers it |

## 23.6 Verification

| Gate | Result |
|---|---|
| `npm run check` (B1–B13) | ✅ clean |
| `npm run typecheck` | ✅ exit 0 |
| `npm run build` | ✅ exit 0 |
| `npm test` (real PostgreSQL 17.11) | ✅ **551 passed / 551**, 34 suites, **0 skipped** |
| New regression suite | ✅ 7/7, and proven to fail under both historical mechanisms |
| Express behaviour | ✅ probed directly on 5.2.1 rather than assumed |

## 23.7 Files changed in round 4

| File | Change |
|---|---|
| `src/config/env.schema.ts` | `TRUST_PROXY_HOPS` → `TRUSTED_PROXIES`, validated at boot |
| `src/config/app.config.ts` | `trustProxyHops` → `trustedProxies` |
| `src/main.ts` | `trust proxy` takes the peer list, `false` when empty |
| `src/config/env.schema.spec.ts` | updated for the new variable, including boot refusal |
| `src/core/identity/api/trusted-proxy.security.spec.ts` | **new** — 7 regression cases |
| `.env.example` | documents the variable, the Cloudflare source, and the origin caveat |
| `docs/security/production-launch-checklist.md` | **new** — the deployment half |
| `docs/security/security-hardening-audit.md` | this section |

**Config migration:** a deployment still setting `TRUST_PROXY_HOPS` is not broken — the
variable is simply ignored, and the app falls back to trusting nobody, which is the safe
direction. It must be replaced with `TRUSTED_PROXIES` before launch or the throttle will be
global.
