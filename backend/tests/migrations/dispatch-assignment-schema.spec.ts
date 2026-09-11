import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Asserts the SHAPE of the multi-vehicle migrations, 0027 to 0029, without a
 * database.
 *
 * Same job and same limit as `trip-operational-schema.spec.ts`: this proves the
 * files SAY the right thing, not that PostgreSQL AGREES — the integration spec
 * beside it does that. What it is here to catch is the class of mistake these
 * migrations were written to avoid, each of which passes a code review easily:
 *
 *   · a unique index on `(trip_id, driver_user_id)`, which would refuse the
 *     confirmed business case of one driver on several lorries of one trip
 *   · a NOT NULL on the new column, which would refuse the production rows that
 *     pre-date it
 *   · a CHECK added without `NOT VALID`, which would do the same
 *   · a backfill that reads `trip_schedules.vehicle_id` for an ENDED turn, or
 *     that overwrites a value already set
 *   · a DROP of the legacy column, a DELETE, a renamed or edited old file
 *   · 0028 dropping the trip-side index coverage without replacing it
 */
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

const FILES = {
  vehicle: '0027_dispatch_assignment_vehicle.sql',
  completion: '0028_completion_per_assignment.sql',
  backfill: '0029_backfill_assignment_vehicle.sql',
} as const;

type Migration = keyof typeof FILES;

const sources = {} as Record<Migration, string>;

/** The file with its `--` comments stripped, whitespace flattened. */
const code = (file: Migration): string =>
  sources[file].replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

beforeAll(async () => {
  await Promise.all(
    (Object.keys(FILES) as Migration[]).map(async (key) => {
      sources[key] = await readFile(join(MIGRATIONS_DIR, FILES[key]), 'utf8');
    }),
  );
});

describe('0027 — the assignment gains its lorry', () => {
  it('adds `vehicle_id` NULLABLE, with a foreign key and no default', () => {
    // Production holds active assignments on trips with no lorry. A NOT NULL
    // would refuse the file; a DEFAULT would invent a lorry for them.
    expect(code('vehicle')).toContain(
      'ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES trip_vehicles(id)',
    );
    expect(code('vehicle')).not.toMatch(/vehicle_id UUID[^,;]*NOT NULL/);
    expect(code('vehicle')).not.toMatch(/vehicle_id UUID[^,;]*DEFAULT/);
  });

  it('★ replaces the one-driver-per-trip index with one-turn-per-lorry, in one file', () => {
    expect(code('vehicle')).toContain('DROP INDEX IF EXISTS uq_trip_active_driver_assignment');
    expect(code('vehicle')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_active_vehicle_assignment ON trip_driver_assignments \(trip_id, vehicle_id\) WHERE state = 'active'/,
    );
  });

  it('★ puts NO uniqueness on the driver — one person, several lorries, is the business', () => {
    expect(code('vehicle')).not.toMatch(/\(\s*trip_id\s*,\s*driver_user_id\s*\)/);
    expect(code('vehicle')).not.toMatch(/\(\s*driver_user_id\s*,\s*trip_id\s*\)/);
  });

  it('requires a lorry on every ACTIVE row written from now on — as a CHECK that is NOT VALID', () => {
    // `NOT VALID`: enforced for new rows, skipped for the ones that exist. The
    // validation is a later file, gated on the counts 0029 reports.
    expect(code('vehicle')).toMatch(
      /ADD CONSTRAINT trip_driver_assignments_active_has_vehicle CHECK \(state <> 'active' OR vehicle_id IS NOT NULL\) NOT VALID/,
    );
  });

  it('guards the constraint through pg_constraint, so a rerun does nothing', () => {
    // `ADD CONSTRAINT` has no `IF NOT EXISTS`; `DROP ... IF EXISTS` + `ADD`
    // would re-run on a rerun. The DO block is what makes the file idempotent.
    expect(code('vehicle')).toMatch(/IF NOT EXISTS \( SELECT 1 FROM pg_constraint WHERE conname = 'trip_driver_assignments_active_has_vehicle'/);
  });

  it('indexes the new foreign key, partially, as 0013 did for the carrier', () => {
    expect(code('vehicle')).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_trip_driver_assignment_vehicle ON trip_driver_assignments \(vehicle_id\) WHERE vehicle_id IS NOT NULL/,
    );
  });

  it('bounds its ACCESS EXCLUSIVE locks with lock_timeout, as 0010 does', () => {
    expect(code('vehicle')).toContain("SET LOCAL lock_timeout = '5s'");
    expect(code('completion')).toContain("SET LOCAL lock_timeout = '5s'");
  });

  it('★ leaves the legacy column, every history index and the composite key alone', () => {
    for (const file of ['vehicle', 'completion', 'backfill'] as const) {
      expect(code(file)).not.toMatch(/DROP COLUMN/i);
      expect(code(file)).not.toMatch(/DROP TABLE/i);
      expect(code(file)).not.toMatch(/DELETE FROM/i);
      expect(code(file)).not.toMatch(/idx_trip_driver_assignment_driver_history/);
      expect(code(file)).not.toMatch(/trip_driver_assignments_id_trip/);
    }
  });
});

describe('0028 — completion belongs to the assignment', () => {
  it('refuses to run over data the new scopes would reject, rather than deleting it', () => {
    expect(code('completion')).toMatch(/RAISE EXCEPTION/);
    expect(code('completion')).toMatch(/HAVING count\(\*\) > 1/);
    expect(code('completion')).not.toMatch(/DELETE\s+FROM/i);
  });

  it('★ re-scopes all three uniqueness rules from the trip to the assignment', () => {
    for (const old of ['uq_trip_completion_pending', 'uq_trip_completion_approved', 'uq_trip_completion_attempt']) {
      expect(code('completion')).toContain(`DROP INDEX IF EXISTS ${old}`);
    }
    expect(code('completion')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_completion_pending ON trip_completion_requests \(driver_assignment_id\) WHERE state = 'pending'/,
    );
    expect(code('completion')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_completion_approved ON trip_completion_requests \(driver_assignment_id\) WHERE state = 'approved'/,
    );
    expect(code('completion')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_completion_attempt ON trip_completion_requests \(driver_assignment_id, attempt_no\)/,
    );
  });

  it('★ keeps the trip-side read indexed — the dropped unique was also that index', () => {
    // `listByTrip` and the review queue read by `trip_id` and order by
    // `attempt_no`. The shape mirrors the queries, never `submitted_at`.
    expect(code('completion')).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_trip_completion_trip_attempt ON trip_completion_requests \(trip_id, attempt_no DESC\)/,
    );
    expect(code('completion')).not.toMatch(/submitted_at/);
  });

  it('does not clean up `idx_trip_completion_assignment` as a side effect', () => {
    expect(code('completion')).not.toMatch(/DROP INDEX IF EXISTS idx_trip_completion_assignment/);
  });
});

describe('0029 — the backfill', () => {
  it('★ guards every UPDATE with `vehicle_id IS NULL`, so a rerun rewrites nothing', () => {
    const updates = code('backfill').match(/UPDATE trip_driver_assignments[^;]*;/g) ?? [];
    expect(updates).toHaveLength(3);
    for (const update of updates) expect(update).toContain('a.vehicle_id IS NULL');
  });

  it('copies the trip’s legacy lorry onto ACTIVE turns only — case A', () => {
    const [caseA] = code('backfill').match(/UPDATE trip_driver_assignments[^;]*;/g) ?? [];
    expect(caseA).toContain('FROM trip_schedules t');
    expect(caseA).toContain("a.state = 'active'");
    expect(caseA).toContain('t.vehicle_id IS NOT NULL');
  });

  it('★ never reads the trip’s lorry for an ENDED turn — cases C and D use the turn’s own snapshots', () => {
    const updates = code('backfill').match(/UPDATE trip_driver_assignments[^;]*;/g) ?? [];
    const ended = updates.filter((update) => update.includes("a.state = 'ended'"));
    expect(ended).toHaveLength(2);
    for (const update of ended) {
      expect(update).not.toContain('trip_schedules');
      expect(update).toContain('HAVING count(DISTINCT vehicle_id) = 1');
      expect(update).toContain('voided_at IS NULL');
    }
    expect(ended[0]).toContain('FROM trip_execution_events');
    expect(ended[1]).toContain('FROM trip_costs');
  });

  it('invents nothing for a trip with a legacy lorry and no crew — case F', () => {
    expect(code('backfill')).not.toMatch(/INSERT INTO trip_driver_assignments/i);
    expect(code('backfill')).not.toMatch(/INSERT INTO/i);
  });

  it('reports the counts the 0030 gate needs, and asserts the invariant the index already holds', () => {
    expect(code('backfill')).toMatch(/RAISE NOTICE '0029 backfill: case B/);
    expect(code('backfill')).toMatch(/RAISE NOTICE '0029 backfill: case F/);
    expect(code('backfill')).toMatch(/RAISE EXCEPTION '0029: %/);
  });

  it('does NOT validate the constraint — that is a later file, after Operations has re-crewed case B', () => {
    expect(code('backfill')).not.toMatch(/VALIDATE CONSTRAINT/i);
  });
});

describe('the migration directory', () => {
  it('★ has no duplicate number and no file renamed out of sequence', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
    const numbers = files.map((name) => name.slice(0, 4));

    expect(new Set(numbers).size).toBe(numbers.length);
    numbers.forEach((number, index) => expect(Number(number)).toBe(index + 1));
    expect(files).toEqual(expect.arrayContaining(Object.values(FILES)));
  });

  it('★ never constrains one driver to one turn per trip, anywhere', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql'));
    for (const file of files) {
      const sql = (await readFile(join(MIGRATIONS_DIR, file), 'utf8')).replace(/--[^\n]*/g, '');
      expect([file, /UNIQUE[\s\S]{0,200}?\(\s*trip_id\s*,\s*driver_user_id\s*\)/i.test(sql)]).toEqual([file, false]);
    }
  });
});
