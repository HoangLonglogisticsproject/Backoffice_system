# ADR-0008 — A fuel transaction is a non-financial event over exactly one money row

**Status:** **ACCEPTED** — implemented by migration `0037` (PR-1, backend foundation).

**Date:** 2026-10-08 · **Decided by:** CEO (fuel-ledger scope, 2026-10-07/08), engineering (shape).

**Affects:** `fuel_transactions`, `fuel_transaction_evidence`, `fuel_transaction_enrichments`,
`fuel_match_acks` · `capabilities/trip-schedule` (fuel-* files) · `infrastructure/object-storage` ·
permission `cost.import` · frontend integration contract §31.

---

## 1. Context

Fuel money already lives in two ledgers: a lorry's `vehicle_costs` (0034, flagged lorries on live
turns) and, for older or unflagged runs, a trip's `trip_costs` with `category = 'fuel'`. Accounting must
backfill Zalo-era receipts and attach evidence to fills that already exist, **without** creating a second
cost for the same expense. `trip_costs` holds none of the fill's facts (the lorry, for office lines;
liters; time; station; receipt), and its lines are not ours to rewrite — driver lines stay editable,
approved ones are immutable.

## 2. Decision

1. **A fuel transaction is one real refuelling event for one lorry — not a ledger.** It has no amount;
   no total reads it. Its money is **exactly one** backing row, `vehicle_cost_id` XOR `trip_cost_id`
   (CHECK), with at most one live fill per row (partial unique index).
2. **Each fact has one owner.** Amount: always the backing row. Lorry and day: the vehicle cost (copied,
   pinned by a composite FK to `vehicle_costs (id, vehicle_id, business_date)`), or the fill for a trip
   line. Liters and odometer: the vehicle cost, or the fill for a trip line (a CHECK forbids both). Time,
   driver, station, tax code, document series and number: the fill.
3. **Facts are append-only, field by field.** NULL → value is allowed; the same value is a replay; a
   different value is refused (trigger and service). `fuel_transaction_enrichments` records who added
   which fact, once each. A wrong value is a SuperAdmin correction (void and recreate), never an overwrite.
4. **A trip line's lorry is the office's explicit choice**, never inferred. It must equal the line's own
   snapshot, else be a lorry the trip records; a trip recording none takes the choice (flagged). One line
   belongs to one lorry. **A lorry has no permanent driver** — `driver_user_id` is only the driver known
   to have operated or reported that fill, pinned to the cost's own provenance when it names one.
5. **Evidence belongs to the fuel transaction**, staged by its uploader and attached by a command. The
   same image twice on one fill is refused by a unique index; across fills it is a warning a person
   confirms (PR-2), so `sha256` is not globally unique. Attached evidence is immutable and only retired.
6. **Wrapping is lazy.** A fill row appears the first time its cost receives evidence or a fact; the
   read model shows an unwrapped cost as it stands. The driver write path is untouched (no rollout-window
   risk), and 0037 alters no existing table.
7. **Files never touch PostgreSQL or a public URL.** Keys are content-addressed
   (`fuel-evidence/<sha256>`); production uses a private Cloudflare R2 bucket (SigV4 via `aws4fetch`,
   pinned, payload hash signed); development uses the filesystem. The backend streams an image only to a
   caller it has authorised. No store configured means 503 on the image routes, never a boot failure.

## 3. Consequences

* Accounting gets `cost.import` — the fill being worked on — while `cost.read` stays the SuperAdmin's.
* Trip-line drift after wrapping (re-priced, re-headed, voided) is **flagged, not blocked**.
* The cutoff-dependent ledger extension (`historical_import`, `backoffice_recovery`, correction) is a
  separate migration and does not change this model.
