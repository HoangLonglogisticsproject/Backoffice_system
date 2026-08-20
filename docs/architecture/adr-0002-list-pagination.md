# ADR-0002 — List pagination

**Status:** **ACCEPTED and IMPLEMENTED** — migration `0009`, keyset pagination on all five
list endpoints. See §11 for what shipped and how it differs from this proposal.
**Date:** 2026-08-19
**Relates to:** [ADR-0001](adr-0001-user-identity-projection.md), whose one sequencing constraint this audit was opened to resolve.
**Measured on:** PostgreSQL 17.11 · 1,000,000 users · departments of 2k / 10k / 100k / 888k · 200k membership requests · 200k invitations.

---

## 1. Why this is urgent independently of ADR-0001

The audit was opened to decide sequencing. It found a production problem that exists **today**,
with no relation to user projections.

Two endpoints already **sequentially scan and spill their sort to disk**:

| Endpoint | Plan today | Time |
|---|---|---|
| `GET /departments/:id/membership-requests` | Parallel Seq Scan + **external merge, 4.6 MB to disk** | **54.2 ms** |
| `GET /departments/:id/account-invitations` | Parallel Seq Scan + **external merge, 10.0 MB to disk** | **84.6 ms** |

Both are worse than the member list, and both are worse than they look, because — unlike the
global queues — **they carry no status filter**:

```sql
-- listForDepartment: every request ever raised for this department
SELECT * FROM membership_change_requests WHERE department_id = $1 ORDER BY requested_at DESC;
```

The partial indexes that exist (`idx_membership_request_department … WHERE status='pending'`,
`idx_invitation_department … WHERE status='pending'`) serve only the global pending queues, and
**cannot serve these queries at all**. So these two lists return the department's entire
history, unbounded, forever, and the cost grows with the deployment's age rather than with
anything a user did.

The global pending queues are fine — `0.043 ms`, the partial index does its job — because they
are bounded by workflow throughput.

## 2. Current list inventory

| # | Endpoint | Query | Ordered by | Bounded by |
|---|---|---|---|---|
| 1 | `GET /departments/:id/members` | `department_id=$1 AND status='active'` | `created_at ASC` | department size |
| 2 | `GET /departments/:id/membership-requests` | `department_id=$1` — **no status filter** | `requested_at DESC` | **nothing** |
| 3 | `GET /membership-requests` | `status='pending'` | `requested_at ASC` | queue throughput |
| 4 | `GET /departments/:id/account-invitations` | `department_id=$1` — **no status filter** | `requested_at DESC` | **nothing** |
| 5 | `GET /account-invitations` | `status='pending'` | `requested_at ASC` | queue throughput |
| 6 | `GET /departments` | all rows | `name ASC` | department count (small) |
| 7 | membership history for a user | `user_id=$1` | `created_at DESC` | one person's moves |

Rows 1, 2 and 4 need pagination. Rows 3 and 5 should get it for uniformity but are not at
risk. Rows 6 and 7 are bounded small; 6 additionally sorts on a **mutable** column (see §5).

## 3. OFFSET versus keyset

### Correctness first — and this is what decides it

`created_at` is **not unique**. Bulk provisioning, a transfer approval and a transaction that
shares one `now()` all produce ties. The benchmark deliberately reproduced this: 10 rows per
distinct timestamp.

With a page size that lands mid-tie-group, a cursor on the timestamp **alone** is wrong in
both available directions:

| Cursor | Result |
|---|---|
| `created_at > $last` | **5 rows silently lost** |
| `created_at >= $last` | **5 rows duplicated** |
| `(created_at, id) > ($ts, $id)` | **25 rows, 0 overlap, 0 loss** |

OFFSET has the mirror-image problem, and it is worse because it is caused by *other people's*
writes rather than by ties. With `requested_at DESC`, a new request inserted while a user is
paging lands at the head, shifts every row one position later, and the row on the old page
boundary is **shown twice**. A deletion shifts the other way and **hides a row**.

Keyset is immune to both. `(created_at, id)` is immutable after insert — a row cannot move
between pages — and a new insert lands at one end of the ordering, never in the middle of a
page the client already read.

### Performance, member list, no ordered index

| Department size | `OFFSET 0` | `OFFSET` deep | **keyset** deep | full list (today) |
|---|---|---|---|---|
| 2,000 | 0.91 ms | 1.21 ms | 0.35 ms | 0.88 ms |
| 10,000 | 2.12 ms | 4.81 ms | 3.24 ms | 5.10 ms |
| 100,000 | 17.29 ms | 72.55 ms | **10.95 ms** | 86.56 ms |
| 888,000 | 67.42 ms | **941.89 ms** | **59.69 ms** | 474.17 ms |

Deep OFFSET at 888k spills **22 MB to disk**. But note `OFFSET 0` also costs 67 ms — so at this
scale **the sort is the cost, not the offset**, and neither pagination strategy is fast without
an index that supplies the ordering.

### Performance with the ordered index

`(department_id, created_at, id) WHERE status='active'` — 56 MB at 888k rows:

| Query | Without index | With index |
|---|---|---|
| page 1 | 66.4 ms | **0.313 ms** |
| keyset, row 800,000 | 66.1 ms | **0.279 ms** |
| `OFFSET 800000` | 941.9 ms | 254.8 ms |
| **keyset + `displayName` join (ADR-0001)** | — | **0.555 ms** |

Three things follow:

1. **The index is the dominant win** — 213× on page 1.
2. **Keyset is flat in depth.** Row 800,000 costs the same as row 1.
3. **OFFSET stays O(depth) even with the index** — it must still walk 800,050 entries. The
   index removes the sort and the disk spill, not the walk.

**Recommendation: keyset.** It is the only option that is both correct under concurrent writes
and flat in depth.

## 4. Stable sort keys

Every key is `(timestamp, id)`. The `id` is not decoration — it is what makes the order total,
and §3 shows exactly what breaks without it.

| Endpoint | Sort key | Direction |
|---|---|---|
| members | `(created_at, id)` | ASC |
| membership requests, per department | `(requested_at, id)` | **DESC** |
| membership requests, global queue | `(requested_at, id)` | ASC |
| account invitations, per department | `(requested_at, id)` | **DESC** |
| account invitations, global queue | `(requested_at, id)` | ASC |
| membership history | `(created_at, id)` | DESC |

Both components are immutable after insert, which is what makes the cursor stable.

**`GET /departments` is the exception and should not use this scheme.** It orders by `name`,
which is **mutable** — renaming a department moves it in the ordering, so a cursor can skip or
repeat rows through no fault of the reader. Departments are bounded and small; leave that
endpoint unpaginated rather than build a cursor that cannot be made correct.

## 5. Index requirements

The index direction must match the query direction **including the tiebreaker**, or PostgreSQL
falls back to an Incremental Sort:

| Index on requests | Plan | Time |
|---|---|---|
| `(department_id, requested_at DESC, id)` | Incremental Sort + Index Scan | 0.659 ms |
| `(department_id, requested_at DESC, id DESC)` | **pure Index Scan** | **0.285 ms** |

Required, in a new forward-only migration:

```sql
-- 1. members: replaces nothing; the existing partial index cannot supply the ordering
CREATE INDEX idx_membership_dept_page
  ON department_memberships (department_id, created_at, id) WHERE status = 'active';

-- 2 & 3. the two unbounded department histories, which today seq-scan and spill to disk
CREATE INDEX idx_request_dept_page
  ON membership_change_requests (department_id, requested_at DESC, id DESC);
CREATE INDEX idx_invitation_dept_page
  ON account_invitations (department_id, requested_at DESC, id DESC);
```

| Index | Size at benchmark scale | Effect |
|---|---|---|
| `idx_membership_dept_page` | 56 MB @ 888k active rows | 66.4 ms → **0.313 ms** |
| `idx_request_dept_page` | 11 MB @ 200k rows | 54.2 ms → **0.285 ms** |
| `idx_invitation_dept_page` | 11 MB @ 200k rows | 84.6 ms → **1.779 ms** |

The global pending queues need nothing — their partial indexes already serve them at 0.043 ms.

**Write cost:** three more indexes to maintain. All three are on append-mostly tables, and the
membership one is partial so it holds only active rows. Consistent with `0008`, the existing
`B13` boundary check keeps the runtime free of DELETEs, so index churn stays low.

## 6. Proposed API contract

### Request

```
GET /departments/:departmentId/members?limit=50&cursor=<opaque>
```

| Parameter | Rule |
|---|---|
| `limit` | optional, default **50**, max **200**; anything else → `422 VALIDATION_FAILED` |
| `cursor` | optional, opaque. Absent means the first page. Malformed → `422`, never a silent first page |

### Response

```jsonc
{
  "items": [ /* … the array that is returned today, unchanged … */ ],
  "nextCursor": "eyJ0IjoiMjAyNi0wOC0xOFQwODozNDowNC45NzVaIiwiaSI6ImQ0YjU4ZmQzLi4uIn0",
  "hasMore": true
}
```

- `nextCursor` is `null` and `hasMore` is `false` on the last page. A client pages until
  `hasMore` is false, and never constructs a cursor itself.
- `hasMore` is computed by fetching `limit + 1` rows and discarding the extra — no `COUNT(*)`,
  which would re-scan the whole partition on every page.
- **No total count.** It cannot be produced without the full scan pagination exists to avoid.
  If a screen truly needs one, that is a separate decision with its own cost.

### Cursor semantics

The cursor encodes the sort key of the last row returned — `{ t: <timestamp>, i: <uuid> }`,
base64url — and nothing else.

**A cursor is a position, never a permission.** It must not carry `departmentId`, a filter or
a scope, and the server must not read scope from it. Scope stays on the path and is
authorized before the query runs, exactly as it is today (§15). A caller who moves a cursor
from one department's list to another's gets rows from the department **on the URL**, which
their session was already authorized for. Opaqueness is anti-tampering ergonomics; the
authorization boundary is unchanged.

### Ordering guarantees

- Total order, so pages never overlap and never skip.
- A row already read cannot move to a later page: both key components are immutable.
- Rows inserted during paging appear at one end, in ASC order on later pages and in DESC
  order only on a fresh page 1.
- A row whose **filter** changes mid-paging disappears — a member whose membership ends stops
  matching `status='active'`. That is the list telling the truth, not a pagination defect.

### Backward compatibility

The envelope is a **breaking response-shape change**: `[…]` becomes `{ items: […] }`.

It is nonetheless the cheapest moment in the project's life to make it. The frontend read
layer is complete but **no page consumes it yet** — the only work is unwrapping `.items` in
six repositories and updating the integration assertions. That cost rises every week.

Rejected alternatives: a `?paginated=true` flag (two response shapes forever, and the unsafe
one stays the default), and versioned routes (a second surface to authorize and test, for a
frontend that has one consumer).

## 7. Sequencing — should this ship with ADR-0001?

**No. Pagination first, as its own change. ADR-0001 second.**

| | Pagination (ADR-0002) | Projection (ADR-0001) |
|---|---|---|
| Response change | **envelope** — breaking | fields inside rows — additive |
| Database | **new migration**, three indexes | none |
| Justified by | a problem in production **today** — disk spills, 942 ms deep pages | a UX gap: screens can only show UUIDs |
| Risk if it lands alone | none; strictly faster | **regression** — 0.75 ms → 25 ms on an unpaginated member list |

They have different blast radii and different urgency. Bundling would put an additive,
zero-migration change inside a migration's rollback story for no benefit, and would delay a
fix that is already needed.

The measured cost of ADR-0001 **on top of** paginated, indexed reads is **0.279 ms → 0.555 ms**
per page — which is the "free" the ADR claimed, now demonstrated rather than asserted.

## 8. Verdict on ADR-0001

**Approve, with a two-line amendment.** The recommendation and the authorization reasoning
stand — B still requires an authorization rule the permission model cannot express, and that
is unaffected by anything measured here. Amend:

1. **State the dependency precisely.** ADR-0001 says A is free at page scale. That is true
   **only once `idx_membership_dept_page` exists**. Without it, page 1 of a large department is
   ~66 ms with or without the projection, because the sort dominates and the join is noise.
   As written, the ADR credits pagination with a win that belongs to the index.

2. **Replace "ship with pagination, or pagination first" with "after ADR-0002".** The audit
   removes the ambiguity: pagination has independent, present-tense justification, and A is a
   regression without it.

No change to the recommendation, the `UserRef` shape, or the additive-fields decision.

## 9. Frontend implications

Deliberately small, and out of scope for a decision:

- Six repositories return `data.items` instead of `data`; the types gain
  `{ items, nextCursor, hasMore }`.
- `useSessionResource` is unchanged for a first page. Accumulating pages is a caller concern.
- **Still no query library.** A cursor list has one reader and no cache to invalidate; that
  decision should be revisited when a second reader of the same data appears, not before.

## 10. What this ADR does not decide

- **Total counts.** Not offered, and adding one later means re-opening the scan question.
- **Sorting or filtering by client-chosen columns.** Each new sort key needs its own index and
  its own cursor encoding.
- **`GET /departments` pagination.** Recommended against, because `name` is mutable (§4).
- **Whether the two department-scoped workflow lists should filter by status.** They return
  full history today. That may be intentional or an oversight; either way pagination makes it
  survivable, and narrowing it is a product question, not a performance one.

---

## 11. What shipped

Implemented on `feat/backend-pagination`. The proposal above stands; three things are worth
recording because they were decided during implementation rather than in the design.

**The global queues got no index.** §5 proposed three indexes and that is what `0009`
creates — but only for the three DEPARTMENT-scoped lists. The two global pending queues
(`GET /membership-requests`, `GET /account-invitations`) are already served by the partial
indexes from `0006` and `0007` at 0.091 ms, and are bounded by workflow throughput rather
than by the deployment's age. An index that buys nothing still costs every write.

**Row-wise comparison, not an expanded OR.** The queries use `(created_at, id) > ($1, $2)`
rather than `created_at > $1 OR (created_at = $1 AND id > $2)`. Both are correct; the first
is what the planner satisfies straight from the index, and it is far harder to get subtly
wrong when somebody edits it later.

**A malformed cursor is a 422, not a silent first page.** Falling back to page one would
turn a client bug into a loop that re-reads the first page forever and looks like success.

### Measured after implementation — PostgreSQL 17.11, 300k memberships, 200k of each workflow row

| Query | Before | After |
|---|---|---|
| members, page 1 | 15.269 ms · Parallel Seq Scan | **0.215 ms** · Index Scan |
| members, keyset at row 240,000 | — | **0.184 ms** — flat in depth |
| members, `OFFSET 240000` | — | 35.905 ms · scans 240,051 rows |
| department requests, page 1 | 11.494 ms · Parallel Seq Scan | **0.141 ms** |
| department invitations, page 1 | 11.439 ms · Parallel Seq Scan | **0.165 ms** |
| global pending queue | — | 0.091 ms · unchanged, existing partial index |

Index sizes: 17 MB, 11 MB, 11 MB against 27–30 MB tables. Write amplification measured at
**+17 %** on a 20,000-row insert (653 ms against 558 ms) — the cost of turning an 11 ms
sequential scan into a 0.165 ms index seek.

### Correctness, proven rather than argued

Seeded with **300 rows per timestamp** — a far more severe tie than production will see —
and walked 40 pages of 50:

```
pages=40  rows_returned=2000  distinct=2000  OVERLAP=0  MISSING=0
```

With a concurrent INSERT at the head of the order and a DELETE of an already-read row,
between page 1 and page 2:

```
page2_rows=50  overlap_with_page1=0  inserted_row_leaked_into_page2=0
```

`OFFSET` fails both of those by construction, which is the reason for keyset that has
nothing to do with milliseconds.
