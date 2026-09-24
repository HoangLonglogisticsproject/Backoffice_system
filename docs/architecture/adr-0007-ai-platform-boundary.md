# ADR-0007 — The AI Platform is a separate bounded application at `/AI`; the Backend remains the operational source of truth

**Status:** **ACCEPTED** — Phase 1a implemented (foundation), Phase 1b implemented (read models, scan engine, three deterministic detectors). Phases 1c/2/3 build on it without reopening it.

**Date:** 2026-09-19 · **Decided by:** CEO (business rules, decisions A–P of the Final Architecture v1), engineering (shape).

**Affects:** repository topology (`/backend`, `/frontend`, `/AI`) · PostgreSQL schema `ai` and three new roles · backend `infrastructure/service-auth` · CI (`affected.sh`, job `ai`) · every future alert, detector, knowledge and retrieval feature.

**Inputs:** Reality Audit (2026-09-18) · Final AI Architecture v1 (2026-09-19) · [`docs/backend/ai-internal-contracts.md`](../backend/ai-internal-contracts.md).

---

## 1. Context

The backoffice needs an Operational Alert Engine now (deterministic rule detectors over trips, dispatch assignments and completion requests) and a knowledge / retrieval layer later. The audit found: no scheduler, no queue, no service-to-service authentication, no schema outside `public`, a production database still running as the container superuser, an operational board that derives `NO_DRIVER` / `PICKUP_DELAYED` at read time and persists nothing, and a stated doctrine of "no SLA threshold anywhere" in the backend.

Alerts are a different kind of thing from the operational record: they are *opinions about* trips, not trips. Putting them inside `backend/src/capabilities` would give the operational source of truth a second job, and later put an LLM inside the process that enforces business invariants.

## 2. Decision

### 2.1 Topology

- Three applications at the repository root: `/backend`, `/frontend`, `/AI`. Each has its own `package.json`, lockfile, tests, boundary script and CI job.
- **No source import crosses the boundary in either direction.** Enforced mechanically: `AI/scripts/check-boundaries.sh` A1/A2 and `AI/tests/architecture/boundaries.spec.ts`; `backend/scripts/check-boundaries.sh` B15.
- Shared doctrine is copied, not imported (error taxonomy, keyset cursor, migration runner shape, trusted-context wire format). Each copy is pinned by a test on its own side.

### 2.2 Ownership

| | Owns | Never |
|---|---|---|
| **Backend** | Trip, assignment, execution event, completion, cost, customer, location, department, identity, authorization; every business invariant and mutation; the **public** Alert API contract (Phase 1c); the internal read-model API (Phase 1b) | alert storage, detector logic |
| **AI** | The Alert aggregate, lifecycle, transition history, dedupe, scan runs, detectors (1b), scheduler (1b), schema `ai` and its migrations; knowledge, chunks, embeddings, retrieval (Phase 2) | a foreign key into `public`, a `SELECT` on `public.*`, a business mutation, a public listener |
| **Frontend** | The Alerts UI under ĐIỀU PHỐI (Phase 1c), calling the backend only | any call to the AI |

### 2.3 Trust model — three independent layers

1. **Human authorization is the backend's alone.** Session cookie → `AuthGuard` → `CsrfGuard` → `@RequirePermission(...)`. The AI has no `can()` and never recomputes a permission.
2. **Service authentication is per direction.** Backend → AI presents `SERVICE_TOKEN_BACKEND_TO_AI`; AI → Backend presents `SERVICE_TOKEN_AI_TO_BACKEND`. Two secrets, constant-time comparison over SHA-256 digests, one refusal message, never logged. An unset secret closes the door.
3. **A user's lifecycle action carries a signed, short-lived trusted context** — `v1.<payload>.<HMAC-SHA256>` over `{ sub, perms, fn, aud:'ai', iat, exp, cid }`, signed by the backend with `TRUSTED_CONTEXT_SECRET` (a third secret). It is **not a user session token**: it is a *short-lived signed delegation context*, minted only **after** the backend has authenticated the session and authorized the relevant `PermissionKey`, and the AI never uses it to re-run business authorization. The AI verifies signature, shape, `aud`, and the time window — `iat ≤ now + 30 s`, `exp > now − 30 s`, `iat ≤ exp`, `exp − iat ≤ 60 s` — so a well-signed token with an abnormal lifetime is refused whoever signed it; the signer issues exactly 60 s and refuses to issue more. The 30 s is clock tolerance between two hosts, not permission to declare a longer life. The AI records `sub` as actor and `cid` for correlation. `perms` and `fn` travel from day one for Phase 2's retrieval pre-filter but drive no decision in Phase 1.

Network isolation — the AI publishes no host port; the reverse proxy answers 404 for `/api/internal/` — is defence in depth, never the boundary. Plain `X-User-Role` / `X-User-Scope` headers are not a trust model and are not used.

### 2.4 Persistence

- Schema **`ai`** inside the existing PostgreSQL database. Owned by `ai_migrator`.
- The AI owns its migrations: SQL files, filename order, SHA-256 checksum, ledger `ai.schema_migrations`, one transaction per file, session advisory lock with **its own key** (`2_071_946_113`, not the backend's `4_113_559_201`), forward-only, applied files immutable.
- Every business identifier (`trip_id`, `subject_id`, `actor_id`, `*_by`) is a UUID snapshot. **No foreign key leaves the schema.** Display names are joined by the backend at read time (ADR-0001).
- The schema name is configurable only so integration tests can isolate; it is validated as `^[a-z_][a-z0-9_]{0,62}$` at boot and at every splice point, because an identifier cannot be a bound parameter.

### 2.5 Database roles — least privilege, three identities

| Role | Purpose | Has | Has not |
|---|---|---|---|
| `ai_migrator` | `npm run migrate` at deploy | owns schema `ai` | any runtime use, any cleanup job |
| `ai_app` | the runtime | `SELECT, INSERT, UPDATE` on tables in `ai` (default privileges) | `DELETE`, DDL, the ledger, anything in `public` |
| `ai_maintenance` | retention (Phase 1b) | `SELECT, DELETE` on **exactly** `ai.alerts`, `ai.alert_transition_history`, `ai.scan_runs` — named one by one after the first migration | `INSERT`, `UPDATE`, DDL, `TRUNCATE`, the ledger, anything in `public` |

The backend's runtime role receives nothing on `ai`. Provisioning is `AI/scripts/provision-ai-roles.sql` then `AI/scripts/provision-ai-grants.sql`; the integration suite `privileges` executes both scripts verbatim and proves every cell above.

**Rejected alternative — "use the schema owner / migrator credential for periodic retention".** A job that runs unattended would then hold the power to `DROP` the schema it prunes. Least privilege means the identity that deletes rows cannot delete tables. `ai_migrator` is DDL-only.

**Prerequisite, not automation:** the current production arrangement (one container superuser for everything) is *not acceptable* as the AI's production boundary. Phase 1a ships scripts and tests; it changes no live credential. Executing the provisioning — for the backend's `bo_*` roles as well as the AI's — is a deployment prerequisite before the AI is released to production.

### 2.6 The Alert aggregate

`ai.alerts` is one row per **incident**: detector code and version, `source_type ∈ {rule, anomaly, ai}` (Phase 1 writes `rule` only; the others are admitted now so Phase 2/3 need no migration), subject type and id, nullable `trip_id`, severity on the full scale (`info | warning | high | critical`; Phase 1 detectors emit `warning` and `high`), status, title, summary, structured `evidence` JSONB with an `evidence_version`, `dedupe_key`, first/last seen and occurrence count, the acknowledged / dismissed / resolved column groups with pairing CHECKs, scan-run references by id, nullable `confidence` (always `NULL` for rule detectors — confidence is not severity), `created_at`, trigger-maintained `updated_at`.

### 2.7 Lifecycle

```
USER    open → acknowledged · open → dismissed · acknowledged → dismissed
        open → resolved · acknowledged → resolved
SYSTEM  open → resolved · acknowledged → resolved · dismissed → resolved
```
No reopen. No snooze in v1. `resolved` is terminal. Dismissal requires a reason. Invalid moves answer `409 INVALID_ALERT_TRANSITION`. The row is locked (`FOR UPDATE`), the move checked against the current status, the update guarded by that status, and the history row written **in the same transaction** — two concurrent callers produce one winner and one 409.

### 2.8 DISMISSED = suppress until the condition clears (CEO, Option B)

The partial unique index `uq_alert_live_dedupe ON alerts (dedupe_key) WHERE status IN ('open','acknowledged','dismissed')` admits **one live incident per key, including a dismissed one**. Discovery landing on a dismissed key refreshes evidence, severity and `last_seen_at` and **does not change the status**. Only a verified Resolution run moves `dismissed → resolved`. A condition that returns after `resolved` opens a new row.

**`occurrence_count` is the number of distinct scan runs that observed the incident — not the number of upserts — and the distinctness is a fact PostgreSQL enforces.** `ai.alert_scan_observations (alert_id, scan_run_id)` has a primary key on the pair; the count moves only when `INSERT … ON CONFLICT DO NOTHING` on that table actually lands, in the same statement as the increment, in the same transaction as the upsert, under the alert's row lock. Hence: first run A → 1; A, A, A → 1; A, B → 2; **A, B, A → 2** (a late retry of A is still A); A, B, A, B → 2; two workers in one run → counted once; two distinct runs racing → each once. A dismissed incident follows the same rule and stays dismissed. An observation with no run identity (`NULL`) records nothing, never counts, and never overwrites `last_scan_run_id`; the opener of an incident always counts as 1, run identity or not. No `SELECT`-then-decide exists in the service.

### 2.9 Transition history and the actor model

`ai.alert_transition_history` is append-only for the runtime: `from_status` (NULL on creation), `to_status`, `actor_type ∈ {user, system}` with `actor_id` NULL **iff** system, `reason` (mandatory on dismissal), `scan_run_id`, `correlation_id`. There is no fake system user. The runtime cannot delete history because `ai_app` has no `DELETE`; retention by `ai_maintenance` is the one authorised path.

### 2.10 Discovery ≠ Resolution (invariant M)

Discovery scans candidate windows, produces positive signals and upserts by dedupe key. Resolution enumerates live alerts, re-fetches the canonical subject state by id, evaluates the current condition and resolves **only when that state was successfully verified**. A failed, partial or malformed scan never means a condition disappeared. `ai.scan_runs` carries the outcome (`running | succeeded | partial | failed | abandoned`) that this rests on. Phase 1a ships the table; Phase 1b ships the engine.

**Phase 1b implements both halves.** `ScanEngineService.discover` walks the candidate window and upserts positives; it never resolves. `ScanEngineService.resolve` enumerates the detector's live alerts (open, acknowledged AND dismissed), looks their subjects up **by id**, re-evaluates the same predicate, and closes only what the returned facts show to be clear. A timeout, a 5xx, a body that does not match the contract, a page it could not finish, or a subject the backend did not return all leave every alert exactly where it was — and the run is marked `partial` or `failed`, which `resolveBySystem` independently refuses to resolve against.

**`scan_runs.outcome` is a verdict on VERIFICATION, not on mutation.** The run is
closed as `succeeded` before any alert is resolved, because `resolveBySystem` refuses a
run that is still `running`; and a resolution that fails afterwards does NOT downgrade
it, because an alert that is already resolved would then appear to have been resolved by
a partial scan. `alerts.resolved_scan_run_id` is the source of truth for what a run
closed; `scan_runs.resolved` is an execution metric written after `finished_at` and may
under-count if the process dies mid-pass. Three crash windows are pinned by test: crash
before the first resolve (nothing corrupt, next scan converges), crash between two
resolves (the first stays resolved and is not re-resolved, no duplicate history, no
reopen), and a mutation whose history write fails (rolled back, alert stays live, run
stays succeeded).

**One predicate, not two.** A detector exposes a single `evaluate(facts, now)`; Discovery asks it about candidates and Resolution asks it about existing subjects. Two predicates would drift, and the day they disagreed an alert would either be raised forever or closed while its condition held.

**The persistence layer holds the invariant, not the engine's discipline.** `AlertService.resolveBySystem` requires a non-null `scanRunId` and, inside the same transaction as the update, checks that the run exists, has `phase = 'resolution'`, `outcome = 'succeeded'`, and `detector_code` equal to the alert's — then that the alert admits a system resolution. Any failure leaves the alert and its history untouched. The system actor is refused at the user transition door, so this is the only path to `system_cleared`. There is no HTTP route for it.

### 2.11 Backend read models supply FACTS; the AI owns ALERT POLICY

The backend's internal read-model endpoints (Phase 1b) return **canonical operational facts** — trip status, archived, `pickupAt`, active assignment count, assignment state, `hasLiveEvents` (computed by the backend's own `hasLiveEvents` predicate), latest completion state, `submittedAt` — with coarse, factual narrowing for efficiency (a timestamp window, `state=active`, pagination). They **never** encode "is this an alert", severity bands, thresholds, detector-specific exclusions or the final active/clear decision. Those live in `/AI`. The backend says what is true; the AI decides whether that fact means an alert.

### 2.12 Configuration

Thresholds and severity bands are configuration injected into detectors, never constants inside them. Approved values: Detector 1 lead time **2 h**; Detector 3 warning after **12 h** — these are the defaults, overridable per environment.

Everything else is **not decided, and therefore has no default**. Phase 1b makes each absence explicit rather than guessing:

| Absent | Behaviour |
|---|---|
| a detector's HIGH band | the detector emits `warning` and never `high` |
| **Detector 2's grace** | **the detector is DISABLED**, and says so at boot — a zero grace would alert on every assignment the moment its pickup passed, which is a business decision nobody took |
| `SCAN_INTERVAL` | the scheduler does not arm; the Alert API still serves |
| the backend URL or the AI→backend token | the scheduler does not arm |

Durations are written with a unit (`2h`, `30m`) and parsed at boot: a bare number is ambiguous by a factor of a thousand and is refused.

### 2.12a Scheduling and exclusion (Phase 1b)

An in-process interval timer, not a job runner: there is one recurring task per detector and nothing to enqueue, retry or route, so a broker would add a service to operate in exchange for nothing. What a queue would have provided — exactly one worker — comes from `pg_try_advisory_lock(771053318, key(detectorCode, phase))` on a dedicated connection, held outside any transaction for the length of the scan and released in `finally`. `try`, not `wait`: a tick that cannot take the lock has nothing to do. A worker that dies releases the lock with its session, and a connection that dies mid-scan is detected (the client carries its own `error` listener) and destroyed rather than returned to the pool.

This is deliberately NOT "we only run one container". Two replicas during a rolling deploy is the normal case; the guarantee is a property of the database, not of the topology.

### 2.12b Candidate bands, and the discovery page cap

Discovery stops after 100 pages and reports `partial` rather than claiming a complete
scan. With a single ascending walk that cap was a **liveness bug**, not merely a slow
path: overdue trips accumulate at the head of the order, so a large enough backlog would
consume the whole budget on every run and a trip leaving in ninety minutes would never be
evaluated — the alert that matters most would be the one that never fires.

A detector therefore returns candidate **bands** in priority order, and Discovery walks
them under one shared budget. D1 asks for `(now, now + lead]` first and `(-∞, now]`
second. The bands are half-open and adjacent, so a pickup at exactly `now` falls in the
overdue band and in exactly one of them. The backend gained an optional, purely technical
`after` bound to express this; it still knows nothing about what two hours means.

This is scan ORDERING, not policy. The predicate is unchanged, overdue trips remain
candidates for ever, and no retention window or cutoff is invented. A band left unwalked
because the budget ran out is reported as `partial`, naming the band.

### 2.13 What is deliberately absent

No queue or broker (Redis, BullMQ, Kafka, RabbitMQ). No cron package. No chatbot, no conversational surface. No RAG, LLM SDK, embedding provider, vector index or pgvector in Phase 1 — pgvector is the *preferred Phase-2 candidate*, not a dependency, and the PostgreSQL image does not change until the Phase-2 gate (image support, provisioning, backup behaviour, resource usage, a real approved corpus) is passed. Engineering documents (ADRs, READMEs, migrations) are never ingested into production operational retrieval.

## 3. Consequences

- One more Node process on a 1 CPU / 2 GB VPS; measured, not assumed, before production (Phase 1b exit).
- Three new secrets and three new database roles to provision; the provisioning is a gate, not a script that runs itself.
- Two copies of small shared contracts (cursor, errors, trusted context) with a test on each side, instead of a shared package the repository has no tooling for.
- The backend gains an `infrastructure/service-auth` module with no consumer until Phase 1b/1c — the boundary exists before the first route that crosses it.
- `affected.sh` gains a third classification; a change under `/AI` runs the `ai` job and deploys nothing.
- SonarCloud duplication (`.sonarcloud.properties`): the copied infrastructure files — migration runner, pool adapter, keyset cursor, env schema, health probe, integration-test harness — are excluded from copy-paste detection only, because they duplicate the backend's on purpose to keep the boundary. Nothing under `AI/src/core` is excluded and no rule is disabled. Repeated literals inside PostgreSQL `CHECK (… IN (…))` constraints are accepted as canonical values of a declarative constraint, not extracted.
- Phase 1b adds one table (`ai.alert_scan_observations` was Phase 1a; nothing new in 1b) and no migration at all: the scan engine writes only through the Phase 1a aggregate.
- Retention needs `DELETE`, so `ai.*` carries **no** deny-delete trigger (a deviation from the backend's history tables); the guarantee is GRANT plus the A7 boundary rule.

## 4. Alternatives rejected

| Alternative | Why not |
|---|---|
| `backend/src/capabilities/ai` | Gives the operational source of truth a second job; puts future model workloads inside the invariant-enforcing process |
| Frontend → AI directly | Duplicates session/CSRF/permission logic; a second public surface |
| Forward the user's session token to the AI | Turns a browser credential into a service credential; the AI would have to resolve sessions |
| One shared service secret for both directions | A leak on either side opens both doors |
| Backend owns the alert tables | The backend would then own alert policy too |
| A separate PostgreSQL instance | The VPS cannot carry one; a separate schema gives the ownership boundary at no cost |
| node-cron / BullMQ / Redis | No job type needs a queue; an interval plus an advisory lock is the whole requirement |
| `deny_delete` triggers on `ai.*` | Would forbid the authorised retention path |
| **`ai_migrator` for periodic retention** | **Violates least privilege — the identity that prunes rows must not be able to drop tables** |

## 5. Related

ADR-0001 (identity projection) · ADR-0002 / ADR-0003 (pagination) · ADR-0004 (assignment grain; "started" = one live execution event) · ADR-0005 / ADR-0006 (function-based permission) · CORE-001 · [`docs/backend/ai-internal-contracts.md`](../backend/ai-internal-contracts.md).
