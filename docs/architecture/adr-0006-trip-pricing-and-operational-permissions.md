# ADR-0006 — Trip pricing and operational permissions by department function

**Status:** **ACCEPTED and IMPLEMENTED** — migration `0033`; `PERMISSION_REQUIREMENT`.

**Date:** 2026-09-18 · **Decided by:** CEO (business rules), engineering (shape).

**Affects:** `core/authorization/domain/permission.ts` · `departments.function` (0033) ·
`POST /trip-vehicles` · `POST /trip-customers` · `POST /trip-locations` ·
`POST /trip-customers/:id/locations` · `POST /driver-account-requests` · frontend
create controls and price fields · the frontend integration contract §14.

---

## 1. Rules (CEO, 2026-09-18)

| | Trip create | Customer | Location | Vehicle | Price read/write | Dispatch | Driver request | Completion review |
|---|---|---|---|---|---|---|---|---|
| SUPERADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kế toán (`accounting`) | ✓ | ✓ | ✓ | ✗ | **✓** | ✗ | ✗ | ✗ |
| Sales (`sales`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Customer Service (`customer_service`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Điều phối (`dispatch`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ |
| any other unit, driver | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Head and member of one function are equal on every cell. `trip.write` (correcting a
row, catalogue edit/archive) is unchanged: a head within sales / accounting / dispatch.

## 2. Decisions

1. **Prices are accounting's.** `trip.price.read` and `trip.price.write` both become
   `global ∨ {accounting}`. The read/write split stays so the two can diverge again
   without touching a route. No backend mechanism changes: `redactPrices` on every read,
   `requirePriceAuthority` on create (a price key from a non-holder is **403, never
   stripped**; a holder must give `sellPrice`), `requirePatchAuthority` per field on
   patch. Sales, customer service and dispatch therefore create trips **unpriced**;
   accounting prices them afterwards through the existing price-only patch.
2. **Master data is split from booking.** `trip.create` gates only `POST /trip-schedules`.
   Three new keys, in the repo's `<resource>.<action>` convention: `customer.create`,
   `location.create` (all four booking functions) and `vehicle.create` (dispatch only —
   the fleet is an operational asset, and a booker must not be able to invent a lorry).
   Catalogue edit/archive ownership is **not** redesigned: still `trip.write`.
3. **Customer service is a function.** `customer_service` joins `DEPARTMENT_FUNCTIONS`;
   migration `0033` widens the CHECK (`DROP CONSTRAINT IF EXISTS` + `ADD`, one transaction,
   no row touched, no seed). `0032` is not edited. Customer service holds `trip.read`,
   `trip.create`, `customer.create`, `location.create` — and **not** `trip.write`.
4. **Proposing a driver is dispatch's.** `driver.account.request` moves from
   `head-anywhere` to `global ∨ {dispatch}`. Approving stays `user.write` (global).
5. Unchanged: `dispatch.write`, the assignment model, `trip.complete.review` (global
   only, architecture-pinned), `cost.*`, the three roles, drivers as `account_type`.

## 3. Production rollout

1. `0033` runs in the release job before the backend is replaced (CHECK only; old
   backend + new CHECK is valid, new backend + old CHECK is not — hence "migrate first").
2. Backend, then frontend deploy. Immediately, on the units already classified:
   - **Sales** loses `trip.price.read` and vehicle creation; keeps booking and customer /
     location creation.
   - **Vận hành (dispatch)** loses `trip.price.read` / `trip.price.write`; keeps
     `dispatch.write` and `vehicle.create`; and **every member gains
     `driver.account.request`** — it was `head-anywhere`, so only the unit's head (and
     heads elsewhere) held it; it is now `global ∨ dispatch`, head or member alike.
   - Heads of every *other* unit lose `driver.account.request`.
3. SuperAdmin creates the two missing units with their function
   (`POST /departments { slug, name, function: "accounting" | "customer_service" }`)
   and moves people in (`POST /users { departmentId }` / `POST /departments/:id/members`).
4. Authorization reads the function on the next request; the frontend reloads
   `/authorization/me`. Nothing is seeded, nothing is guessed from a name.
5. Rollout verification, each after a reload of `/authorization/me`:
   - a **non-head** Vận hành member: `permissions` contains `driver.account.request`,
     `dispatch.write`, `vehicle.create` and no `trip.price.*`; `POST /driver-account-requests`
     → 201;
   - a Sales member: no `trip.price.*`, no `vehicle.create`; `GET /trip-schedules/:id` shows
     `sellPrice: null`; `POST /trip-vehicles` → 403;
   - an Accounting member (once the unit exists): `PATCH /trip-schedules/:id { sellPrice }`
     → 200;
   - a head of a non-business unit: `POST /driver-account-requests` → 403.
