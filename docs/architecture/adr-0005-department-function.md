# ADR-0005 — `departments.function` is the unit's business classification, and it stays

**Status:** **ACCEPTED** — no new migration; `0032` stands as applied.
**Amended 2026-09-18** by [ADR-0006](adr-0006-trip-pricing-and-operational-permissions.md): a
fourth function, `customer_service`, added by migration `0033` (CHECK widened, nothing else).

**Date:** 2026-09-17 · **Decided by:** engineering, on the CEO's authorization rules of
2026-09-17 (DL-101, DL-109).

**Affects:** `departments` · `DepartmentService.create` · `POST /departments` ·
`core/authorization` (`orFunction` / `withinFunction`) · the frontend integration contract §5.

---

## 1. Question

Production has departments called Sales, Accounting and Dispatch whose `function` is
`NULL`, so their members hold none of `trip.create` / `trip.read` / `trip.price.read`. Is
`departments.function` (0032) a redundant abstraction — could authorization read the
department's own identity instead?

## 2. What a department actually carries

| Column | Nature | Usable to authorize? |
|---|---|---|
| `id` | UUID, generated | No — a literal id in code is configuration hidden in source, and differs per deployment |
| `slug` | text typed by the creator, unique, **immutable** | No — it is a URL handle, not a classification: `sales`, `kinh-doanh`, `sales-hcm` and `sls` are all valid slugs for a sales unit, and a slug typed wrong cannot be corrected without recreating the unit and every membership in it |
| `name` | display text, renamed freely | No — the rule the CEO set forbids it, and a rename would silently move permissions |
| `status` | active / archived | Lifecycle, not kind |
| `function` | closed set `sales · accounting · dispatch · customer_service · NULL` (three values at 0032; `customer_service` added by 0033), CHECK-constrained | **Yes** — it is the one column whose *values are named by code* (`PermissionRequirement.orFunction`), so it cannot drift from the requirement table, and it is correctable in place |

Membership (`department_memberships`) says *where a person sits* and nothing else. Roles
(`role_assignments`) say *how senior a person is*. Neither can say *what kind of unit this
is*, which is the question `trip.*` asks (DL-109: head and member of one function are equal).

## 3. Why not the alternatives

- **Authorize by `slug`.** Same configuration burden as `function` (somebody must still
  type the right value), but immutable, so a mistake means recreating the unit; and a
  business function split across two units (`sales-hcm`, `sales-hn`) is impossible without
  code knowing every slug. Rejected.
- **A department `type` column.** That *is* `function` under another name.
- **Roles SALES / ACCOUNTING / DISPATCH.** Refused by the business: they would be granted
  per person, drift from membership, and put head and member on different footings.
- **Seed the three rows in a migration.** Names and slugs are data the customer chose;
  a migration that guesses which row is Sales would be authorizing by name.

## 4. Decision

Keep `departments.function` exactly as 0032 defines it. Close the operational gap instead:

1. **A unit can be created with its function** — `POST /departments { slug, name, function? }`.
   A business unit is therefore never in the state "created, but its members hold nothing".
2. **A unit can be reclassified** — `PATCH /departments/:id { function }` (existing), with
   `name` and `function` in one transaction.
3. **`null` is a valid, deliberate value** meaning *an ordinary unit*. No default other than
   `null`; no NOT NULL; no seed. Which units are business units is a fact only the
   administrator knows.
4. **Owner: SuperAdmin** (`unit.write` is global-only). Setting a function is configuration
   of the deployment, done once per unit, read by authorization on the next request.

## 5. Production — the original rollout (2026-09-17, historical)

At the time of this decision the deployment held three business units. They were
reclassified once by a SuperAdmin:

```http
PATCH /departments/<sales-id>      { "function": "sales" }
PATCH /departments/<accounting-id> { "function": "accounting" }
PATCH /departments/<dispatch-id>   { "function": "dispatch" }
```

No migration, no downtime, no history rewrite; members hold the permissions on their next
request. `0032` is not edited. The fourth unit (Customer Service) and the Accounting unit
are created *with* their function through `POST /departments` — see ADR-0006 §3.

## 6. Consequences

- Authorization is `User → active membership → department.function → permissions`; the
  frontend reads the resulting `permissions` from `GET /authorization/me` and nothing else.
- A newly created business unit must be created *with* its function; the contract says so.
- **Current function set (operative):** `sales · accounting · dispatch · customer_service ·
  NULL`. Customer Service was deferred when this ADR was written and is **no longer**: it is a
  function of its own since ADR-0006 / DL-113, added by migration `0033` (CHECK widened,
  nothing seeded). Adding a further function stays what it was — one value in the CHECK, one
  value in `DEPARTMENT_FUNCTIONS`, and a requirement row.
- Catalogue *edit/archive* ownership remains deferred (creation was split by DL-112).
