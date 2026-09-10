# ADR-0004 — Dispatch assignment: one trip, N lorries, each with its own driver

**Status:** **ACCEPTED and IMPLEMENTED** — migrations `0027`–`0029`; `0030` (VALIDATE)
is written into the deploy notes and runs only after the production audit says it may.

**Date:** 2026-09-10 · **Decided by:** CEO (business), engineering (shape)

**Affects:** `trip_driver_assignments` · `trip_completion_requests` · every read and
write in `capabilities/trip-schedule/` that used to say *"the trip's driver"* or *"the
trip's vehicle"* · the Driver Portal routes · the dispatch board, the review queue and the
driver screens in the frontend · the frontend integration contract.

> ⚠ This ADR **supersedes** the *1 Trip = 1 Vehicle + 1 Driver* model recorded in
> [`../domains/driver-portal/contract.md`](../domains/driver-portal/contract.md) §4.1,
> §4.2, §9.6 and [`../domains/driver-portal/design.md`](../domains/driver-portal/design.md)
> §0.8.1 / §0.8.3. Those sections carry a banner pointing here. Everything else in those
> documents stands.

---

## 1. Problem

Operations dispatches one booking with **two or more lorries** — a load that does not fit
one truck, or a customer that asks for a convoy. The system said a trip *is* one vehicle
and *has* one active driver:

- `trip_schedules.vehicle_id` was the lorry.
- `trip_driver_assignments` allowed **one active row per trip** (`uq_trip_active_driver_assignment`).
- Execution events, expenses and the completion request were scoped to the **trip**, so
  the second lorry's arrival, fuel and "I am done" had nowhere to go.

Modelling it as two trips breaks what the customer sees (one booking, one price, one
invoice) and what dispatch reads (one row on the board).

## 2. Decision

**A trip carries 0..N dispatch assignments. An assignment is one lorry AND one driver,
always together.** The assignment — not the trip — is what a driver executes, spends
against and asks to close.

```text
Trip ─┬─ Assignment (vehicle A, driver X)  ← its own events, expenses, completion request
      ├─ Assignment (vehicle B, driver X)  ← the same driver may hold a second lorry
      └─ Assignment (vehicle C, driver Y)
```

No new table. `trip_driver_assignments` gains `vehicle_id`; the existing history columns
(`state`, `ended_at`, `ended_by`, `end_reason`) keep doing what they did.

### 2.1 Rules — all locked

| # | Rule | Enforced by |
|---|---|---|
| R-1 | An **active** assignment must name a lorry | CHECK `trip_driver_assignments_active_has_vehicle` (`NOT VALID` until `0030`) + application |
| R-2 | A lorry is on a trip **at most once** while active | `uq_trip_active_vehicle_assignment (trip_id, vehicle_id) WHERE state='active'` |
| R-3 | The **same driver may hold several lorries** on one trip | *deliberately nothing* — there is **no** `UNIQUE(trip_id, driver_user_id)` and there must never be one |
| R-4 | A trip may have **zero** assignments; dispatch happens after booking | no constraint; the create form has no lorry field |
| R-5 | Before an assignment **starts**, Operations may replace its driver or end it | application: `requireNotStarted` → 409 once a live event exists |
| R-6 | Once started, lorry and driver are **immutable** — no takeover, no lineage, no evidence transfer | application refuses; there is no endpoint that could |
| R-7 | *Started* = **at least one non-voided execution event** on the assignment | `hasLiveEvents(assignmentId)`; no `started_at`, no `execution_state` column |
| R-8 | Events, expenses and completion requests belong to the **assignment** | composite FK `(driver_assignment_id, trip_id)` already present; per-assignment unique indexes on completion |
| R-9 | One pending and one approved completion request **per assignment**; attempts numbered per assignment | `uq_assignment_completion_pending/approved/attempt` |
| R-10 | The trip is **finished** when every ACTIVE assignment's request is approved — evaluated inside the approve transaction, stored explicitly (status, history, `closed_at/by`), never derived at read time | `TripCompletionService.approve` → `hasUnapprovedActiveAssignment` → `finishTrip` |
| R-11 | An assignment ended **before** it started does not block finishing | R-10 counts ACTIVE rows only |
| R-12 | Decision notifications go to **the submitter of that request**, not "the trip's driver" | `request.submitted_by` |
| R-13 | Driver routes are addressed by **assignment id** only; a driver never names a trip | `/driver/assignments/:assignmentId/...`; `ActiveAssignmentGuard` compares `driver_user_id` |
| R-14 | `trip_schedules.vehicle_id` is **legacy**: never written again, never dropped | application; architecture test `trip-write-paths.spec.ts` |

### 2.2 What was rejected, and why

| Option | Why not |
|---|---|
| A second table `dispatch_assignments` | It would be `trip_driver_assignments` with one extra column. Two tables for one fact is two sources of truth |
| `UNIQUE(trip_id, driver_user_id)` "for safety" | It forbids the case the CEO asked for. R-3 is the business, not an accident |
| Vehicle-only assignment, driver filled in later | Every execution row snapshots `vehicle_id` from the assignment and is written by a driver. Half a pair has nobody to execute it |
| Mid-execution driver replacement with evidence/completion transfer | Reassigning a started turn makes "who was driving when" a computed answer. The audit question must stay a stored fact (contract §4.2) |
| Deriving *Trip finished* from the requests at read time | Two readers with two clocks disagree; the finish must be one decision, once, in one transaction |
| `started_at` on the assignment | A second copy of a fact the events already hold, which can drift from them |
| TripLeg / segment / multi-stop / route planning / live GPS / driver pool / co-driver | Out of scope, and none of them is needed to dispatch three lorries on one booking |

### 2.3 Read-model grains — decided 2026-09-10

| Read model | Grain | Route / source |
|---|---|---|
| Dispatch list (the board Operations edits) | **one row per trip**, crew folded into `assignments[]` | `GET /trip-schedules` |
| **Operational board** (execution, delays, review state) | **one row per ACTIVE dispatch assignment** | `GET /trip-schedules/operational-board` |
| Completion review queue | one row per outstanding request (= per assignment) | `GET /trip-schedules/completion-review-queue` |
| Trip detail, history, costs | trip | `GET /trip-schedules/:tripId/...` |

Operations manages execution at the assignment level: at 10:00 two lorries may leave
for the same 12:00 delivery, and each must be observable, filterable and actionable on
its own. So the operational board is **assignment-grain by decision, not by accident**,
and is never aggregated back to the trip. A trip with nobody dispatched still yields one
row with `assignmentId: null`, because "no lorry on it" is itself a finding.

Each board row repeats the trip context it needs to stand alone — `tripId`,
`scheduledOn`, `customer`, planned pickup and delivery times — as **context, not
ownership**; the trip stays canonical for those fields. The route keeps its name for this
release: it has no frontend consumer yet, and a rename (`/dispatch-board`) can happen when
one arrives without breaking anything. The frontend dispatch board stays trip-centric on
`GET /trip-schedules`; the two grains coexist and the hierarchy is unchanged:

```text
Trip (aggregate / detail grain)
 ├── Assignment A — vehicle, driver, events, expenses, completion   ← board row
 └── Assignment B — vehicle, driver, events, expenses, completion   ← board row
```

## 3. Schema (0027–0030)

| Migration | Does | Reversible? |
|---|---|---|
| `0027_dispatch_assignment_vehicle.sql` | `ADD COLUMN vehicle_id UUID REFERENCES trip_vehicles(id)` · drop `uq_trip_active_driver_assignment` · create `uq_trip_active_vehicle_assignment` · CHECK `active_has_vehicle` **NOT VALID** · `idx_trip_driver_assignment_vehicle` | forward-only, idempotent |
| `0028_completion_per_assignment.sql` | audit first (raises on >1 pending/approved per assignment, duplicate `(assignment, attempt_no)`) · drop trip-scoped completion uniques · create assignment-scoped ones · `idx_trip_completion_trip_attempt (trip_id, attempt_no DESC)` · keeps `idx_trip_completion_assignment` | forward-only, idempotent |
| `0029_backfill_assignment_vehicle.sql` | Case A: active rows ← `trip_schedules.vehicle_id` · Case C: ended rows ← the single distinct `vehicle_id` on their events · Case D: ← the single distinct one on their costs · reports B/E/F counts · raises on duplicate active `(trip, vehicle)` | idempotent; touches only `vehicle_id IS NULL` |
| `0030` *(not committed)* | `VALIDATE CONSTRAINT trip_driver_assignments_active_has_vehicle` | **only after** the production audit shows Case B = 0 — see `deploy/README.md` |

Case B = an ACTIVE assignment whose trip has no legacy `vehicle_id`. The CHECK is `NOT
VALID` precisely so that `0027` cannot fail on such a row; it applies to every new write
immediately and to old rows once validated.

## 4. API — what changed

| Was | Is |
|---|---|
| `POST /trip-schedules` body `{ vehicleId, … }` | no `vehicleId` (a stray one is rejected by the strict schema) |
| `POST /trip-schedules/:tripId/driver-assignments` `{ driverUserId }` | `{ vehicleId, driverUserId }` — 409 if the lorry is already on the trip |
| `POST …/driver-assignments/replace` · `…/end` | `…/driver-assignments/:assignmentId/replace` · `…/:assignmentId/end` — 409 once started |
| `POST /trip-schedules/:tripId/completion/approve` · `…/reject` | `…/completion-requests/:requestId/approve` · `…/reject` |
| `GET /driver/trips` · `GET /driver/trips/:tripId` · writes under it | `GET /driver/assignments` · `GET /driver/assignments/:assignmentId` · writes under **that** |
| `TripScheduleWithRefs.vehicle`, `.driver` | `.assignments[] { id, vehicle, driver, assignedAt, started }`; `.vehicleId` kept, `@deprecated` |
| Operational board / review queue: one row per trip | one row per **active assignment**, with `assignmentId` and `completionRequestId` |

Idempotency keys are unchanged: `(trip_id, client_event_id)` on events, and the frontend
still sends `clientEventId = ${assignmentId}:${type}` — which was already assignment-shaped.

## 5. Frontend

- **Dispatch panel** (`pages/trip/components/DispatchPanel.tsx`) replaces the driver
  modal: active pairs, *Đổi tài xế* / *Gỡ* hidden once `started`, *Thêm phương tiện*
  requires lorry **and** driver, ended turns listed with their reasons. Built from the
  existing `Modal`, `Button` and native `<select>` — no new dependency.
- **Board row**: one line per plate, drivers named once, `N xe · M tài xế` when N > 1; a
  legacy planned lorry with no pair is labelled as such.
- **Trip form**: no lorry field.
- **Export**: still one row per trip; plates and drivers joined with `;`.
- **Review**: rows keyed by assignment; the modal filters the trip's evidence to that
  assignment and decides *that* request.
- **Driver**: list grouped by trip with one link per lorry; detail, expenses and
  completion addressed by assignment; expense drafts keyed by assignment.

## 6. Consequences

- A driver holding two lorries has two screens, two timelines, two expense sets and two
  completion requests. That is the model, not a UI limitation.
- Notification signals still name a trip. The driver cache is keyed by assignment with the
  list key as prefix, so one invalidation covers both; the deep link goes to the list.
- The legacy `vehicle_id` lingers on old rows and is shown on the board as *planned
  vehicle (legacy)* until Operations dispatches the trip as a pair. It is never used for
  a write and never dropped.
- `trip_driver_assignments` still has no `UNIQUE(trip_id, driver_user_id)`, and the
  architecture test fails the build if any migration adds one.

## 7. What shipped

| | |
|---|---|
| Schema | `backend/migrations/0027…0029` · schema + integration specs under `backend/tests/migrations/` |
| Domain / persistence / application / API | `backend/src/capabilities/trip-schedule/**` — assignment-scoped execution, cost, completion, driver read model, board |
| Guard + routes | `api/active-assignment.guard.ts` · `api/driver-portal.controller.ts` · `api/trip-schedule.controller.ts` · `api/trip-completion.controller.ts` |
| Frontend | `DispatchPanel.tsx` · `TripSchedulePage.tsx` · `TripFormModal.tsx` · `CompletionReviewPage.tsx` / `CompletionReviewModal.tsx` · `DriverTripsPage.tsx` / `DriverTripPage.tsx` · hooks under `hooks/trip/` and `hooks/driver/` |
| Tests | unit + security + architecture (`trip-write-paths.spec.ts`) · integration: lifecycle, schedule, cost, location, driver-account · frontend: dispatch, review, driver workflow, export |
| Docs | this ADR · banners in the driver-portal contract and design · decision ledger entries · integration contract · capability README · deploy notes |
