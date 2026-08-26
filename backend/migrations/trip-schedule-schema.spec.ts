import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Asserts the SHAPE of the trip schedule migration without a database.
 *
 * Same job and same limit as `organization-schema.spec.ts`: this proves the
 * file SAYS the right thing, not that PostgreSQL AGREES — that is the
 * capability's integration spec. What it catches is the class of mistake that
 * survives review and only shows up as corrupted data months later: a missing
 * normalisation index that lets the workbook's duplicate plates back in, a
 * status column with no CHECK, a DELETE the runtime is forbidden to issue.
 */
describe('0011_trip_schedule.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(__dirname, '0011_trip_schedule.sql'), 'utf8');
  });

  const normalized = (): string => sql.replace(/\s+/g, ' ');

  /**
   * The file with its `--` comments stripped.
   *
   * This migration explains its own decisions in prose — it uses the words
   * "delete" and "cost" while arguing against both. A check that greps the raw
   * text would trip over the explanation and report the opposite of the truth.
   */
  const code = (): string => sql.replace(/--[^\n]*/g, '');

  const sectionFor = (table: string): string => {
    const body = code();
    const start = body.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = body.indexOf('CREATE TABLE IF NOT EXISTS', start + 1);
    return (next === -1 ? body.slice(start) : body.slice(start, next)).replace(/\s+/g, ' ');
  };

  it('creates exactly the three trip tables and nothing else', () => {
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(['trip_customers', 'trip_schedules', 'trip_vehicles']);
  });

  it('creates no table for the cost block, which is deliberately not modelled yet', () => {
    // The workbook's second block (DẦU · CẦU TRẠM · PHÍ KHO · BỐC XẾP · TĂNG CA)
    // is filled in on two sheets out of seven. Guessing its shape from a dozen
    // cells would be inventing a schema rather than recording one.
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    for (const premature of ['trip_costs', 'trip_expenses', 'trip_cost_items']) {
      expect(created).not.toContain(premature);
    }
  });

  it('is idempotent, so it can run twice without breaking a deploy', () => {
    const creates = [...sql.matchAll(/CREATE (TABLE|INDEX|UNIQUE INDEX)/g)].length;
    const guarded = [...sql.matchAll(/CREATE (?:TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
  });

  it('re-creates each trigger rather than assuming it is absent', () => {
    for (const table of ['trip_vehicles', 'trip_customers', 'trip_schedules']) {
      expect(normalized()).toContain(`DROP TRIGGER IF EXISTS ${table}_set_updated_at`);
      expect(normalized()).toContain(`CREATE TRIGGER ${table}_set_updated_at`);
    }
  });

  describe('★ the catalogues, which exist to make a misspelt plate unrepresentable', () => {
    it('derives the vehicle matching key in the DATABASE, not in the service', () => {
      // A normalisation the application computes is one a direct INSERT skips,
      // and then the unique index below quietly stops meaning anything.
      expect(sectionFor('trip_vehicles')).toContain(
        "plate_key TEXT GENERATED ALWAYS AS (upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))) STORED",
      );
    });

    it('derives the customer matching key the same way', () => {
      expect(sectionFor('trip_customers')).toContain(
        "name_key TEXT GENERATED ALWAYS AS (upper(trim(regexp_replace(name, '\\s+', ' ', 'g')))) STORED",
      );
    });

    it('makes the key unique among ACTIVE rows, so an archived plate is reusable', () => {
      expect(normalized()).toContain(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_vehicle_plate ON trip_vehicles (plate_key) WHERE status = 'active'",
      );
      expect(normalized()).toContain(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_customer_name ON trip_customers (name_key) WHERE status = 'active'",
      );
    });

    it('constrains the catalogue lifecycle instead of trusting the application', () => {
      expect(sectionFor('trip_vehicles')).toContain("CHECK (status IN ('active', 'archived'))");
      expect(sectionFor('trip_customers')).toContain("CHECK (status IN ('active', 'archived'))");
    });

    it('refuses a blank plate or a blank customer name', () => {
      expect(sectionFor('trip_vehicles')).toContain('CHECK (length(trim(plate)) > 0)');
      expect(sectionFor('trip_customers')).toContain('CHECK (length(trim(name)) > 0)');
    });
  });

  describe('the schedule itself', () => {
    it('dates a trip with DATE, not TIMESTAMPTZ — a dispatch board is a wall calendar', () => {
      expect(sectionFor('trip_schedules')).toContain('scheduled_on DATE NOT NULL');
    });

    it('leaves the vehicle and the customer nullable, because the workbook does', () => {
      // Rows reading `ĐIỀN SAU` are real: a trip is committed to a customer
      // before a truck is assigned. A NOT NULL here forces dispatch to invent one.
      const section = sectionFor('trip_schedules');
      expect(section).toContain('vehicle_id UUID REFERENCES trip_vehicles(id)');
      expect(section).toContain('customer_id UUID REFERENCES trip_customers(id)');
      expect(section).not.toMatch(/vehicle_id\s+UUID\s+NOT NULL/);
      expect(section).not.toMatch(/customer_id\s+UUID\s+NOT NULL/);
    });

    it('gives pickup and delivery full timestamps, so delivery can fall on a later day', () => {
      // The sheet writes `08H30` in one cell and `09H00 SÁNG 04 AUG 2026` in the
      // next. A TIME column cannot hold the second one.
      const section = sectionFor('trip_schedules');
      expect(section).toContain('pickup_at TIMESTAMPTZ');
      expect(section).toContain('delivery_at TIMESTAMPTZ');
      expect(section).not.toMatch(/pickup_at\s+TIME\b/);
      expect(section).not.toMatch(/delivery_at\s+TIME\b/);
    });

    it('★ promotes the row colour to a constrained status column', () => {
      // In the workbook this is fill colour with a legend at the bottom of the
      // sheet. A colour cannot be filtered or counted.
      expect(sectionFor('trip_schedules')).toContain(
        "CHECK (status IN ('awaiting_production', 'awaiting_vehicle', 'needs_confirmation', 'external_booking', 'done'))",
      );
    });

    it('records who wrote the row — the one question the workbook could not answer', () => {
      expect(sectionFor('trip_schedules')).toContain(
        'created_by UUID NOT NULL REFERENCES users(id)',
      );
    });

    it('keeps the two archive columns from disagreeing', () => {
      expect(normalized()).toContain(
        'CHECK ((archived_at IS NULL) = (archived_by IS NULL))',
      );
    });

    it('does NOT cascade trips from users — a person leaving must not erase dispatch history', () => {
      expect(sectionFor('trip_schedules')).not.toContain('ON DELETE CASCADE');

      // And the check really does catch what it claims to.
      expect('created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE').toContain(
        'ON DELETE CASCADE',
      );
    });
  });

  describe('indexes', () => {
    it('★ orders the list index in the SAME direction as the query, tiebreaker included', () => {
      // A mismatched direction costs an Incremental Sort on top of the scan —
      // the finding 0009 recorded for the keyset lists, and it applies here too.
      expect(normalized()).toContain(
        'CREATE INDEX IF NOT EXISTS idx_trip_schedule_page ON trip_schedules (scheduled_on DESC, id DESC) WHERE archived_at IS NULL',
      );
    });

    it('indexes both foreign keys, so archiving one truck does not scan every trip', () => {
      expect(sql).toContain('idx_trip_schedule_vehicle');
      expect(sql).toContain('idx_trip_schedule_customer');
    });
  });

  it('seeds no data — a truck and a customer are entered by staff, not by a migration', () => {
    expect(code().toUpperCase()).not.toContain('INSERT INTO');
  });

  it('issues no DELETE, in line with B13 — the lifecycle is archive', () => {
    expect(code().toUpperCase()).not.toContain('DELETE FROM');
  });

  it('hardcodes no truck, customer or driver from the workbook', () => {
    // The workbook is full of real plates and real company names. None of them
    // belong in schema; they are rows somebody types on the day.
    expect(code()).not.toMatch(/50H4\d{4}|51D\d{5}|BLUE WATER|LESCHACO|KAPV/i);
  });
});
