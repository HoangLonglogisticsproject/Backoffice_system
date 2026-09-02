> # ⚠ HISTORICAL — POINT-IN-TIME AUDIT
>
> **Đây là ảnh chụp tại một thời điểm, KHÔNG phải living architecture và KHÔNG phải
> source of truth.**
>
> Nội dung giữ nguyên, không sửa. Nó ghi lại tình trạng tại thời điểm audit được
> thực hiện — hệ thống đã thay đổi từ đó.
>
> Tài liệu kiến trúc đang có hiệu lực: [`../README.md`](../README.md).
>
> ---

# SonarCloud Accepted Findings — Production Database & Backend Audit

**Branch:** `feat/sonar-db-production-audit`
**Base:** `main` @ `fdaf813`
**Date:** 2026-08-19
**Scope:** backend + database only. No frontend file was read or modified.
**Skills used:** `senior-data-engineer` (database review), `senior-backend` (backend review)

---

## 1. Executive summary

Seven findings sit at ACCEPTED on SonarCloud. Six are `S1192` (duplicated string
literal) inside SQL DDL; one is `S7682` (missing explicit return) in a shell
script.

**All seven Accepted decisions are correct, and this audit did not change any of
them.** The evidence is in §4: every literal Sonar counts as "duplication" is a
*distinct enforcement mechanism* — a CHECK constraint, a partial index predicate,
a foreign key's referenced value — and the refactor Sonar's rule implies (extract
to a shared symbol, i.e. ENUM/DOMAIN) was measured to be actively harmful. It
cannot be completed at all without dropping the foreign key that enforces the
system's central authorization invariant, and it does not complete even then.

**But auditing around those findings surfaced one real production issue that
Sonar never reported**, and this branch fixes it.

The composite foreign key in `0004_authorization.sql` puts
`department_memberships.status` *inside* the referenced key. That is what makes
the invariant enforceable — and it also means PostgreSQL must run a referential
integrity check on `role_assignments` every time a membership's status changes.
That check looks up by `membership_id`, and **no index led with that column**, so
every transfer and every offboarding sequentially scanned the entire assignment
table. `role_assignments` only ever grows: revoked rows are kept as audit
history. The cost of ending a membership was therefore rising with the age of the
deployment.

Measured on PostgreSQL 17 with 1,000,000 users and 3,000,000 memberships:

| `role_assignments` rows | FK trigger time | Plan |
|---|---|---|
| 6,001 | 0.4 ms | Seq Scan |
| 106,001 | **7.1 ms** | Seq Scan |
| 106,001 **+ `0008`** | **0.2 ms** | Index Scan |

`0008_role_assignment_membership_fk_index.sql` adds one partial index. It is
additive only — no column, type, constraint or default changes — takes `ShareLock`
for 12 ms on a populated table, and is 67× smaller than the naive full index
(48 kB vs 3208 kB) because it covers only the rows the foreign key can ever
reference.

### Decisions

| # | Finding | File | Decision | Production risk |
|---|---|---|---|---|
| 1 | `'active'` duplicated | `0003_organization.sql` | **KEEP** | None |
| 2 | `'SUPERADMIN'` duplicated | `0004_authorization.sql` | **KEEP** | None |
| 3 | `'DEPARTMENT_HEAD'` duplicated | `0004_authorization.sql` | **KEEP** | None |
| 4 | `'active'` duplicated | `0004_authorization.sql` | **KEEP** | None |
| 5 | `'pending'` duplicated | `0006_membership_change_requests.sql` | **KEEP** | None |
| 6 | `'pending'` duplicated | `0007_account_invitations.sql` | **KEEP** | None |
| 7 | `fatal()` explicit return | `backend/scripts/sonar-findings.sh` | **KEEP** | None |
| — | *(not a Sonar finding)* missing FK index | `0004` → fixed by `0008` | **FIX NOW** | **Medium**, growing |
| — | *(not a Sonar finding)* no pagination on list endpoints | backend API | **FIX LATER** | Low today |

SonarCloud will still show 7 Accepted Issues after this branch. That is the
correct outcome, and §15 explains why chasing zero would have been the wrong
goal.

---

## 2. Method

1. `main` verified clean at `fdaf813`, `git fetch --prune`, branch created.
2. Both skills loaded and applied as independent passes (§3 database, §9 backend).
3. A scratch database was built on the project's own PostgreSQL 17 container and
   seeded to production scale: **1,000 departments, 1,000,000 users, 1,000,000
   identities, 3,000,000 memberships (950,000 active), 106,001 role assignments,
   200,500 membership change requests, 200,300 account invitations** — 1.2 GB.
4. Every hot path was measured with `EXPLAIN (ANALYZE, BUFFERS)`.
5. Every alternative to the flagged literals was *executed*, not reasoned about.
6. Both migration paths were run against real PostgreSQL.

No claim below rests on inspection alone. Where a number appears, a server
produced it.

---

# DATABASE REVIEW

*(senior-data-engineer pass)*

## 3. Schema map — literal → constraint → index → query → endpoint

The six `S1192` findings are all instances of one pattern, so the pattern is
worth stating once. A status literal in this schema is never a copy of another
literal. Each occurrence installs a *different* mechanism:

### `department_memberships.status = 'active'` (findings 1 and 4)

| Occurrence | Mechanism | What it enforces | What breaks without it |
|---|---|---|---|
| `CHECK (status IN ('active','ended'))` | domain restriction | no third value exists | typos become data |
| `uq_single_active_membership ... WHERE status = 'active'` | partial unique index | ★ one active membership per user | a person in two units at once |
| `idx_membership_department_active ... WHERE status = 'active'` | partial index | department member lookup | seq scan of 3M rows |
| `UNIQUE (id, user_id, department_id, status)` | FK target | ★ head ↔ membership invariant | invariant unenforceable |

Four occurrences, four mechanisms, zero redundancy. Removing any one changes
behaviour. This is the answer to question **A** for findings 1 and 4: Sonar is
*textually* correct that the token repeats, and *semantically* wrong that the
repetition is duplication.

### `role_assignments` — `'SUPERADMIN'`, `'DEPARTMENT_HEAD'`, `'active'` (findings 2, 3, 4)

| Occurrence | Mechanism | Enforces |
|---|---|---|
| `CHECK (role_key IN ('SUPERADMIN','DEPARTMENT_HEAD'))` | domain restriction | only two elevated roles exist |
| `CHECK ((role_key='SUPERADMIN') = (scope_type='GLOBAL'))` | cross-column agreement | a global role has no department |
| `CHECK ((role_key='DEPARTMENT_HEAD') = (membership_id IS NOT NULL))` | cross-column agreement | a head is anchored to a membership |
| `uq_single_active_superadmin WHERE role_key='SUPERADMIN' AND status='active'` | partial unique index | ★ one SuperAdmin per deployment |
| `uq_single_active_head_per_department WHERE role_key='DEPARTMENT_HEAD' AND status='active'` | partial unique index | ★ one head per department |
| `idx_role_assignment_user_active WHERE status='active'` | partial index | authorization context load |
| `requires_membership_status GENERATED ... CASE WHEN role_key='DEPARTMENT_HEAD' AND status='active' THEN 'active' END` | generated column | switches the FK on and off |
| `FOREIGN KEY (...) REFERENCES department_memberships(...)` | composite FK | ★ head ↔ active membership, same department |

Eight occurrences across three literals, each a separate rule. The generated
column deserves particular attention: it is the mechanism that makes the
invariant *conditional*. Under `MATCH SIMPLE`, a foreign key whose key columns
include a NULL is not checked at all — so by producing `'active'` only for live
head assignments and NULL otherwise, revoked and global rows exempt themselves
while live head rows are held to the rule. That is an elegant use of PostgreSQL's
FK semantics, and it is expressed *entirely* through the literals Sonar flagged.

### `'pending'` in the workflow tables (findings 5 and 6)

Identical shape in both `0006` and `0007`:

| Occurrence | Mechanism |
|---|---|
| `CHECK (status IN ('pending','approved','rejected'))` | domain restriction |
| `CASE status WHEN 'pending' THEN decided_by IS NULL AND decided_at IS NULL ELSE ... END` | decision-state consistency |
| `uq_pending_... WHERE status = 'pending'` | partial unique index — one open workflow |
| `idx_..._department WHERE status = 'pending'` | partial index — the open queue |

Note the `CASE` form. `0006`'s own comment records that the equality form
`(status='pending') = (decided_by IS NULL AND decided_at IS NULL)` has a hole:
"not both null" is satisfied by "exactly one null", so an approved row with only
`decided_by` set would pass. A real PostgreSQL run proved that before the file
was written. This is a schema whose literals were *tested*, not typed twice.

## 4. Sonar S1192 — every alternative, executed

The brief requires that ENUM not be assumed good. It was tested.

### Option B — ENUM

The straightforward conversion **fails immediately**:

```
ALTER TABLE department_memberships
  ALTER COLUMN status TYPE membership_status USING status::membership_status;
ERROR:  operator does not exist: membership_status = text
```

Every stored predicate — the inline CHECK, `memberships_state_consistent`, and
both partial index predicates — resolved its literal to `text` when the column
was `text`. Changing the column type leaves them comparing `membership_status` to
`text`, with no operator.

The honest path requires tearing down **six objects first**, one of which is the
★ invariant:

```sql
ALTER TABLE role_assignments DROP CONSTRAINT role_assignments_head_membership_matches; -- ★ INVARIANT DOWN
ALTER TABLE department_memberships DROP CONSTRAINT uq_membership_fk_target;
ALTER TABLE department_memberships DROP CONSTRAINT memberships_state_consistent;
ALTER TABLE department_memberships DROP CONSTRAINT department_memberships_status_check;
DROP INDEX uq_single_active_membership;
DROP INDEX idx_membership_department_active;
```

Measured cost at 3,000,000 rows, all under `ACCESS EXCLUSIVE` (reads *and* writes
blocked on the table):

| Step | Time |
|---|---|
| table rewrite (`ALTER COLUMN ... TYPE`) | 3,795 ms |
| rebuild `memberships_state_consistent` | 148 ms |
| rebuild `uq_single_active_membership` | 293 ms |
| rebuild `idx_membership_department_active` | 211 ms |
| rebuild `uq_membership_fk_target` | 1,625 ms |
| **total table-locked** | **≈ 6.1 s** |

And then it **still fails**:

```
ERROR:  foreign key constraint "role_assignments_head_membership_matches" cannot be implemented
DETAIL:  Key columns "requires_membership_status" and "status" are of incompatible types:
         text and membership_status.
```

Because `requires_membership_status` is a STORED generated column of type `text`.
It cannot be re-typed:

```
ALTER TABLE role_assignments ALTER COLUMN requires_membership_status TYPE ms2 USING ...;
ERROR:  cannot specify USING when altering type of generated column
```

The only route is DROP COLUMN + ADD COLUMN — a second full table rewrite, on a
second table, with the generated expression retyped, all while the invariant is
already down.

**Verdict on ENUM: rejected.** Per §6 of the brief, a refactor that leaves the
invariant unenforced at any point is a security/data-integrity regression. This
one leaves it unenforced across a multi-table, multi-second, `ACCESS EXCLUSIVE`
operation that does not even succeed on the first attempt. It also fails the
closed-set test independently: `ALTER TYPE ... ADD VALUE` cannot be reordered or
removed at all — so a future `'suspended'` membership state becomes a *harder*
migration than it is today, not an easier one.

### Option C — DOMAIN

`CREATE DOMAIN membership_status AS TEXT CHECK (VALUE IN ('active','ended'))`.

Genuinely lighter than ENUM, and it does not break the partial indexes. But it
fails the test the brief sets: *does it reduce duplication, or only rename the
literal?*

The literals Sonar flags are **not** in the `IN` lists alone. They are in the
partial index predicates (`WHERE status = 'active'`), in the cross-column CHECKs
(`(status='ended') = (ended_at IS NOT NULL)`), and in the generated column's
`CASE`. A DOMAIN can carry the `IN` list — one occurrence per table — and touches
none of the others. Sonar's count would barely move, the invariants would be
unchanged, and the schema would gain a type indirection every reader must now
resolve. That is complexity bought with nothing.

Reuse is also thin: the status sets differ per table (`active/ended`,
`active/archived`, `active/disabled`, `pending/approved/rejected`). A shared
domain would need four domains, i.e. one per table — which is what the inline
CHECKs already are.

**Verdict: rejected.** Renames the literal, does not remove it.

### Option D — lookup table

Explicitly forbidden by the architecture and by §7 of the brief: it would make
the role system data-driven and permit runtime-custom roles. `0004`'s header
already records the reasoning — three role contracts are named in code because a
guard references them by name, and a table of three rows nobody may edit only
adds a join. It would also convert every `can()` check into a join, on the
hottest read path in the system (§5), and introduce a cache-consistency problem
where none exists.

**Verdict: rejected**, on architecture grounds before performance ones.

### Option E — generated/helper abstraction

SQL DDL has no constant mechanism. `psql` `\set` variables are client-side and
would not survive the migration runner (which executes files through `pg`, not
`psql`). A pre-processor over `.sql` files would mean the file in the repository
is no longer the file that runs — trading a lint count for the ability to review
migrations.

**Verdict: rejected.**

### Option A — keep CHECK + literal

Costs nothing on write. Isolated benchmark, 200,000 inserts, no FKs, no indexes:

| Table shape | Time |
|---|---|
| no constraints | 370 ms |
| **11 CHECK constraints** | **366 ms** *(within noise — zero measurable cost)* |
| 11 CHECKs + STORED generated column | 440 ms (+0.35 µs/row) |

The CHECK constraints — the exact objects the findings point at — are free. The
generated column costs 0.35 µs per row, which buys the invariant.

**Verdict: KEEP.** It is the only option that enforces every invariant, costs
nothing measurable, and requires no migration.

## 5. Performance and index review at scale

All measured at 1M users / 3M memberships / 106k assignments after
`VACUUM ANALYZE`.

| Hot path | Endpoint | Plan | Time |
|---|---|---|---|
| authorization context | `GET /authorization/me` | 3× Index Scan, no join on base tables | **0.49 ms** |
| department members | `GET /departments/:id/members` | Index Scan `idx_membership_department_active` (945 rows) | **0.37 ms** |
| pending requests | `GET /membership-requests` | Bitmap Index Scan `idx_membership_request_department` (500 rows) | **0.45 ms** |
| pending invitations | `GET /account-invitations` | Bitmap Index Scan `idx_invitation_department` (300 rows) | **0.11 ms** |
| active head lookup | head guard | Index Scan `uq_single_active_head_per_department` | **0.03 ms** |
| active SuperAdmin | grant/revoke | Index Scan `uq_single_active_superadmin` | **0.02 ms** |

**No sequential scan on any read path. No N+1 anywhere** — `loadContext` resolves
global/head/member/credential state in a single round trip, and the list
endpoints return rows without per-row hydration.

**Partial index effectiveness** is the finding worth highlighting, because it is
the direct payoff of the flagged literals. In paths 3 and 4 the planner uses a
partial index with *no* `Index Cond` at all — the index's `WHERE status='pending'`
predicate alone satisfies the query, making the index behave as a physically
separate "open queue" table. `account_invitations` holds 200,300 rows; the pending
index reads 3 buffers to find all 300 open ones. That only works because
`'pending'` is a literal in the index predicate. **Convert it to an ENUM and the
predicate must be rewritten; remove the literal and the index cannot exist.**

**Cardinality behaviour.** Every hot path is an index scan whose cost is
O(log n) in table size and O(result size) in output. Extrapolation from 10 →
1,000,000 users is therefore flat for the point lookups. The two paths that scale
with *result* size are the list endpoints — see §11.

**Composite index / predicate match.** `uq_pending_membership_request
(department_id, target_user_id, action) WHERE status='pending'` exactly matches
the repository's duplicate-check predicate; the ordering matches too, so it
serves both the uniqueness rule and the lookup. No composite index was found
whose column order disagrees with its query.

**Generated column write cost:** 0.35 µs/row (measured, §4). Index maintenance:
`requires_membership_status` participates in no index before `0008`, and in a
48 kB partial index after it.

**CHECK constraint write cost:** zero, measured (§4). Planner behaviour: the
`IN`-list CHECKs give the planner accurate domain knowledge at no cost.

**Foreign key index support:** 11 FK columns have no leading index. Ten of them
reference `users(id)` or `departments(id)` — parent keys that are UUID primary
keys, never updated, and whose rows are **never hard-deleted** (`0001`: "never
hard-deleted"; `0003`: "archive, never delete"). The RI check that would need
those indexes therefore never fires. **The eleventh is real and is fixed by
`0008`** — see §6.

## 6. The real finding: `role_assignments.membership_id` had no FK index

**Not reported by Sonar.** Found by auditing the schema around findings 2–4.

The composite FK is:

```sql
FOREIGN KEY (membership_id, user_id, scope_id, requires_membership_status)
REFERENCES department_memberships (id, user_id, department_id, status)
```

`status` is inside the referenced key — that is the whole trick that makes
"ending a membership while its head assignment is active" a foreign key
violation. The consequence is that **every `UPDATE department_memberships SET
status = ...` fires an RI check on `role_assignments`**, keyed on the FK's leading
column `membership_id`. No index led with it:

```
LockRows
  ->  Seq Scan on role_assignments x
        Rows Removed by Filter: 106001
Execution Time: 7.167 ms
```

Linear in `role_assignments`, and that table is append-only by design — revoked
assignments are audit history. Measured growth: 6,001 rows → 0.4 ms; 106,001 rows
→ 7.1 ms (≈ 67 ns/row). Projecting, 1M assignments → ≈ 70 ms per membership end.

This fires on **transfer approval**, **offboarding approval**, and any flow that
ends a membership — the write paths of both capability modules.

### The fix, and why it is partial

`0008_role_assignment_membership_fk_index.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_role_assignment_membership_fk
  ON role_assignments (membership_id)
  WHERE requires_membership_status IS NOT NULL;
```

`requires_membership_status` is non-NULL for exactly the live head assignments —
and under `MATCH SIMPLE`, rows where it *is* NULL are exempt from the foreign key
entirely. So the predicate covers precisely the rows the FK can ever reference
and nothing else. The planner proves `requires_membership_status = 'active'`
implies `IS NOT NULL` and uses it.

| Index | Size at 106,001 rows | FK trigger |
|---|---|---|
| none | — | 7.103 ms (Seq Scan) |
| full `(membership_id)` | 3208 kB | 0.343 ms |
| **partial (chosen)** | **48 kB** | **0.245 ms** |

67× smaller, marginally faster, and — the point — it stays small forever. It is
bounded by the number of *active* head assignments (at most one per department),
while the table grows without bound with audit history.

**Decision: FIX NOW.** Evidence: EXPLAIN plan, measured latency, scaling
argument, known write path — all four gates the brief sets in §12.

## 7. Migration safety — both paths verified

`0001`–`0007` were **not modified**. `0008` is new and additive.

**PATH A — fresh database, `0001` → `0008`:** applied clean; all 5 indexes on
`role_assignments` present.

**PATH B — existing production-shape database (`0001`–`0007` with 1M users /
3M memberships / 106k assignments) → `0008`:**

| Check | Result |
|---|---|
| apply time | **12.3 ms** |
| lock acquired | **`ShareLock`** — blocks writes to `role_assignments` only, **reads unaffected**; no `ACCESS EXCLUSIVE`, no table rewrite |
| idempotent on re-run | ✅ `IF NOT EXISTS`, second run is a no-op NOTICE |
| data preserved | ✅ 1,000,000 users · 3,000,000 memberships · 106,001 assignments · 1,000,000 identities |
| constraints intact | ✅ 29 CHECK · 18 FK · 4 UNIQUE |
| generated column intact | ✅ `requires_membership_status` still `attgenerated = 's'` |
| ★ invariant still enforced | ✅ re-tested after `0008`, still rejects |

**Rollback:** `DROP INDEX idx_role_assignment_membership_fk;` — instantaneous,
non-destructive, restores the prior (slower but correct) behaviour. No data
migration to reverse. On a live system, `CREATE INDEX CONCURRENTLY` outside a
transaction would remove even the 12 ms write pause; the plain form is used
because the migration runner wraps each file in a transaction, and at this table
size the pause is not worth breaking that guarantee for.

Contrast with the ENUM path rejected in §4: `ACCESS EXCLUSIVE`, ≈ 6.1 s, invariant
down, and it does not complete.

## 8. Invariant verification — proven live at 1M scale

Every ★ invariant was attacked on the seeded database. All four held:

| Attack | Result |
|---|---|
| End an active membership while its head assignment is active | ❌ `role_assignments_head_membership_matches` |
| Grant DEPARTMENT_HEAD on a membership in another department | ❌ `uq_single_active_head_per_department` |
| Insert a second active SUPERADMIN | ❌ `uq_single_active_superadmin` |
| Insert a second active membership for one user | ❌ `uq_single_active_membership` |

A fifth proof arrived unsolicited: while building a 10,000-member department for
the pagination test, the bulk `UPDATE ... SET department_id` was **rejected by the
invariant FK** because some members held active head assignments. The constraint
caught a bad bulk write from a privileged session that did not know the rule —
which is exactly the argument for enforcing it in the database rather than the
service.

Every one of those four constraints is defined using a literal from findings
1–4. **The findings point at the invariants.**

---

# BACKEND REVIEW

*(senior-backend pass)*

## 9. Literal drift — the question that would have changed the verdict

The brief sets the decisive test for findings 1–6: duplication is only real if it
lets code drift. Every status literal in `src/` was enumerated (51 occurrences
across 24 non-spec files).

**Result: zero drift.**

- Lowercase for row states: `'active'`, `'ended'`, `'archived'`, `'disabled'`,
  `'pending'`, `'approved'`, `'rejected'`, `'revoked'` — consistent in TypeScript
  and SQL, in every file.
- Uppercase for role and scope keys: `'SUPERADMIN'`, `'DEPARTMENT_HEAD'`,
  `'GLOBAL'`, `'DEPARTMENT'`, `'TRANSFER_MEMBER'`, `'REMOVE_MEMBER'` — likewise.
- No `'ACTIVE'`, no `'enabled'`, no `'Active'`, no synonym of any kind.

The TypeScript side single-sources each set as a union type next to its entity —
`UserStatus`, `DepartmentStatus`, `MembershipStatus`, `REQUEST_STATUSES`,
`INVITATION_STATUSES` — so every SQL literal maps to exactly one compile-checked
TS member. A drift would be a type error, not a runtime surprise.

**This is the evidence that findings 1–6 are maintainability noise rather than a
schema-drift risk.** Had a single `'ACTIVE'` or `'enabled'` turned up, the verdict
would have been FIX LATER at minimum.

## 10. Query patterns, transactions, concurrency

**Transaction boundaries** are correct and minimal. Repositories never open their
own transactions (enforced mechanically by boundary check **B11**); services own
them via `database.transaction(...)`. Multi-step invariant-sensitive flows —
transfer, offboarding, invitation approval, SuperAdmin handover — run inside one.

**Concurrency control is pessimistic and correctly placed:**

| Lock | Purpose |
|---|---|
| `... WHERE id=$1 AND status='pending' FOR UPDATE` (requests, invitations) | serialises two administrators deciding the same item; the loser sees zero rows, not a double decision |
| `... WHERE user_id=$1 AND status='active' FOR UPDATE` (memberships) | a transfer ends the old membership without racing |
| `UPDATE ... WHERE id=$1 AND status='active'` (department archive, role revoke) | compare-and-set; a concurrent duplicate affects 0 rows |

The status predicate inside the `FOR UPDATE` is what makes the lock a decision
gate rather than just a lock — and that predicate is, again, one of the flagged
literals.

**Authorization correctness:** `loadContext` derives `global`, `headOf`,
`memberOf` and `mustChangeSecret` from the database on every authorized request.
Nothing is cached, so a revoked assignment takes effect on the next request with
no invalidation to get wrong. At 0.49 ms measured at 1M users, that is affordable
— and the brief's §12 forbids adding a cache without a bottleneck. There is none.

**Error handling:** SQLSTATE 23505/23503 are translated to domain errors at the
repository boundary rather than surfacing raw.

**Is `S1192` a symptom of something larger?** No. The repository SQL is
parameterised throughout (`$1`, `$2` …), the literals appear only in status
predicates that mirror the schema, and boundary check **B9** forbids SQL in the
API layer. There is no repeated query pattern hiding behind the flagged literals.

## 11. API surface — the one genuine backend gap

**No endpoint paginates.** `GET /departments/:id/members`,
`GET /membership-requests`, `GET /account-invitations` and the membership history
query all return every matching row.

Measured on a simulated 100-department org shape (10,932 members in one unit):

- Query: **3.18 ms** — Index Scan, optimal; the database is not the problem
- Payload: **939 kB of raw rows**, ≈ 2–3 MB once JSON-serialised

**Decision: FIX LATER, not FIX NOW, and not in this branch.**

- It is not a database design defect. The index is correct and the scan is
  O(result size), which is the floor.
- It is an API contract change, and the contract is consumed by the frontend —
  out of scope for this review by explicit instruction.
- Today's real shape (1,000 departments, ~950 members each) returns 0.37 ms and
  ~80 kB. The risk materialises only in a few-large-departments deployment.

**Recommended when addressed:** keyset pagination on `(created_at, id)` — the
existing `ORDER BY created_at ASC` and `idx_membership_department_active` already
support it, so no new index is needed. Offset pagination should be avoided; it
degrades on deep pages.

The pending queues are lower risk: they are bounded by workflow throughput, and a
queue with 100,000 open items is an operational problem before it is a
performance one. **OBSERVE.**

---

## 12. Finding #7 — `sonar-findings.sh`, reviewed separately

`backend/scripts/sonar-findings.sh:70-74`:

```bash
fatal() {
  local message="$1"
  printf '\n\033[31m%s\033[0m\n\n' "$message" >&2
  exit 1
}
```

**Question A — is Sonar right about the static analysis?** Partly. `shelldre:S7682`
wants an explicit `return` at the end of a function. Textually there is none.

**Question B — is it a real maintainability problem?** No. `exit 1` terminates the
shell. Any statement after it is unreachable by definition, and adding `return 1`
would introduce a line that provably cannot execute — dead code added to satisfy a
linter, which is worse than the lint.

**Question C — production impact?** None. This is a read-only developer tool
invoked by `npm run sonar`. It is not deployed, not imported, not on any request
path. It performs only GETs against `sonarcloud.io`.

**Question D — would a refactor improve anything?** No behaviour-preserving
refactor improves it. Changing `fatal()` to `return 1` and making every caller
handle the return would convert 6 terminal call sites into 6 conditional ones and
lose the guarantee that `fatal` is terminal — strictly worse.

**Verdict: KEEP — analyzer limitation, confirmed.** The script already documents
this at lines 67–69, and the sibling case at lines 119–123 shows the same
judgement applied in the other direction: `api()` deliberately keeps `return $?`
rather than `return 0`, because callers read that status and forcing success would
turn a short write into a silent empty body. That is a codebase that reasoned
about the rule rather than pattern-matching it.

**Tooling did not influence any database decision in this audit.**

---

# FINAL SYNTHESIS

## 13. Per-finding decisions

The six `S1192` findings share one analysis, given per the required template.
Fields genuinely identical across them are stated once and referenced.

### Findings 1 & 4 — `'active'` in `0003` and `0004`

| | |
|---|---|
| **Sonar finding** | String literal `'active'` duplicated |
| **Database impact** | None. The occurrences install 4 distinct mechanisms (§3): domain CHECK, two partial index predicates, and the FK target key. |
| **Backend impact** | None. Zero drift across 51 literal occurrences (§9); TS union types single-source each set. |
| **Performance impact** | **Positive.** The literal *is* the partial index predicate. Removing it removes `uq_single_active_membership` (0.49 ms context load) and `idx_membership_department_active` (0.37 ms member list). |
| **Security impact** | **Critical if "fixed."** `'active'` in the FK target key is what enforces the head ↔ membership invariant. ENUM conversion requires dropping it (§4). |
| **Scale impact** | Flat to 1M users; all paths index scans (§5). |
| **Migration impact** | Fixing costs ≈ 6.1 s `ACCESS EXCLUSIVE` + invariant down + does not complete (§4). Keeping costs nothing. |
| **Decision** | **KEEP** |
| **Evidence** | §3 mapping · §4 executed ENUM failure · §5 EXPLAIN plans · §8 four live invariant tests |
| **Recommended action** | None. Leave Accepted on SonarCloud with this document as rationale. |
| **Why not alternatives** | ENUM §4 (breaks invariant, does not complete) · DOMAIN §4 (renames, does not remove) · lookup table §4 (violates architecture) · pre-processor §4 (file ≠ what runs) |
| **Production risk** | **None** |

### Findings 2 & 3 — `'SUPERADMIN'` / `'DEPARTMENT_HEAD'` in `0004`

| | |
|---|---|
| **Sonar finding** | Role key literals duplicated |
| **Database impact** | None. 8 occurrences → 8 mechanisms (§3), including both partial unique indexes and the generated column driving the FK. |
| **Backend impact** | None; uppercase convention consistent everywhere (§9). |
| **Performance impact** | **Positive.** `uq_single_active_superadmin` (0.02 ms) and `uq_single_active_head_per_department` (0.03 ms) are defined by these literals. |
| **Security impact** | **Critical if "fixed."** These two indexes *are* the "one SuperAdmin" and "one head per department" invariants (§8). A lookup table would additionally make roles runtime-editable — forbidden by §7 of the brief. |
| **Scale impact** | O(log n); 1,000 departments measured. |
| **Migration impact** | As findings 1 & 4, plus the generated column cannot be re-typed at all (§4). |
| **Decision** | **KEEP** |
| **Evidence** | §3 · §4 generated-column `ERROR: cannot specify USING` · §8 invariant tests 2 and 3 |
| **Recommended action** | None. |
| **Why not alternatives** | Lookup table rejected on architecture before performance (§4). |
| **Production risk** | **None** |

### Findings 5 & 6 — `'pending'` in `0006` and `0007`

| | |
|---|---|
| **Sonar finding** | `'pending'` duplicated in each file |
| **Database impact** | None. 4 mechanisms each (§3): domain CHECK, decision-state `CASE`, partial unique index, queue index. |
| **Backend impact** | None. Also the `FOR UPDATE ... AND status='pending'` decision gate (§10) — the literal makes the lock a gate. |
| **Performance impact** | **Positive, and most visible here.** The planner uses the partial index *with no `Index Cond`* — 3 buffers to find 300 pending rows among 200,300 (§5). |
| **Security impact** | Moderate. `requests_no_self_approval` and the `CASE`-form decision-state constraint are the second, independent layer under the permission model. `0006`'s comment records that the naive equality form had a real hole. |
| **Scale impact** | 0.45 ms / 0.11 ms at 200k rows. |
| **Migration impact** | Two more tables to rewrite for no gain. |
| **Decision** | **KEEP** |
| **Evidence** | §3 · §5 bitmap plans · §10 lock analysis |
| **Recommended action** | None. |
| **Why not alternatives** | As §4; the partial-index-as-queue behaviour is lost or must be hand-rewritten under any of them. |
| **Production risk** | **None** |

### Finding 7 — `fatal()` in `sonar-findings.sh`

Full analysis in §12. **Decision: KEEP.** Analyzer limitation confirmed; `exit 1`
is terminal, a trailing `return` would be provably unreachable. Zero production
impact — read-only developer tool, never deployed. **Production risk: none.**

### Additional finding (not reported by Sonar) — missing FK index

| | |
|---|---|
| **Finding** | `role_assignments.membership_id` — leading column of the invariant FK — had no supporting index |
| **Database impact** | Seq Scan of `role_assignments` on every membership status change |
| **Backend impact** | Transfer approval and offboarding approval write paths |
| **Performance impact** | 7.1 ms at 106k rows, O(n), growing forever (append-only audit table) → **0.245 ms**, O(log n) |
| **Security impact** | None; FK behaviour unchanged, only how PostgreSQL finds the rows it was already checking |
| **Scale impact** | Projected ≈ 70 ms per membership end at 1M assignments without the fix |
| **Migration impact** | `0008`, additive, 12.3 ms, `ShareLock` only, idempotent, both paths verified (§7) |
| **Decision** | **FIX NOW** — done in this branch |
| **Evidence** | §6 EXPLAIN before/after · §7 both migration paths on real PostgreSQL · 529/529 tests |
| **Recommended action** | Merge `0008`. |
| **Why not alternatives** | Full index on `(membership_id)` also works but is 67× larger and grows unbounded with audit history; the partial predicate covers exactly the FK-eligible rows. |
| **Production risk** | **Medium and rising** before the fix; **none** after |

### Additional finding (not reported by Sonar) — no pagination

Full analysis in §11. **Decision: FIX LATER** (list endpoints) / **OBSERVE**
(pending queues). Not fixed here: it is an API contract change affecting the
frontend, which this review does not touch. **Production risk: low today**,
material only in a few-large-departments deployment.

## 14. Verification

All run on this branch against the project's real PostgreSQL 17.

| Check | Result |
|---|---|
| `npm run check` (B1–B12) | ✅ **all 12 boundaries clean** |
| `npm run typecheck` | ✅ exit 0 |
| `npm run build` | ✅ exit 0 |
| `npm test` (with `DATABASE_URL_TEST`) | ✅ **529 passed / 529**, 33 suites |
| Migration PATH A (fresh `0001`→`0008`) | ✅ |
| Migration PATH B (populated `0001`–`0007` → `0008`) | ✅ 12.3 ms, `ShareLock`, data preserved |
| `0008` idempotency | ✅ second run is a no-op |
| Invariants after `0008` | ✅ all four still enforced |

The migration runner picked up `0008` automatically; the four integration specs
were updated to include it so the invariant suites now exercise the schema
production runs.

**B1–B12 detail:** B1 core ↛ capabilities · B2 core ↛ infrastructure · B3 common ↛
core/capabilities/infrastructure · B4 infrastructure ↛ capabilities · B5 no
top-level by-filetype dirs · B6 no `process.env.X` outside validation · B7
foundation ↛ business vocabulary · B8 no nested infrastructure · B9 api ↛ SQL ·
B10 domain ↛ `@nestjs`/`pg`/`express` · B11 persistence ↛ opens own transaction ·
B12 no new `forwardRef`. All pass.

## 15. Why SonarCloud stays at 7 Accepted

Because the rule and the schema disagree about what a literal *is*.

`S1192` assumes a repeated string is a value that should live in one place, so a
change touches one line. That assumption holds in application code. It does not
hold in DDL, where each occurrence of `'active'` **installs a different piece of
machinery** — and where "changing it in one place" is not the goal, because the
four places must be able to differ. `uq_single_active_membership` and
`idx_membership_department_active` both say `WHERE status = 'active'` and they are
not the same statement: one forbids a second row, the other accelerates a lookup.
Merging them into one symbol would not simplify anything; it would only hide that
there are two rules.

The schema also has no mechanism to comply. SQL DDL offers no constants, and the
three constructs that come closest were each executed and each rejected on
measured grounds (§4) — ENUM breaks the invariant and does not complete, DOMAIN
renames without removing, a lookup table violates the architecture.

So the choice was: leave a lint count at 7, or take on a multi-second
`ACCESS EXCLUSIVE` migration that takes down the system's central authorization
invariant, cannot complete without a second table rewrite, and delivers no
measurable performance or maintainability gain. **7 is the correct number.**

What the audit *did* deliver is the thing Sonar could not see: the missing FK
index in §6, found by following the flagged literals into the mechanisms they
install and asking what those mechanisms cost at scale. Sonar reported the
literals in `0004` and said nothing about the sequential scan they imply. That is
the difference between a static analyzer and a review.

## 16. Unresolved questions

1. **Pagination** (§11) — needs a product decision on expected department size,
   and a frontend contract change. Keyset on `(created_at, id)` is ready to
   implement with no new index.
2. **Session cleanup** — `idx_sessions_expires_at` exists and its comment cites
   "the periodic sweep of dead sessions", but no sweep job was found in `src/`.
   The `sessions` table will grow without bound. Not in scope here; worth
   confirming whether the sweep is intended to be external (cron) or is missing.
3. **`migrations/README.md`** listed only `0001`–`0005`; `0006`–`0008` have been
   added to the table on this branch.
4. **`CREATE INDEX CONCURRENTLY`** — if `role_assignments` ever grows large enough
   that a 12 ms write pause matters, `0008`'s index should be rebuilt concurrently
   outside the migration runner's transaction. Not needed at any plausible
   near-term size.
5. **No shape spec for `0008`** — deliberate. A spec asserting that a one-line
   `CREATE INDEX` file contains that line tests nothing; the regression risk is
   covered by the four integration suites, which now run with `0008` applied.
