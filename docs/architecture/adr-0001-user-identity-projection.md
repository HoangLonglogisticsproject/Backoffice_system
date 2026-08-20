# ADR-0001 — User identity projection for read resources

**Status:** **ACCEPTED and IMPLEMENTED** — Option A, on all six read paths. See §W for what shipped.

**Date:** 2026-08-19
**Affects:** backend read endpoints (§5, §6, §9, §10, §15b), the frontend integration contract, no database schema.

> **Dependency satisfied.** This ADR's one sequencing constraint was that pagination land
> first. [ADR-0002](adr-0002-list-pagination.md) shipped, and so did the cursor-precision
> hotfix that its own projection tests uncovered. The projection was then built on top of
> both.


---

## Problem

Every read resource that refers to a person carries a **UUID and nothing else**. There is no
endpoint that turns a user id into a name, so a screen built on these responses can only
display identifiers.

| Resource | Fields that name a person | What the client can show |
|---|---|---|
| `GET /departments/:id/members` | `userId` | a UUID |
| `GET /departments/:id/membership-requests` · `GET /membership-requests` | `targetUserId`, `requestedBy`, `decidedBy` | three UUIDs |
| `GET /departments/:id/account-invitations` · `GET /account-invitations` | `requestedBy`, `decidedBy`, `createdUserId` | UUIDs (plus `email`, which is already returned) |
| `GET /departments/:id/head` | `userId` | a UUID |

The frontend is explicitly barred from the three workarounds — N+1 `GET /users/:id`, a
client-side join from another source, or a fabricated projection — and all three are barred
for good reasons: N+1 turns one list into hundreds of requests, and the other two invent a
second definition of who a user is.

So the gap has to be closed on the server, and this ADR is about how.

## Current state

- All six read queries — five lists and the single-row head read — are single-table
  `SELECT *` with **no joins**.
- `users` holds `id`, `display_name`, `status`. That is the whole of what could be shown.
- `username` is **not stored**. `GET /authorization/me` derives it with `localPartOf(subject)`
  from `identities.subject`, which **is the email**. Including `username` therefore means a
  second join *and* exposing the local part of somebody's email address.
- Users are never hard-deleted (`0001_identity.sql`), so a reference can never dangle. A
  join for a non-nullable id can be `INNER` without risk.
- Index support already exists: `users_pkey` for the user join, `idx_identities_user_id` if
  identities were ever joined. **No schema change and no migration is required by any option
  below.**

## Options

### A — inline minimal projection

Each resource carries the projection for the people it already references.

### B — bulk user lookup endpoint

A new `GET /users?ids=…`, called by the client after each list.

### C — both

A, plus B for callers holding ids from elsewhere.

### Comparison

Measured on PostgreSQL 17.11, 200,000 users, 100 departments × 2,000 members — the
"few large departments" shape, which is the worst case for these endpoints.

| Dimension | A — inline | B — bulk endpoint |
|---|---|---|
| **Query count** | 1 | 2 (list, then lookup) |
| **DB cost, full 2,000-row list** | 24.9 ms — planner picks a **parallel seq scan** over `users`; 14.0 ms if forced to nested-loop | 5.2 ms (+0.75 ms for the list) |
| **DB cost, page of 50** | **0.73 ms** (nested loop, no seq scan) | 0.29 ms (+list) |
| **Baseline today (no names)** | 0.75 ms full list | — |
| **Adding `username`** | +6 ms full list, +0.4 ms per page (second join) | same second join, inside the endpoint |
| **Payload** | +50 B/row (`id` 36 + `displayName` 14) on an 88 B row → **≈ +57 %**; repeats a name once per row | dedupes repeated ids; two envelopes |
| **Authorization** | **Inherits the container's decision.** If a caller may see the member list, they may see those members' names. No new rule. | **Needs a new rule** — "may this caller resolve an arbitrary id to a name?" See below. |
| **Caching** | nothing new; the resource is the unit | a second cache with its own coherence and invalidation |
| **Consistency** | one snapshot, one transaction | two reads; a name can change between them |
| **Future pagination** | benefits from it — the join becomes free | benefits from it — fewer ids per page |
| **Frontend complexity** | none; the field is there | orchestration, id collection, dedupe, merge, a store |
| **Backward compatibility** | additive fields; nothing breaks | new endpoint; nothing breaks |

### The authorization argument, which decides this

Option B needs an answer to *"may this caller turn this user id into a name?"* — asked with
**no context**. The permission model is deliberately relational (`global`, `headOf`,
`memberOf`), and it has no answer for that question, because a bare user id belongs to no
department from the model's point of view.

Any rule invented for it is either too loose — a head passes arbitrary UUIDs and enumerates
every name in the organization — or it must recompute the authorization the original
resource already performed, in a second place, where the two can disagree.

Option A asks nothing new. The projection rides inside a resource whose authorization has
already been decided, so a name is visible exactly when the row referencing it is.

### The performance argument is about pagination, not about the join

The 33× penalty for A is entirely an artifact of returning 2,000 rows at once. At a page of
50 the join costs **0.73 ms against a 0.75 ms baseline** — free, and the planner uses a
nested loop rather than a sequential scan.

Pagination is already recorded as FIX LATER (`sonar-production-audit.md` §11). The right
reading is that **A is cheap once pagination lands, and the un-paginated list is a known
problem being solved separately** — not a reason to build a second endpoint.

## Recommendation

**Option A.** Reject B, and therefore C.

Define one canonical shape and reuse it everywhere:

```jsonc
// UserRef — the canonical identity projection
{ "id": "fab71f53-…", "displayName": "Head Person" }
```

**`displayName` only.** Not `username`: it costs a second join and exposes the local part of
somebody's email, which no current screen needs. Not `status`: a member list already carries
the membership status, and an active membership implies an active user. Both can be added
later against a real requirement; neither can be un-shipped once a client depends on it.

**Additive, never replacing.** Existing scalar id fields stay exactly as they are, and each
gains a sibling object. Nothing that reads the current contract breaks:

| Resource | Existing field (kept) | New sibling |
|---|---|---|
| members | `userId` | `user` |
| head | `userId` | `user` |
| membership requests | `targetUserId` · `requestedBy` · `decidedBy` | `targetUser` · `requestedByUser` · `decidedByUser` |
| invitations | `requestedBy` · `decidedBy` · `createdUserId` | `requestedByUser` · `decidedByUser` · `createdUser` |

A sibling for a nullable id is `null` when the id is null, and its join is `LEFT`. A sibling
for a required id is never null, and its join is `INNER` — safe because users are never
deleted.

**Sequence it with pagination.** Ship A on the paginated list endpoints, or ship pagination
first. Shipping A alone onto the un-paginated member list would take that endpoint from
0.75 ms to 25 ms in the large-department shape.

### Response examples

```jsonc
// GET /departments/:id/members
[{
  "id": "d4b58fd3-…", "userId": "fab71f53-…",
  "user": { "id": "fab71f53-…", "displayName": "Head Person" },   // ← added
  "departmentId": "7ce2630e-…", "status": "active",
  "createdAt": "2026-08-18T08:34:04.975Z", "endedAt": null
}]
```

```jsonc
// GET /membership-requests
[{
  "id": "f6d42eed-…", "departmentId": "60630e75-…", "targetDepartmentId": null,
  "targetUserId": "7d47b2ac-…",
  "targetUser":      { "id": "7d47b2ac-…", "displayName": "Moved Person" },   // ← added
  "requestedBy": "8b18fa79-…",
  "requestedByUser": { "id": "8b18fa79-…", "displayName": "Head Person" },    // ← added
  "decidedBy": null, "decidedByUser": null,                                   // ← added
  "action": "REMOVE_MEMBER", "status": "pending",
  "requestedAt": "2026-08-18T08:34:23.633Z", "decidedAt": null, "reason": null
}]
```

```jsonc
// GET /departments/:id/head
{
  "assignmentId": "…", "departmentId": "7ce2630e-…",
  "userId": "fab71f53-…",
  "user": { "id": "fab71f53-…", "displayName": "Head Person" },   // ← added
  "membershipId": "d4b58fd3-…", "grantedAt": "2026-01-01T00:00:00.000Z"
}
```

## Performance implications

| Endpoint | Today | With A, page of 50 | With A, un-paginated worst case |
|---|---|---|---|
| members | 0.75 ms | **0.73 ms** | 24.9 ms (2,000 rows) |
| membership requests | ~0.45 ms | ~0.8 ms | bounded by the pending queue |
| invitations | ~0.11 ms | ~0.5 ms | bounded by the pending queue |
| head | 0.03 ms | 0.06 ms | single row |

The two queue endpoints are bounded by workflow throughput rather than organization size —
a queue with thousands of undecided items is an operational problem before it is a
performance one — so the un-paginated column only really threatens the member list.

Payload grows ≈ 57 % per membership row — the projection adds the UUID (36) and the
name (14), counted the same way as the 88 B row itself. At a page of 50 that is about
2.5 KB.

The earlier draft of this table said ≈ 24 %. It was wrong twice over: it counted `status`,
which the membership row already carried and which the shipped projection does not
include, and it left out the nested `id` entirely.

## Migration impact

| | |
|---|---|
| **Database** | **None.** No schema change, no migration. `users_pkey` already supports every join. |
| **Backend** | Five list queries gain a join and a mapper field. No new table, endpoint, guard or permission. |
| **Frontend** | Types gain optional fields. Existing code keeps compiling and working — the scalar ids it reads today are unchanged. |
| **Contract doc** | Response examples in §5, §6, §9, §10, §15b, and the §20 matrix rows. |
| **Rollback** | Drop the sibling fields. Nothing depends on them until a screen does. |
| **Tests** | Existing integration assertions still pass: they assert on the scalar ids, which do not move. |

## What this ADR does not decide

- **Pagination shape.** Decided and shipped separately by
  [ADR-0002](adr-0002-list-pagination.md) — opaque keyset cursors, `{items, nextCursor,
  hasMore}`. This ADR only ever said A should not land on the member list before it, and it
  no longer has to.
- **`username` or `email` exposure.** Deliberately excluded. Revisit against a real screen.
- **A user-directory endpoint.** Listing or searching people is a different feature with a
  different authorization question, and nothing here should be read as a step toward it.

---

## W. What shipped

Option A, unchanged in substance. Six read paths, one canonical shape, no new endpoint.

### The shape

```jsonc
// UserSummary — the only way this API names a person
{ "id": "fab71f53-…", "displayName": "Head Person" }
```

`displayName` and nothing else, exactly as recommended. Not `email` — an email is not a
display name and must never be substituted for one. Not `username` — it is not stored, it is
derived from `identities.subject`, which IS the email, so returning it would leak the local
part of somebody's address. Not `status` — a member list already carries the membership's
status, and an active membership implies an active user.

### Where it landed

| Endpoint | Scalar id (kept) | New sibling |
|---|---|---|
| `GET /departments/:id/members` | `userId` | `user` |
| `GET /departments/:id/membership-requests` | `targetUserId` · `requestedBy` | `targetUser` · `requestedByUser` |
| `GET /membership-requests` | same | same |
| `GET /departments/:id/account-invitations` | `requestedBy` | `requestedByUser` |
| `GET /account-invitations` | same | same |
| `GET /departments/:id/head` | `userId` | `user` — **read only** |

**Every existing scalar id stays exactly where it was.** The change is additive; nothing that
read the old contract breaks.

### Three decisions taken during implementation

**`decidedByUser` and `createdUser` were NOT built,** though §Recommendation listed them.
Both columns are nullable, so each needs a LEFT JOIN, and no screen displays either one. A
join paid on every row of every page for a field nobody reads is a cost with no reader.
Siblings are additive by design — the day a decision-history screen exists, they can be added
without breaking anything.

**Read models are separate from the write entities.** `DepartmentMembership` and friends are
what the write paths produce — `lockActiveForUser`, the transfer inside a transaction, the
approve path — and none of them need a name. Putting the projection on the entity itself
would have charged every one of those callers for a display concern. So the joins live only
on the list reads, in `…WithUser` types.

**The head projection is on the READ only.** `findActiveHeadOfDepartment` has three other
callers, and all three are approval workflows looking the head up inside a transaction to
decide something — they display nothing. A second repository method serves the display route
instead, so `assign` and `revoke` keep the write-path shape and the authorization service was
not touched.

### Authorization

The order is unchanged and the projection is last:

```text
authn → authz → scope → paginated query → projection
```

**No new authorization surface.** A `UserSummary` only rides inside a resource whose
authorization was already decided, so a name is visible exactly when the row referencing it
is. The caller cannot choose who gets projected: targets come from the rows the scoped query
returned, never from a query string or body. A 403 produces no rows, and therefore no names.

This is the argument that rejected **Option B**, and implementation did not weaken it. A bulk
`GET /users?ids=…` would have to answer *"may this caller turn this user id into a name?"*
with no context at all, and the permission model — `global`, `headOf`, `memberOf` — has no
answer, because a bare user id belongs to no department. Any rule invented for it is either
too loose (a head enumerates every name in the organization by passing arbitrary UUIDs) or it
re-decides, in a second place, what the owning resource already decided. Option A asks
nothing new. **Option C falls with B.**

### Measured cost — PostgreSQL 17, 300k users · 250k members · 200k requests · 200k invitations

Warm, `limit` 50, compared against the same paginated baseline:

| Query | Baseline | With projection | Plan |
|---|---|---|---|
| members, page 1 | 0.032 ms | **0.126 ms** | Index Scan → Nested Loop `users_pkey` ×51 |
| members, deep cursor (row 240k) | 0.049 ms | **0.135 ms** | same — **flat in depth** |
| requests, page 1 (two joins) | 0.057 ms | **0.237 ms** | Index Scan → 2× Nested Loop |
| requests, deep cursor (row 190k) | 0.047 ms | **0.225 ms** | same |
| invitations, page 1 | 0.033 ms | **0.215 ms** | Index Scan → Nested Loop |
| invitations, deep cursor | — | **1.277 ms** | same |
| head, single row | 0.013 ms | **0.080 ms** | Nested Loop, one lookup |

Every ordered index still drives its query. No sequential scan on any large table, no sort,
no hash join. The `LIMIT` caps the driving side, so the planner picks a nested loop of
primary-key lookups rather than hashing 300,000 users — which is what makes the join cheap.
Roughly 2–3 µs per row projected.

**No migration and no new index.** `users_pkey` already supported every join, exactly as this
ADR predicted.

### Row multiplication, and why it cannot happen

Every join is INNER, on `users.id`, a primary key — 1:1, so a list row cannot be duplicated.
INNER is safe rather than optimistic: every user reference in these four families carries a
`NO ACTION` foreign key, so **PostgreSQL physically refuses to delete a user who is still
referenced**. That is asserted by a test, not assumed. A LEFT JOIN would only add a null case
that cannot occur.

### Interaction with pagination

The projection had to be added without disturbing the keyset. Two hazards, both handled:

- **`SELECT *` is gone from these queries.** With `users` joined in, a star lets its `id`,
  `created_at` and `status` overwrite the membership's own — the mapper would read a user id
  as a membership id, and the cursor would then encode the wrong row entirely.
- **Every keyset column is qualified**, including the `::text` cursor anchor. Unqualified they
  are ambiguous, and ordering by anything but the driving table's own columns costs the
  ordered index a sort.

The full-precision anchor from the cursor hotfix is preserved verbatim: the sort key is still
`created_at::text` / `requested_at::text`, still never parsed into a `Date`.

### Backwards compatibility

Additive only. Existing scalar ids unchanged, existing clients keep compiling and working,
and the frontend types gained fields rather than losing any. Rolling back means dropping the
sibling fields; nothing depends on them until a screen does.
