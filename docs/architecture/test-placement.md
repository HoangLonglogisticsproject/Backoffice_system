# Test placement

**Status:** ACTIVE · **Date:** 2026-08-27 · **Enforced by:** `backend/scripts/check-boundaries.sh` (B14)

## The rule

| Kind of test | Lives | Named |
|---|---|---|
| Unit | beside the module it tests | `*.spec.ts` |
| Component | beside the component | `*.spec.tsx` |
| Security / authorization | **beside the guard or controller it protects** | `*.security.spec.ts` |
| Race / concurrency, **no database** | beside the module it tests | `*.race.spec.ts` |
| PostgreSQL or HTTP integration | `<workspace>/tests/integration/` | `*.integration.spec.ts` |
| Migration SQL tests | `backend/tests/migrations/` | `*-schema.spec.ts`, `*.integration.spec.ts` |
| Helpers, fixtures, setup | `<workspace>/tests/helpers/` | — |

Two rules that are not negotiable:

1. **`src/` contains no test helpers and no infrastructure-dependent test.** Production directories hold production code plus the specs that need nothing but it.
2. **A test that needs infrastructure must not hide inside normal unit discovery.** `npm test` must never be able to report it as pending.

## Folder says *what*, filename says *what it needs*

These are deliberately independent.

A spec lives in the folder its **subject** belongs to. Its **filename** declares whether it needs infrastructure. That is why `backend/tests/migrations/` can hold five DB-free schema specs beside one `*.integration.spec.ts` without either landing in the wrong command — discovery keys on the name, not the directory.

```text
npm test              →  everything EXCEPT *.integration.spec.ts
npm run test:integration  →  ONLY *.integration.spec.ts, and fails without a database
```

## Why hybrid, and not a single `tests/` tree

Two reasons, both measured rather than assumed.

**Security specs stay next to the code they constrain.** Every one is in-process Supertest against a mocked module — closer to a unit test than an integration test. More importantly, `users.security.spec.ts` sitting beside `users.controller.ts` means a change to a guard and the test that constrains it appear in the *same diff hunk*. During the Employee Management milestone that adjacency is what surfaced a broken contract and an assertion-free test. Moving them apart would make authorization regressions less visible in review, which is the opposite of what a security test is for.

**Colocated unit tests import their subject as `./Subject`.** All twelve frontend `.spec.tsx` files do. Moving them would rewrite every import to buy nothing: a unit test's whole value is proximity to the one function it covers.

What *does* earn a move is the tests that need a database or a server. Those were previously indistinguishable by location from pure unit tests, and they self-skipped when `DATABASE_URL_TEST` was absent — so `npm test` reported **932 tests** locally with **261 silently pending**. "The integration tests passed" and "the integration tests never ran" looked identical from the outside.

## What that ambiguity cost, and what replaced it

| | Before | After |
|---|---|---|
| `npm test`, no database | 932 total, **261 pending**, exit 0 | **671 run, 0 pending** |
| `npm run test:integration`, no database | *(did not exist)* | **fails**, naming the variable |
| `npm run test:integration`, with database | *(did not exist)* | **261 run** |

`backend/tests/helpers/require-database.ts` is what makes the failure explicit: it runs before any spec is collected. The per-file `TEST_URL ? describe : describe.skip` guards remain, because they are still right when somebody runs a single file directly — they are simply no longer how a whole suite decides.

## The destructive-test safety contract

These specs truncate tables and one drops the `public` schema, so "is a database reachable" is the wrong question. `require-database.ts` requires **all three**, and each is defeatable alone:

| | Condition | Rules out |
|---|---|---|
| 1 | `ALLOW_DESTRUCTIVE_DB_TESTS=1` | an inherited `DATABASE_URL_TEST` from another shell |
| 2 | host is loopback | staging, and any remote database however named |
| 3 | database name in an **exact allowlist** — `backoffice_itest`, `backoffice_test` | `production_test`, `customer-testing`, `latest_backup` |

A substring match on `test` accepts all three of those names; that is why the allowlist is a closed set and adding to it is a visible edit. CI states the opt-in on the single step that needs it, against the `backoffice_itest` it drops and recreates for that run.

The same reasoning applies to where a password may be sent. `frontend/tests/helpers/integration-credentials.ts` posts a SuperAdmin credential to `/auth/login`, so it refuses plain HTTP to anything but loopback while allowing HTTPS anywhere — the rule is about the wire, not the word "localhost".

## Adding a test

- Needs nothing but the module → put it beside the module.
- Needs PostgreSQL or a running server → `tests/integration/`, name it `*.integration.spec.ts`.
- Protects a guard → beside the guard, `*.security.spec.ts`.
- Needs a helper → `tests/helpers/`, never `src/`.

**B14 fails the build** if a `*.integration.spec.ts` appears under `backend/src/`. Without it such a file is skipped by `npm test` (ignored by pattern) *and* missed by `test:integration` (which only matches `tests/`) — a test that never runs, with nothing red anywhere.
