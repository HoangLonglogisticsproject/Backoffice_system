# ADR-0003 — Offset pagination for the trip schedule

**Status:** **ACCEPTED and IMPLEMENTED** — `GET /trip-schedules` only. Every other list
keeps the keyset contract of [ADR-0002](adr-0002-list-pagination.md).

**Date:** 2026-08-30 *(recorded after the fact — the decision shipped with migration
`0011` and `capabilities/trip-schedule/`; this file writes down reasoning that until now
lived only in source comments)*

**Affects:** `GET /trip-schedules` · `common/pagination/offset-page.ts` ·
`common/pagination/date-range-page-query.dto.ts` ·
`capabilities/trip-schedule/persistence/trip-schedule.repository.ts` ·
the frontend integration contract. **No database schema.**

> ⚠ This ADR records an **exception**. [ADR-0002](adr-0002-list-pagination.md) is the
> house rule and remains in force everywhere else. Read that one first.

---

## 1. Problem

[ADR-0002](adr-0002-list-pagination.md) settled pagination for the whole API: **keyset**,
with `{ items, nextCursor, hasMore }`. It refuses `total` on purpose — computing it means
counting rows nobody is going to read.

The trip schedule cannot live inside that contract, and the reason is not technical
taste. It replaces a workbook where **one sheet was one month**, and the two questions
dispatch asks of it every day are:

- *"How many trips this month?"*
- *"Page 2 of 3"*

Keyset answers neither. It cannot: a cursor knows where it is, not how many rows exist
behind or ahead of it.

So this list needs `total`, and `total` is exactly what ADR-0002 declined to pay for.

## 2. What ADR-0002 measured, and why it said no

ADR-0002 rejected `OFFSET` on two grounds, both measured or reasoned there:

| # | Objection | Evidence in ADR-0002 |
|---|---|---|
| **O-1** | **Deep offsets are slow.** `OFFSET 800000` cost **941.9 ms** and spilled **22 MB** of sort to disk; the equivalent keyset page cost **0.279 ms** | measured |
| **O-2** | **`OFFSET` is WRONG under concurrent writes.** A row inserted at the head shifts every later row by one, so the page boundary is read twice — or a row is silently skipped | reasoned |

O-2 was the decisive one. Slowness is a cost; silently losing a row from a membership
audit list is a correctness defect.

## 3. Key observation — both objections are about an *unbounded* list

Neither O-1 nor O-2 is a statement about `OFFSET` in the abstract. Both are statements
about `OFFSET` applied to a list **whose size the caller does not bound**.

The trip schedule is not that list. Its date range is **mandatory** — and where a caller
omits it, the API supplies one rather than allowing its absence.

### 3.1 The range is always present

`date-range-page-query.dto.ts` resolves the range in a `transform`, so nothing downstream
ever sees an unbounded query:

| Caller sends | Resolved range |
|---|---|
| neither `from` nor `to` | **the current month** on the business calendar |
| only `from` | `from` … end of the month `from` falls in |
| only `to` | start of the month `to` falls in … `to` |
| both | as given |

And two refinements guard it: `to` may not precede `from`, and the span may not exceed
**`MAX_RANGE_DAYS = 366`** — a year plus a day, so *"the whole of last year"* and
*"the last 12 months"* both fit without a caller having to know where the boundary is.

★ **The default is what makes the argument airtight.** If the range were merely
*optional*, one caller omitting it would put the list back in the regime ADR-0002
measured. Defaulting it means **no reader of this list can escape the bound.**

### 3.2 "The current month" is the business calendar, not the server clock

`scheduled_on` is a `DATE` — a day on a wall calendar, with no timezone. The default
range is computed in **`Asia/Ho_Chi_Minh`**, hardcoded.

A server in UTC computing `new Date()` answers **August** to a dispatcher looking at
06:00 on 1 September in Hồ Chí Minh, because UTC+7 has not rolled over yet. That is a
wrong answer roughly **every month**, at exactly the hour the month's first trips are
being entered.

Hardcoded rather than configured: one operator, one country, and a setting nobody sets is
a setting nobody keeps correct.

## 4. The three objections re-evaluated under a bounded range

| # | Objection | Under a mandatory, capped range |
|---|---|---|
| **O-1** | Deep offsets | ✅ **Void.** The current month is roughly 60–100 rows; the widest legal range is 366 days. The deepest reachable offset is a few hundred rows, not 800 000 |
| **`COUNT(*)`** | Counting scans the table | ✅ **Void.** The count is bounded by the same range, and `idx_trip_schedule_page` leads with `scheduled_on`, so the count reads the range and stops |
| **O-2** | Boundary shift under concurrent writes | ⚠ **Survives, but its cost collapses.** See §4.1 |

### 4.1 O-2 is accepted, not refuted

The defect still exists. It needs an insert **inside the range being read, while it is
being read**.

What changes is the consequence. Rows here are **dated dispatch work**: a same-second
insert into the month somebody is paging is possible but rare, and its cost is *one row
seen twice on a screen that is refreshed constantly*. That is not the silent loss which
made `OFFSET` unacceptable for a membership audit list.

★ This is a **deliberate acceptance of a known defect in a context where its cost is
small** — not a claim that the defect went away.

## 5. Decision

**`GET /trip-schedules` uses offset pagination, returning `total`.**

```text
{ items, page, limit, total, totalPages }      ← this list only
{ items, nextCursor, hasMore }                 ← every other list (ADR-0002)
```

Three implementation properties, each load-bearing:

| Property | Why |
|---|---|
| `total` comes from **`COUNT(*) OVER()`** on the same query that fetched the rows | Two round trips could see two different states and produce a page that does not fit its own total. One statement makes count and page consistent **by construction** |
| `totalPages` is **derived**, not sent separately | A client can never hold two numbers that disagree. `0` when `total` is `0` — there is no "page 1 of 0" to navigate to |
| A page past the end is **empty, not an error** | `?page=99` on a 3-page list returns `items: []` with the real `total`. A client holding a stale page number recovers by reading `totalPages`, instead of handling a 404 that says nothing about where to go instead |

⚠ `COUNT(*) OVER()` is `bigint`, and `pg` returns `bigint` as a **string** to avoid losing
precision past 2⁵³. `Number()` is applied explicitly on the way out — relying on implicit
coercion is how `"137"` reaches a client as a string and `totalPages` becomes `NaN`.

## 6. Index requirement

`idx_trip_schedule_page` on `(scheduled_on DESC, id DESC) WHERE archived_at IS NULL`.

Three things about its shape, all deliberate:

1. **Direction matches the `ORDER BY`, including the tiebreaker.** ADR-0002 recorded the
   same finding for the keyset lists: a mismatch makes PostgreSQL add an Incremental Sort
   on top of the scan.
2. **`id` is in the index** because a page boundary inside a single day must be stable.
   Two trips on the same date need a deterministic order or the same row can appear on
   two pages for reasons unrelated to concurrency.
3. **Partial on `archived_at IS NULL`** because archived rows are never listed, so they
   have no business occupying the index — and the count inherits the same restriction.

## 7. ★ Conditions that void this ADR

This is the most important section. The decision rests **entirely** on the bound, not on
a preference.

**If any of the following becomes true, the reasoning above is void and this list must
return to keyset:**

| # | Condition |
|---|---|
| **V-1** | A caller can read this list **without** a date range — including via a new endpoint, an export path, or a default that resolves to "everything" |
| **V-2** | The **366-day cap is lifted or widened** materially |
| **V-3** | Row volume inside a *typical* range grows to where the deepest reachable offset is no longer a few hundred rows |
| **V-4** | The list acquires a consumer for which a row seen twice is a **correctness** problem rather than a cosmetic one — reconciliation, billing, an audit export |

★ **V-4 is the one most likely to arrive quietly.** A reporting or accounting feature
reusing this endpoint would inherit O-2 without anyone re-reading this file. If such a
consumer appears, it needs its own read path — not a widened version of this one.

## 8. What this ADR does not decide

- **It does not change ADR-0002.** Keyset remains the default for every other list, and a
  new list starts from keyset unless it can make the argument in §3 for itself.
- **It does not make `OffsetPage<T>` a general-purpose envelope.** The header of
  `offset-page.ts` opens with *"READ THIS BEFORE COPYING THIS FILE INTO A NEW LIST"* for
  this reason.
- **It does not decide pagination for the Driver Portal.** That list is *"the trips
  assigned to me"* — a different filter with a different cardinality, and it must make its
  own argument. See [`../domains/driver-portal/design.md`](../domains/driver-portal/design.md).

## 9. What shipped

| | |
|---|---|
| `OffsetPage<T>` + `toOffsetPage()` | `common/pagination/offset-page.ts` |
| Mandatory-range query with month default and 366-day cap | `common/pagination/date-range-page-query.dto.ts` |
| `COUNT(*) OVER()` in the list query | `capabilities/trip-schedule/persistence/trip-schedule.repository.ts` |
| Index `idx_trip_schedule_page` | migration `0011_trip_schedule.sql` |
| Envelope documented for the frontend | [`../backend/frontend-integration-contract.md`](../backend/frontend-integration-contract.md) |

---

*Recorded after implementation. The reasoning was already carried in the source comments
of `offset-page.ts` and `date-range-page-query.dto.ts`; this ADR is where it belongs, and
those comments now have a stable place to point at.*
