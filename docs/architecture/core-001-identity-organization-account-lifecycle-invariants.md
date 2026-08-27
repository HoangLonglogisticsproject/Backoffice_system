# CORE-001 — Identity, Organization & Account Lifecycle Invariants

**Status:** **FROZEN** — documentation only. Describes what the code already does; changes nothing.

**Date:** 2026-08-26
**Affects:** `core/identity`, `core/organization`, `core/authorization`, `core/users`, `capabilities/account-invitation`, `capabilities/membership-approval`
**Schema changes:** **none.** No migration, no table, no trigger accompanies this document.

> Every claim below was verified against source and against a real PostgreSQL run:
> **41 suites / 763 tests, zero skipped**, `DATABASE_URL_TEST` pointed at a disposable
> database. Where an invariant is enforced by a test rather than by a constraint, the test
> is named.

---

## 1. Purpose

To write down the invariants that the identity, organization, authorization and account
lifecycle code already holds — so that a future change that would break one is recognised
as breaking something, rather than discovered later as data that should not exist.

This is a **freeze document**. It is not a design proposal, and it does not ask for new
enforcement. An invariant enforced by an application service with a transaction around it
is enforced. "Application-enforced" is not a euphemism for "unprotected", and this document
deliberately does not recommend converting such invariants into constraints.

## 2. Scope

**In scope:** `users`, `identities`, `departments`, `department_memberships`,
`role_assignments`, `sessions`, and the services that write them.

**Out of scope:** anything a screen calls a feature. In particular **Employee Management is
a business capability, not a database aggregate** — see §11.

## 3. Canonical identity model

| Concept | Source of truth |
|---|---|
| Employee identity (the person) | `users.id` |
| Authentication identity (how they sign in) | `identities` (`provider`, `subject`) |
| Where they work | `department_memberships` |
| Elevated authority | `role_assignments` |
| Account operability | `users.status` |

`users.id` is the canonical person identity for the whole system and does not change for
any lifecycle event — not offboarding, not transfer, not a future rehire.

`identities` is **authentication**, not a second employee record. One person has one
`users` row; their credential lives beside it, never in place of it.

## 4. Membership lifecycle

A membership is opened, and later ended. It is never deleted and never reopened.

```
enroll    → INSERT department_memberships (status='active')
transfer  → UPDATE old SET status='ended', ended_at=now()   ┐ one transaction
            INSERT new (status='active')                    ┘ same users.id
offboard  → UPDATE active SET status='ended', ended_at=now()
```

`created_at` is the join date (`joinedAt`); `ended_at` is set exactly when `status='ended'`,
and the database holds the pair together.

## 5. Role / membership relationship

`role_assignments` stores **SUPERADMIN** and **DEPARTMENT_HEAD** only. `MEMBER` is the
**absence** of an active `DEPARTMENT_HEAD` assignment — it is not a row and must never
become one.

A head assignment names the exact membership that entitles it (`membership_id`), so a role
is scoped to **one employment period**. A head assignment from an earlier, ended membership
can never apply to a new one.

## 6. Employee offboarding

One transaction, five writes, in a **forced** order:

1. refuse if the target is the last active SUPERADMIN
2. revoke all active role assignments
3. `users.status` → `disabled`
4. revoke every session
5. end the active membership

Step 2 must precede step 5: an active head assignment is held to an active membership by a
composite foreign key, so ending the membership first violates it and the transaction rolls
back. The order is a database consequence, not a style choice.

Nothing is deleted. The person, their credential, and every past membership remain.

## 7. Account lifecycle

`users.status` (`active | disabled`) is **account operability** — may this account be used.

It is a different question from membership status (`active | ended`), which is **employment
in a unit**. The two move together during offboarding but are not derived from one another,
and the combination `disabled` + `active` is representable on purpose.

Authorization re-reads `users.status` on **every request**, so disabling takes effect
immediately rather than when a session happens to expire.

## 8. Invitation lifecycle

A head proposes an address; an administrator approves; approval provisions the account.

Approval is one transaction that locks the invitation, re-reads the world (department still
active, requester still head, address still unused), provisions person + credential +
membership, and closes the invitation. Any failure leaves the invitation **pending**, never
half-done.

Nobody may decide their own request — enforced in the service *and* by a CHECK constraint.

## 9. Concurrency invariants

| Race | Serialised by |
|---|---|
| two enrollments / transfers of one person | `uq_single_active_membership` + `SELECT … FOR UPDATE` on the membership |
| two disables of one account | membership row lock + `expectedCurrent` guard |
| two approvals of one invitation | `lockPending` + optimistic `decide` + unique identity index |
| **archive × inbound membership** | **department row lock (`lockById`) taken by all four paths** |

The last one is **V12**, fixed 2026-08-26. `archive` locks the department row; before the
fix the three inbound paths read it with `findById`, which takes no lock, so they never
contended and an active membership could land in a department archived a moment earlier.
Measured on real PostgreSQL with the lock removed: **9 of 10 contended attempts produced the
invalid state.** With the lock, 0.

**All four paths must take the department row lock, inside the transaction that writes:**
`DepartmentService.archive`, `MembershipService.enroll`, `MembershipService.transfer`,
`AccountInvitationService.approve`.

## 10. Historical data rules

- Memberships are **ended**, never deleted.
- Departments are **archived**, never deleted.
- Role assignments are **revoked**, never deleted — with full grant/revoke provenance.
- Accounts are **disabled**, never deleted.
- One person legitimately has **many** membership rows over time. That is history, not
  duplication. A roster row is identified by the **membership** id; the person is `user.id`.

## 11. Explicit DO NOT rules

1. **Do not create** `employees`, `staff`, `employee_accounts`, `employee_profiles`, or
   `positions`. Every field such a table would hold already exists and is derivable by join.
   A copy is a second source of truth that disagrees with the first at the next transfer.
2. **Do not create a `MEMBER` role assignment.** The CHECK constraint forbids the value, and
   the absence that currently carries the meaning would stop being unambiguous.
3. **Do not merge** `users.status` and `department_memberships.status` into one field, and do
   not derive either from the other.
4. **Do not delete** a user, identity, membership, or role assignment. Boundary rule B13
   forbids `DELETE` in runtime code and is checked in CI.
5. **Do not reactivate** an ended membership (see §12).
6. **Do not join a head assignment on `(user_id, department_id)`** — use `membership_id`, or
   a role from an earlier employment period will attach to a new one.
7. **Do not read a department without the row lock** on any path that creates a membership.
8. **Do not reorder** offboarding's five steps.
9. **Do not treat a roster as an approval queue.** "Who works here" and "what awaits a
   decision" are different questions that share a screen, not a meaning.
10. **Do not aggregate Employee Management into one service or table** because the UI names
    it as one thing. The capability spans identity, organization, authorization and account
    lifecycle, and those boundaries stay where they are.

## 12. Future rehire rule

Rehire is **not implemented** and must not be improvised. Today `PATCH /users/:userId/status`
accepts only `disabled`, and no route re-enables an account or enrolls an existing person.

> An ended membership represents a **historical employment period** and **MUST NOT** be
> reactivated to represent a new one.

A future rehire MUST preserve:

- the **same `users.id`** — one person, one identity, forever
- the **same authentication identity** — the address stays theirs
- **all previous membership history**, untouched
- a **new `membership.id`** for the new employment period

and must answer, deliberately, before any code is written: how the account is restored, what
role assignments (if any) carry over, and what the audit trail records. None of those answers
may be inferred from the existing offboarding flow, because offboarding is one-way by design.

---

## Invariant register

Status legend: **DB** database-enforced · **TX** transaction-enforced · **APP**
application-enforced · **TEST** test-verified · **PARTIAL** · **UNKNOWN**

### Identity

| # | Invariant | Status | Evidence | Risk if removed |
|---|---|---|---|---|
| 1 | `users.id` is the canonical person identity | APP + TEST | `account-provisioning.service.ts`; `membership.service.ts` transfer reuses the id; `membership.roster.spec.ts` "keeps one identity across an ended and an active membership" | CRITICAL |
| 2 | `identities` is authentication, not an employee record | DB + APP | `0001_identity.sql:37` FK to `users`; `common/types/user-summary.ts` | HIGH |
| 3 | Canonical email uniqueness blocks duplicate identity | DB + TEST | `0010`: `canonical_identity()`, `uq_local_identity_subject_canonical`, `identities_local_subject_canonical`; `canonical-identity.integration.spec.ts` | CRITICAL |
| 4 | No employee/staff/employee_accounts table | DB | `migrations/0001–0010`; no such table exists | HIGH |
| 5 | No hard-delete employee lifecycle | DB + APP | FKs `NO ACTION`; boundary rule **B13 runtime ↛ DELETE** in `scripts/check-boundaries.sh` | CRITICAL |

### Organization

| # | Invariant | Status | Evidence | Risk if removed |
|---|---|---|---|---|
| 6 | At most one active membership per user | **DB** + TEST | `uq_single_active_membership` (`0003_organization.sql:93`); `organization.integration.spec.ts` "rejects a second active membership", "serialises two concurrent enrollments" | CRITICAL |
| 7 | Membership history is retained | DB + TEST | `status`/`ended_at` CHECK (`0003:83`); "keeps the ended row readable — history is never deleted" | CRITICAL |
| 8 | Ended membership never reused for a new period | APP | No `UPDATE … SET status='active'` exists anywhere; `transfer` always INSERTs | HIGH |
| 9 | Transfer = end + insert, same `users.id`, one transaction | TX + TEST | `membership.service.ts` `transfer`; "rolls back the ended membership if the transaction fails after it" | CRITICAL |
| 10 | Archived department accepts no new active membership | APP + TEST | status check in `enroll`, `transfer`, `approve`; "refuses to enroll into, or transfer into, an archived unit" | HIGH |
| 11 | Archive and inbound mutations serialise on the department row | **TX + TEST** | `lockById` in all four paths; "never enrolls/transfers into a unit being archived concurrently", "holds the invariant under repeated contention" | HIGH |
| 12 | V12 protected across archive, enroll, transfer, approval | TX + TEST | as #11, plus `account-invitation.race.spec.ts` (4 unit tests) and `membership.service.spec.ts` (6) | HIGH |

### Authorization

| # | Invariant | Status | Evidence | Risk if removed |
|---|---|---|---|---|
| 13 | Role assignment binds to `membership_id` | **DB** | `0004_authorization.sql:53`; composite FK `role_assignments_head_membership_matches` | CRITICAL |
| 14 | DEPARTMENT_HEAD valid only while membership is active | **DB** | generated `requires_membership_status` + composite FK (`0004:93`) | CRITICAL |
| 15 | MEMBER is not a database role row | **DB** | `CHECK (role_key IN ('SUPERADMIN','DEPARTMENT_HEAD'))` (`0004:58`) | HIGH |
| 16 | MEMBER = absence of active head assignment | APP + TEST | `membership.repository.ts` `ROSTER_SELECT` LEFT JOIN; `membership.roster.spec.ts` "reads no head assignment as MEMBER" | HIGH |
| 17 | A historical role never applies to a new membership | **DB** + TEST | join is on `ra.membership_id = m.id`, not `(user, department)`; roster spec pins the SQL | HIGH |
| 18 | SUPERADMIN is global | **DB** | `role_assignments_role_scope_agree` CHECK (`0004:102`) | HIGH |
| 19 | Last active SUPERADMIN cannot be disabled or revoked | APP + TX + TEST | `account-lifecycle.service.ts:60-69` (re-read inside tx); `revokeAssignment` invariant #7; "refuses to disable the only SuperAdmin, changing nothing" | CRITICAL |
| 20 | Disabled account gets no active role via any write path | APP | `assignDepartmentHead` requires an active membership, which a disabled user cannot hold; membership row lock serialises. **Transitive, not direct** — see UNKNOWN-1 | MEDIUM |

### Account lifecycle

| # | Invariant | Status | Evidence | Risk if removed |
|---|---|---|---|---|
| 21 | Offboarding does not delete employee identity | APP + TEST | `account-lifecycle.service.ts` `disable`; "retains the person row, the credential and the membership history" | CRITICAL |
| 22 | Offboarding does not delete historical membership | APP + TEST | same test | CRITICAL |
| 23 | Offboarding revokes active roles | TX + TEST | `disable` step 1; "lands all five writes together" | CRITICAL |
| 24 | Offboarding disables the account | TX + TEST | step 2, with `expectedCurrent: 'active'` | CRITICAL |
| 25 | Offboarding revokes sessions | TX + TEST | step 3, executor-scoped | CRITICAL |
| 26 | Offboarding ends the active membership | TX + TEST | step 4 under `lockActiveForUser` | CRITICAL |
| 27 | Roles revoked **before** membership ends | **DB** + APP | composite FK forbids the reverse; comment "Roles first — invariant #6 rejects step 4 otherwise" | CRITICAL |
| 28 | Disable is transactional | TX + TEST | `tx ? run(tx) : db.transaction(run)`; "lets exactly one of two concurrent disables win" | CRITICAL |
| 29 | Session authorization re-checks `users.status` | APP + TEST | `session.service.ts:86`; `session.service.spec.ts:103` "returns null when the user was disabled after logging in" | CRITICAL |

### Invitation / approval

| # | Invariant | Status | Evidence | Risk if removed |
|---|---|---|---|---|
| 30 | Approval has concurrency protection | TX + TEST | `lockPending` + `decide` guard; `account-invitation.integration.spec.ts:512` | HIGH |
| 31 | Concurrent acceptance provisions exactly once | DB + TX + TEST | same, plus unique identity index; "lets exactly one of two concurrent approvals create the account" | CRITICAL |
| 32 | Duplicate identity blocked by DB and application | **DB** + APP | `subjectExists` pre-check inside tx; `identities_provider_subject_key` + canonical index | CRITICAL |
| 33 | Nobody decides their own request | **DB** + APP | `CHECK (decided_by IS NULL OR decided_by <> requested_by)` — `0006:62`, `0007:44` | HIGH |
| 34 | Approval-driven offboarding uses the same lifecycle | TX | `membership-request.service.ts:180` calls `AccountLifecycleService.disable` with its own `tx` | CRITICAL |

**All 34 invariants hold.** None is UNKNOWN; one (#20) is transitive and carries a test gap
recorded below.

## Known gaps (recorded, not fixed)

**UNKNOWN-1 — #20 is transitive.** A disabled account is kept role-free because it cannot
hold an active membership, not because any code checks `users.status` when granting. If the
membership requirement is ever relaxed, nothing fails. *Suggested:* one direct test per
grant path. Not a defect today.

**UNKNOWN-2 — `transferSuperAdmin` is unreachable.** It grants SUPERADMIN with no membership
and **no account-status check**, and has no HTTP route and no CLI caller. Harmless while dead;
add a `users.status = 'active'` check on the target before exposing it.

**UNKNOWN-3 — global roster pagination index.** `idx_membership_dept_page` leads with
`department_id`, so a global keyset ordered by `(created_at, id)` cannot use it. Performance
only; correctness unaffected. A separate performance migration if it ever measures.
