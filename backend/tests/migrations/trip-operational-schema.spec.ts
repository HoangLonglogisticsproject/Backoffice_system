import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Asserts the SHAPE of the five operational-lifecycle migrations, 0013 to 0017,
 * without a database.
 *
 * Same job and same limit as `trip-schedule-schema.spec.ts`: this proves the
 * files SAY the right thing, not that PostgreSQL AGREES. What it is here to
 * catch is the specific class of mistake these migrations were written to avoid,
 * and which a reviewer reading 900 lines of SQL will not reliably spot:
 *
 *   · a DEFAULT on `ownership`, which would invent a fact about every lorry
 *   · the word `unknown`, which would invent a third kind of lorry
 *   · a `trip_expenses` table, which would split the expense concept in two
 *   · a composite foreign key quietly reduced to a single column
 *   · a partial unique index that is not partial, or not unique
 *
 * Each of those passes code review easily and is discovered later as data that
 * cannot be trusted.
 */
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

const FILES = {
  carrier: '0013_trip_carrier_and_vehicle_ownership.sql',
  assignment: '0014_trip_driver_assignment.sql',
  event: '0015_trip_execution_event.sql',
  cost: '0016_trip_cost_lifecycle.sql',
  completion: '0017_trip_completion_and_history.sql',
} as const;

type Migration = keyof typeof FILES;

const sources = {} as Record<Migration, string>;

/**
 * The file with its `--` comments stripped, whitespace flattened.
 *
 * Every one of these migrations argues in prose for the thing it refuses to do —
 * 0013 explains at length why it will not default `ownership` and why there is
 * no `unknown`, and 0016 explains why there is no `trip_expenses`. A check that
 * grepped the raw text would find those words in the explanation and report the
 * exact opposite of the truth.
 */
const code = (file: Migration): string =>
  sources[file].replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

beforeAll(async () => {
  await Promise.all(
    (Object.keys(FILES) as Migration[]).map(async (key) => {
      sources[key] = await readFile(join(MIGRATIONS_DIR, FILES[key]), 'utf8');
    }),
  );
});

describe('0013 — carriers and vehicle ownership', () => {
  it('adds `ownership` with NO DEFAULT, so no lorry is classified by the migration', () => {
    // The single most important assertion in this file. A DEFAULT here would
    // write an ownership onto every existing vehicle without a human ever
    // asserting one — which is precisely the inference the business forbade.
    const body = code('carrier');
    expect(body).toContain('ADD COLUMN IF NOT EXISTS ownership TEXT');
    expect(body).not.toMatch(/ADD COLUMN IF NOT EXISTS ownership TEXT[^,;]*DEFAULT/i);
  });

  it('adds no NOT NULL to `ownership`, because unclassified is a real state', () => {
    // Scoped to the ADD COLUMN clause: the provenance CHECK further down says
    // `ownership IS NOT NULL` legitimately, and a looser pattern reads that as
    // a column constraint.
    expect(code('carrier')).toContain('ADD COLUMN IF NOT EXISTS ownership TEXT,');
    expect(code('carrier')).not.toMatch(/ADD COLUMN IF NOT EXISTS ownership TEXT NOT NULL/i);
  });

  it('backfills nothing at all', () => {
    // No UPDATE, no INSERT. The classification is a later, evidence-based
    // migration; this one only makes the column exist.
    const body = code('carrier');
    expect(body).not.toMatch(/\bUPDATE\s+trip_vehicles\b/i);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it('has exactly two ownership values and no `unknown`', () => {
    const body = code('carrier');
    expect(body).toContain("ownership IN ('company', 'outsourced')");
    expect(body.toLowerCase()).not.toContain('unknown');
  });

  it('★ pairs ownership with its carrier using CASE, not a disjunction', () => {
    // A real database caught the disjunction spelling accepting an unclassified
    // lorry that names a carrier: `NULL = 'outsourced'` is NULL, `NULL AND true`
    // is NULL, and a CHECK ACCEPTS NULL. `CASE` sends every unmatched value —
    // NULL included — to ELSE, and yields a plain boolean on every branch.
    const body = code('carrier');
    expect(body).toContain('CASE ownership');
    expect(body).toContain("WHEN 'outsourced' THEN carrier_id IS NOT NULL");
    expect(body).toContain("WHEN 'company' THEN carrier_id IS NULL");
    expect(body).toContain('ELSE carrier_id IS NULL');
    // The spelling that was wrong must not come back.
    expect(body).not.toContain("(ownership = 'outsourced' AND carrier_id IS NOT NULL)");
  });

  it('requires an author and a time for every classification', () => {
    // An ownership nobody asserted is the thing this whole design refuses.
    expect(code('carrier')).toContain('trip_vehicles_ownership_provenance');
  });

  it('lets a hire point at a carrier without converting the names already stored', () => {
    // 0012 keeps `carrier_name` as typed on purpose. Matching `xe Út` to a
    // catalogue row is a judgement about who a counterparty is, and a wrong
    // match points historical money at the wrong company.
    const body = code('carrier');
    expect(body).toContain(
      'ALTER TABLE trip_outsource_hires ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES trip_carriers(id)',
    );
    expect(body).not.toMatch(/UPDATE\s+trip_outsource_hires/i);
    expect(body).not.toMatch(/LIKE/i);
  });

  it('gives carriers the same normalised-unique-among-active shape as customers', () => {
    const body = code('carrier');
    expect(body).toContain('name_key TEXT GENERATED ALWAYS AS');
    expect(body).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_carrier_name ON trip_carriers \(name_key\) WHERE status = 'active'/,
    );
  });
});

describe('0014 — driver assignment', () => {
  it('creates no `drivers` table: a driver is a user', () => {
    const created = [...sources.assignment.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
      (m) => m[1],
    );
    expect(created).toEqual(['trip_driver_assignments']);
    expect(created).not.toContain('drivers');
    expect(code('assignment')).toContain('driver_user_id UUID NOT NULL REFERENCES users(id)');
  });

  it('allows at most one ACTIVE assignment per trip, in the database', () => {
    // This index is the entire answer to two operators assigning different
    // drivers at the same instant. Both pass every application check.
    expect(code('assignment')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_active_driver_assignment ON trip_driver_assignments \(trip_id\) WHERE state = 'active'/,
    );
  });

  it('exposes `(id, trip_id)` as a unique key so provenance can be a composite FK', () => {
    expect(code('assignment')).toContain(
      'CONSTRAINT trip_driver_assignments_id_trip UNIQUE (id, trip_id)',
    );
  });

  it('makes the four end columns move together, so history is never half-written', () => {
    const body = code('assignment');
    expect(body).toContain('trip_driver_assignments_end_state');
    expect(body).toContain('trip_driver_assignments_end_reason_not_blank');
  });
});

describe('0015 — execution events', () => {
  it('binds the assignment to the trip with a COMPOSITE foreign key', () => {
    // Reduced to `REFERENCES trip_driver_assignments(id)` this still compiles,
    // still passes every test that inserts sane data, and silently permits an
    // event carrying another trip's assignment.
    expect(code('event')).toContain(
      'FOREIGN KEY (driver_assignment_id, trip_id) REFERENCES trip_driver_assignments (id, trip_id)',
    );
  });

  it('has exactly the four canonical event types', () => {
    const body = code('event');
    for (const type of [
      'ARRIVED_PICKUP',
      'PICKUP_CONFIRMED',
      'ARRIVED_DELIVERY',
      'DELIVERY_CONFIRMED',
    ]) {
      expect(body).toContain(`'${type}'`);
    }
  });

  it('keeps the three clocks apart', () => {
    const body = code('event');
    expect(body).toContain('actual_at TIMESTAMPTZ NOT NULL');
    expect(body).toContain('recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(body).toContain('device_reported_at TIMESTAMPTZ');
  });

  it('snapshots the schedule, so correcting a plan cannot rewrite past KPIs', () => {
    expect(code('event')).toContain('scheduled_at TIMESTAMPTZ');
  });

  it('makes a retried write collide with its own first attempt', () => {
    expect(code('event')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_execution_event_client ON trip_execution_events \(trip_id, client_event_id\)/,
    );
  });

  it('has no `updated_at`, because an event is not edited', () => {
    expect(code('event')).not.toContain('updated_at');
  });
});

describe('0016 — expense lifecycle on trip_costs', () => {
  it('creates no second expense table', () => {
    // `trip_costs` is the canonical expense table. A `trip_expenses` beside it
    // would mean two totals and a permanent argument about which is real.
    const created = [...sources.cost.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(['trip_cost_edits']);
    expect(created).not.toContain('trip_expenses');
  });

  it('defaults `state` to immutable, preserving what the existing API does today', () => {
    // Every row already in the table, and every row the existing `cost.create`
    // route writes, keeps 0012's rule: born final, changeable only by voiding.
    expect(code('cost')).toContain("ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'immutable'");
  });

  it('defaults `source` to backoffice, which is what every existing row is', () => {
    expect(code('cost')).toContain(
      "ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'backoffice'",
    );
  });

  it('has three lifecycle states, with locked distinct from immutable', () => {
    expect(code('cost')).toContain("state IN ('editable', 'locked', 'immutable')");
  });

  it('requires a driver-declared line to name the assignment that declared it', () => {
    expect(code('cost')).toContain(
      "CHECK (source = 'backoffice' OR driver_assignment_id IS NOT NULL)",
    );
  });

  it('forbids fuel and tolls on a hired lorry, reading the snapshot not the vehicle', () => {
    // The carrier absorbs both into its one agreed price. Reading the snapshot
    // means a reclassification years later cannot invalidate a correct old row.
    expect(code('cost')).toContain(
      "CHECK (vehicle_ownership IS DISTINCT FROM 'outsourced' OR category NOT IN ('fuel', 'toll'))",
    );
  });

  it('guards updates with a trigger rather than a convention', () => {
    const body = code('cost');
    expect(body).toContain('CREATE OR REPLACE FUNCTION trip_costs_guard_update()');
    expect(body).toMatch(/CREATE TRIGGER trip_costs_guard_update BEFORE UPDATE ON trip_costs/);
  });

  it('leaves the void trio out of the immutable guard, so voiding still works', () => {
    // Void is not an edit: it records that a figure no longer counts, without
    // changing what it was. The existing `cost.void` route depends on this.
    const guard = code('cost');
    const fn = guard.slice(guard.indexOf('FUNCTION trip_costs_guard_update()'));
    expect(fn).not.toContain('NEW.voided_at');
    expect(fn).not.toContain('NEW.void_reason');
  });

  it('adds no `updated_at` to trip_costs; the edit log answers instead', () => {
    expect(code('cost')).not.toContain('updated_at');
  });

  it('records edits per field, with the value before and after', () => {
    const body = code('cost');
    expect(body).toContain("field TEXT NOT NULL CHECK (field IN ('category', 'amount', 'note'))");
    expect(body).toContain('old_value TEXT');
    expect(body).toContain('new_value TEXT');
  });
});

describe('0017 — completion, history, and the terminal state', () => {
  it('allows at most one pending and at most one approved request per trip', () => {
    const body = code('completion');
    expect(body).toMatch(
      /uq_trip_completion_pending ON trip_completion_requests \(trip_id\) WHERE state = 'pending'/,
    );
    expect(body).toMatch(
      /uq_trip_completion_approved ON trip_completion_requests \(trip_id\) WHERE state = 'approved'/,
    );
  });

  it('refuses a rejection with no reason, in the database', () => {
    // Two existing approval flows collect a reason in the UI and drop it in the
    // API. A driver told only "rejected" cannot act on it.
    expect(code('completion')).toContain(
      "CHECK (state <> 'rejected' OR (decision_reason IS NOT NULL AND length(trim(decision_reason)) > 0))",
    );
  });

  it('★ makes the driver state whether there was any money, with no default', () => {
    // Without this column "nothing to claim" and "the driver forgot" are the
    // same thing: zero rows. NOT NULL and no DEFAULT, so the answer has to be
    // given rather than inherited from anywhere.
    const body = code('completion');
    expect(body).toContain(
      "expense_declaration TEXT NOT NULL CHECK (expense_declaration IN ('none', 'expenses'))",
    );
    expect(body).not.toMatch(/expense_declaration TEXT NOT NULL[^,]*DEFAULT/i);
  });

  it('numbers attempts and never reuses one', () => {
    expect(code('completion')).toMatch(
      /uq_trip_completion_attempt ON trip_completion_requests \(trip_id, attempt_no\)/,
    );
  });

  it('blocks a completed trip from being reopened — T1', () => {
    const body = code('completion');
    expect(body).toContain('CREATE OR REPLACE FUNCTION trip_schedules_guard_done()');
    expect(body).toContain("IF OLD.status = 'done' AND NEW.status <> 'done' THEN");
  });

  it('denies DELETE on every historical table — T3', () => {
    const body = code('completion');
    expect(body).toContain('CREATE OR REPLACE FUNCTION deny_delete()');
    for (const table of [
      'trip_costs',
      'trip_outsource_hires',
      'trip_cost_edits',
      'trip_driver_assignments',
      'trip_execution_events',
      'trip_completion_requests',
      'trip_status_history',
    ]) {
      expect(body).toContain(`BEFORE DELETE ON ${table}`);
    }
  });

  it('records who closed a trip, alongside the board status', () => {
    const body = code('completion');
    expect(body).toContain('ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ');
    expect(body).toContain('ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id)');
    expect(body).toContain('trip_schedules_closed_state');
  });

  it('gives the driver a field written for them, rather than filtering the others', () => {
    expect(code('completion')).toContain('ADD COLUMN IF NOT EXISTS driver_instructions TEXT');
  });

  it('keeps status history insert-only, with both ends of every transition', () => {
    const body = code('completion');
    expect(body).toContain('from_status TEXT');
    expect(body).toContain('to_status TEXT NOT NULL');
    expect(body).toContain('changed_by UUID NOT NULL REFERENCES users(id)');
    expect(body).not.toMatch(/trip_status_history[\s\S]{0,400}updated_at/);
  });
});

describe('all five migrations', () => {
  const each = Object.keys(FILES) as Migration[];

  it('are idempotent, so a re-run cannot break a deploy', () => {
    for (const file of each) {
      const creates = [...sources[file].matchAll(/CREATE (TABLE|INDEX|UNIQUE INDEX)\b/g)].length;
      const guarded = [
        ...sources[file].matchAll(/CREATE (?:TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/g),
      ].length;
      expect([file, guarded]).toEqual([file, creates]);
    }
  });

  it('drop every ALTER-added constraint before adding it, so ALTER can run twice', () => {
    for (const file of each) {
      const added = [...sources[file].matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
      const dropped = new Set(
        [...sources[file].matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)].map((m) => m[1]),
      );
      for (const name of added) {
        expect([file, name, dropped.has(name)]).toEqual([file, name, true]);
      }
    }
  });

  it('drop every trigger before creating it', () => {
    for (const file of each) {
      const created = [...sources[file].matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]);
      const dropped = new Set(
        [...sources[file].matchAll(/DROP TRIGGER IF EXISTS (\w+)/g)].map((m) => m[1]),
      );
      for (const name of created) {
        expect([file, name, dropped.has(name)]).toEqual([file, name, true]);
      }
    }
  });

  it('never DROP a column or a table: forward-only means additive', () => {
    for (const file of each) {
      expect([file, /DROP\s+(COLUMN|TABLE)/i.test(code(file))]).toEqual([file, false]);
    }
  });

  it('seed no business data', () => {
    for (const file of each) {
      expect([file, /\bINSERT\s+INTO\b/i.test(code(file))]).toEqual([file, false]);
    }
  });
});
