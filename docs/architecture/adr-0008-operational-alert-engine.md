# ADR-0008 — The Phase 1b operational alert engine: canonical facts in, deterministic alerts out

**Status:** **ACCEPTED and IMPLEMENTED** — Phase 1b (backend read models, scan engine, scheduler, three deterministic detectors). No new table, no new migration.

**Date:** 2026-09-24 · **Decided by:** CEO (business rules — D1/D2/D3 thresholds and what stays undecided), engineering (shape).

**Builds on:** [ADR-0007](adr-0007-ai-platform-boundary.md), which is ACCEPTED and unchanged by this decision. ADR-0007 fixes the *boundary* — `/AI` is a separate bounded application, the backend stays the operational source of truth, Discovery ≠ Resolution, the alert aggregate and its Phase 1a tables. This ADR records only what Phase 1b *decided on top of it*: how the engine reads, how it scans, how it orders candidates, and which knobs deliberately have no value.

**Affects:** `backend/src/capabilities/trip-schedule/{api,application,domain,persistence}/ai-read-model.*` · `AI/src/core/detector/*` · `AI/src/detectors/*` · `AI/src/infrastructure/scheduler/*` · `AI/src/config/{duration,env.schema}.ts` · `deploy/nginx.conf` · `deploy/nginx-bo-api.conf` · the contract in [`backend/ai-internal-contracts.md`](../backend/ai-internal-contracts.md).

---

## 1. Context

ADR-0007 established the boundary and Phase 1a built the foundation: schema `ai`, its own migration runner, the alert aggregate with lifecycle, history, dedupe and `scan_runs`. Nothing scanned anything yet. Phase 1b had to make the engine run without giving the AI a second copy of the operational truth, and without a programmer quietly deciding business questions nobody had answered.

## 2. Decisions

### 2.1 The backend exposes canonical FACTS on internal read models

Three keyset-paginated lists (`unassigned-trips`, `unstarted-assignments`, `pending-completions`) and one bounded `subjects/lookup`, all under `/internal/v1/read-models/dispatch`, all behind `ServiceAuthGuard` alone.

They apply only **coarse, factual narrowing** — archived, finished, `state = 'active'`, "has a live execution event" (the backend's own `hasLiveEvents` predicate), and a technical time window the caller supplies. They never encode a threshold, a severity, a detector exclusion or an active/clear verdict. The backend says what is true; the AI decides whether that fact means an alert.

`lookup` filters **nothing at all** — archived, finished, ended and approved all come back with their state — because "the condition has cleared" must be concluded from facts received, never from an id quietly falling out of a filtered list. It takes at most 200 ids and is **refused, not truncated**, above that: a truncated answer would make a subject that exists look absent.

### 2.2 Windows carry their own bound inclusivity

A window is `before` plus an optional `after`, each with an inclusivity flag (`beforeInclusive` default `true`, `afterInclusive` default `false`, so saying nothing yields the ordinary `(after, before]`). Which side of a boundary instant matters is a statement about urgency and therefore belongs to the detector; the read model only needs to be able to express it.

The rejected alternative was nudging a bound by a millisecond. That encodes the decision as an epsilon nobody can read, in a unit the database does not share — PostgreSQL keeps microseconds and a JS `Date` does not — so the gap would be a real hole for any row landing inside it.

### 2.3 Discovery and Resolution, and what a run's outcome means

`discover` walks candidate bands and upserts positives. It **never** resolves: absence from a window proves nothing. `resolve` enumerates the detector's live alerts (`open`, `acknowledged` **and** `dismissed`), looks their subjects up **by id**, re-evaluates the same predicate, and closes only what the returned facts show to be clear.

**One predicate, not two.** A detector exposes a single `evaluate(facts, now)`, used by both phases. Two predicates drift, and the day they disagree an alert is either raised forever or closed while its condition holds.

**`scan_runs.outcome` is a verdict on VERIFICATION, not on mutation.** The run closes as `succeeded` before any alert is resolved, because `resolveBySystem` refuses a run that is still `running`; a resolution that fails afterwards does **not** downgrade it, because an alert already resolved would then appear to have been resolved by a partial scan. `alerts.resolved_scan_run_id` is the source of truth for what a run closed; `scan_runs.resolved` is an execution metric written after `finished_at` and may under-count if the process dies mid-pass.

### 2.4 Incomplete verification resolves NOTHING — not even the part it verified

A timeout, a 5xx, a body that does not match the contract, a page it could not finish, **or any requested subject the backend did not return** marks the run `partial` and the resolution pass does not run at all. Alerts whose condition genuinely had cleared stay live until a run that can account for every subject closes them.

Resolving only the verified part was considered and rejected. The dangerous case is not the deleted row; it is a silently truncated or partial answer, which makes subjects that **exist** look absent. If such a run were allowed to close what it happened to see, a degraded backend would resolve real alerts one batch at a time, quietly, and each individual run would look successful. Nothing is lost by waiting: the next complete run converges.

The rule is enforced twice — the engine stops and marks the run, and `AlertService.resolveBySystem` independently refuses any run that is not a `succeeded` resolution run of the alert's own detector. The second check is what makes the first impossible to bypass by accident.

### 2.5 Scheduling and exclusion: a timer plus an advisory lock

An in-process interval timer, not a job runner: one recurring task per detector, nothing to enqueue, retry or route, so a broker would add a service to operate in exchange for nothing. What a queue would have provided — exactly one worker — comes from `pg_try_advisory_lock(771053318, key(detectorCode, phase))` on a dedicated connection, held outside any transaction for the length of the scan and released in `finally`. `try`, not `wait`: a tick that cannot take the lock has nothing to do. A worker that dies releases the lock with its session; a connection that dies mid-scan is detected (the client carries its own `error` listener) and destroyed rather than returned to the pool.

This is deliberately **not** "we only run one container". Two replicas during a rolling deploy is the normal case; the guarantee is a property of the database, not of the topology.

### 2.6 Candidate bands: scan ORDERING is not policy

Discovery stops after 100 pages and reports `partial` rather than claiming a complete scan. With a single ascending walk that cap was a **liveness bug**, not merely a slow path: overdue trips accumulate at the head of the order, so a large enough backlog consumed the whole budget every run and a trip leaving in ninety minutes was never evaluated — the alert that matters most would be the one that never fires.

A detector therefore returns candidate **bands** in priority order, and Discovery walks them under one shared budget:

| D1 band | range | order |
|---|---|---|
| `approaching` | `[now, now + lead]` | first |
| `overdue` | `(-∞, now)` | second |

The cut at `now` is **closed on the approaching side**: a pickup due this very instant is the most urgent candidate the detector can see, and leaving it at the head of the overdue backlog would starve exactly the case the ordering exists to protect. The bands partition the line exactly — every pickup in one, none in both, nothing between.

The predicate is unchanged, overdue trips remain candidates for ever, and **no retention window or cutoff is invented**. A band left unwalked because the budget ran out is reported as `partial`, naming the band.

### 2.7 Detector configuration, and what deliberately has no value

Thresholds and severity bands are configuration injected into detectors, never constants inside them.

**Approved (CEO, 2026-09-19):**

| Detector | Anchor | Approved |
|---|---|---|
| **D1** Unassigned Trip Approaching Execution | `pickup_at` — no `scheduled_on` fallback, because a calendar day is not an instant | warning lead **2 h**; a pickup already past **stays `warning`** |
| **D2** Stale Assignment Start | `pickup_at`, not `assigned_at` | a `pending` or `approved` completion **excludes**; a `rejected` one **does not** — the work is still outstanding |
| **D3** Completion Review Overdue | `submitted_at` | warning after **12 h** |

**Undecided, and therefore without a default.** Phase 1b makes each absence explicit rather than guessing:

| Absent | Behaviour |
|---|---|
| any detector's HIGH band | the detector emits `warning` and never `high` |
| **D2's grace** | **the detector is DISABLED**, and says so at boot — a zero grace would alert on every assignment the moment its pickup passed, which is a business decision nobody took |
| `SCAN_INTERVAL` | the scheduler does not arm; the Alert API still serves |
| the backend URL or the AI→backend token | the scheduler does not arm |

Still open at the close of Phase 1b: **D2 grace · D1/D2/D3 HIGH bands · the production scan interval · the proposed 30 s initial delay** (proposed, *not* approved).

### 2.8 Durations: unit required, empty means unset, and one technical floor

Durations are written with a unit (`2h`, `30m`) and parsed at boot; a bare number is ambiguous by a factor of a thousand and is refused.

An **empty or whitespace-only** value is read as **absent**, not as malformed. A compose file written `SCAN_INTERVAL: ${SCAN_INTERVAL}` renders the empty string when the host variable is not exported, and refusing to boot on it would take the Alert API — which has nothing to do with scanning — down with it. A value that is present but is not a duration is still a boot error: nothing malformed is normalised away.

`SCAN_INTERVAL` additionally has a floor of **1 s** (`MIN_SCAN_INTERVAL_MS`). One tick is three detectors times two phases, each taking the advisory lock and making backend requests bounded by `BACKEND_TIMEOUT`, so an interval below a second issues ticks faster than a single round trip can finish and the scheduler degenerates into the hot loop the unit requirement exists to prevent.

★ **This floor is a guard rail, not a cadence.** It says what is not a scan interval at all; it does not say how often to scan. **The operational scan cadence remains undecided and has no default anywhere in the codebase.**

### 2.9 The internal namespace is refused by the edge, in any case

`/internal/v1/*` is what the backend and the AI Platform say to each other over the compose network. On every public host it must be unreachable *before* authentication is consulted — the service token is the second line, not the first.

nginx prefix matching is case-**sensitive**, so `location ^~ /api/internal/` alone let `/api/Internal/v1/...` fall through to the general `/api/` proxy, whose trailing `proxy_pass .../` strips `/api/` and hands `/Internal/v1/...` to Express, which matches routes case-**insensitively** by default. Both public configs therefore also carry `location ~* ^/api/internal(/|$)`, which beats a plain prefix location in nginx's matching order; `(/|$)` refuses the bare `/api/internal` without catching a public path that merely starts with those letters.

Because that argument is about nginx's matching order, it is verified by making requests rather than by reading the config: `.github/scripts/check-nginx-internal-block.sh` runs the real deploy configs in a container behind a stand-in upstream that echoes the path it was handed.

## 3. Consequences

- Phase 1b adds **no** table and **no** migration. The alert tables, including `ai.alert_scan_observations`, all came with Phase 1a; the scan engine writes only through that existing aggregate.
- The backend's read models are a new public-facing surface only in the compose sense: three GET lists and one POST lookup that no human path reaches, asserted by test.
- A degraded backend now makes resolution *slower*, never *wrong*: alerts accumulate until a complete verification happens, rather than being closed piecemeal.
- Two detectors of three are fully armed. D2 ships disabled and stays disabled until a grace period is approved — a decision, not an omission.
- The 1 s floor closes the hot-loop misconfiguration without answering the cadence question, which remains with the CEO.

## 4. Alternatives rejected

| Alternative | Why not |
|---|---|
| Resolve the subjects a partial lookup *did* return | A truncated answer makes existing subjects look absent; real alerts would be closed quietly, one batch at a time, on runs that each looked successful |
| A second "is it clear" predicate for Resolution | Two predicates drift; the day they disagree an alert is raised forever or closed while its condition holds |
| A business cutoff on the overdue band (24 h lookback, retention window) | Nobody approved one; the liveness problem is solved by ORDER, and inventing a cutoff would silently drop real alerts |
| Nudging a band bound by 1 ms instead of declaring inclusivity | Encodes the decision as an unreadable epsilon, in a unit PostgreSQL and JS do not share |
| A queue or broker for scan scheduling | Adds a service to operate; the advisory lock already gives exactly-one-worker across replicas |
| Defaulting `SCAN_INTERVAL` to something reasonable | That is a business decision taken by a programmer. Unset means unarmed, and it says so at boot |
| Relying on `ServiceAuthGuard` alone for `/api/internal` | The ADR-0007 invariant is that the network refuses those paths first; authentication is depth, not the boundary |
