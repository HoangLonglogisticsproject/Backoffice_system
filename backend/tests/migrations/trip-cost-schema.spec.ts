import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Asserts the SHAPE of the trip cost migration without a database.
 *
 * Same job and same limit as `trip-schedule-schema.spec.ts`: this proves the
 * file SAYS the right thing, not that PostgreSQL AGREES — that is
 * `trip-cost.integration.spec.ts`. What it catches is the class of mistake that
 * survives review and only shows up as wrong money months later: a float amount
 * that drifts, a category list that quietly grew a catch-all, an `updated_at`
 * that invites an in-place edit of a financial record.
 *
 * ★ SEVERAL CASES HERE ASSERT AN ABSENCE, and the file argues in prose against
 * most of the things it must not contain. Every such check therefore runs
 * against `code()` — the SQL with `--` comments stripped — or the raw text would
 * trip over the explanation and report the opposite of the truth.
 */
describe('0012_trip_cost.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0012_trip_cost.sql'), 'utf8');
  });

  /** The file with its `--` comments stripped. */
  const code = (): string => sql.replace(/--[^\n]*/g, '');

  const normalized = (): string => code().replace(/\s+/g, ' ');

  const sectionFor = (table: string): string => {
    const body = code();
    const start = body.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = body.indexOf('CREATE TABLE IF NOT EXISTS', start + 1);
    return (next === -1 ? body.slice(start) : body.slice(start, next)).replace(/\s+/g, ' ');
  };

  it('creates exactly the two cost tables and nothing else', () => {
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(['trip_costs', 'trip_outsource_hires']);
  });

  it('★ does not create a carrier catalogue — the shape is not settled yet', () => {
    expect(normalized()).not.toContain('trip_carriers');
  });

  it('is idempotent, so it can run twice without breaking a deploy', () => {
    const creates = [...code().matchAll(/CREATE (TABLE|INDEX)/g)].length;
    const guarded = [...code().matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
  });

  it('★ leaves 0011 alone — no ALTER, and nothing added to trip_schedules', () => {
    // The whole design rests on money living in its own tables: an amount on
    // `trip_schedules` would reach every reader of the board.
    expect(code()).not.toMatch(/ALTER TABLE/i);
    expect(normalized()).not.toMatch(/trip_schedules \w+ (NUMERIC|BIGINT|MONEY)/i);
  });

  it('issues no DELETE, in line with B13 — the lifecycle is void', () => {
    expect(code()).not.toMatch(/\bDELETE\b/i);
    expect(code()).not.toMatch(/ON DELETE CASCADE/i);
  });

  it('seeds no data — a cost is entered by staff, not by a migration', () => {
    expect(code()).not.toMatch(/\bINSERT INTO\b/i);
  });

  describe('★ money is exact, never approximate', () => {
    it.each(['trip_costs', 'trip_outsource_hires'])('types the amount NUMERIC(14,2) in %s', (table) => {
      expect(sectionFor(table)).toMatch(/NUMERIC\(14,2\)/);
    });

    it.each(['trip_costs', 'trip_outsource_hires'])('never uses a float type in %s', (table) => {
      expect(sectionFor(table)).not.toMatch(/\b(REAL|FLOAT|DOUBLE PRECISION)\b/i);
    });

    it('refuses a zero or negative amount on both tables', () => {
      expect(sectionFor('trip_costs')).toMatch(/CHECK \(amount > 0\)/);
      expect(sectionFor('trip_outsource_hires')).toMatch(/CHECK \(agreed_amount > 0\)/);
    });

    it('carries no currency column — one operator, one country', () => {
      expect(normalized()).not.toMatch(/\bcurrency\b/i);
    });
  });

  describe('★ the five categories, and no sixth', () => {
    it('constrains the category to exactly the workbook headings', () => {
      const section = sectionFor('trip_costs');
      for (const value of ['fuel', 'toll', 'warehouse', 'loading', 'overtime']) {
        expect(section).toContain(`'${value}'`);
      }
    });

    it('★ has no catch-all bucket', () => {
      // A taxonomy with an `other` stops being a taxonomy within a year.
      expect(sectionFor('trip_costs')).not.toMatch(/'other'/);
      expect(sectionFor('trip_costs')).not.toMatch(/'misc'/);
    });

    it('★ does not include `allowance`, which has no business evidence', () => {
      expect(normalized()).not.toMatch(/'allowance'/);
    });

    it('is a CHECK rather than a comment, so the database refuses a sixth value', () => {
      expect(sectionFor('trip_costs')).toMatch(/category TEXT NOT NULL CHECK \(category IN \(/);
    });
  });

  describe('★ financial records are immutable', () => {
    it.each(['trip_costs', 'trip_outsource_hires'])('gives %s no updated_at column', (table) => {
      // The one place this schema differs from every other table in the repo.
      // An `updated_at` advertises an in-place edit that must never happen to
      // money: a wrong figure is voided and re-entered, not overwritten.
      expect(sectionFor(table)).not.toMatch(/\bupdated_at\b/);
    });

    it('installs no updated_at trigger for either table', () => {
      expect(code()).not.toMatch(/set_updated_at/);
      expect(code()).not.toMatch(/CREATE TRIGGER/i);
    });

    it('still records who wrote the row and when', () => {
      for (const table of ['trip_costs', 'trip_outsource_hires']) {
        expect(sectionFor(table)).toMatch(/created_by UUID NOT NULL REFERENCES users\(id\)/);
        expect(sectionFor(table)).toMatch(/created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
      }
    });
  });

  describe('★ void state moves as one', () => {
    it.each(['trip_costs', 'trip_outsource_hires'])(
      'keeps the three void columns from disagreeing in %s',
      (table) => {
        const section = sectionFor(table);
        expect(section).toMatch(/CONSTRAINT \w+_void_state/);
        expect(section).toMatch(/voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL/);
        expect(section).toMatch(
          /voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL/,
        );
      },
    );

    it.each(['trip_costs', 'trip_outsource_hires'])('refuses a blank void reason in %s', (table) => {
      expect(sectionFor(table)).toMatch(/void_reason IS NULL OR length\(trim\(void_reason\)\) > 0/);
    });
  });

  describe('the outsourced hire', () => {
    it('records the carrier as a NAME, with no foreign key yet', () => {
      const section = sectionFor('trip_outsource_hires');
      expect(section).toMatch(/carrier_name TEXT NOT NULL CHECK \(length\(trim\(carrier_name\)\) > 0\)/);
      expect(section).not.toMatch(/carrier_id/);
    });

    it('records whether the agreed figure already contains VAT', () => {
      expect(sectionFor('trip_outsource_hires')).toMatch(
        /amount_includes_vat BOOLEAN NOT NULL DEFAULT false/,
      );
    });

    it('★ computes no VAT — that is not specified yet', () => {
      // A record of what the figure MEANS, not an accounting calculation.
      expect(normalized()).not.toMatch(/\bvat_rate\b/);
      expect(normalized()).not.toMatch(/\bvat_amount\b/);
    });

    it('keeps the document it came from', () => {
      expect(sectionFor('trip_outsource_hires')).toMatch(/document_ref TEXT/);
    });
  });

  describe('indexes', () => {
    it.each([
      ['idx_trip_cost_trip', 'trip_costs'],
      ['idx_trip_outsource_hire_trip', 'trip_outsource_hires'],
    ])('%s indexes one trip\u2019s records', (index, table) => {
      expect(normalized()).toContain(
        `CREATE INDEX IF NOT EXISTS ${index} ON ${table} (trip_id)`,
      );
    });

    it.each(['idx_trip_cost_trip', 'idx_trip_outsource_hire_trip'])(
      '\u2605 %s is NOT partial, so the audit read can use it',
      (index) => {
        // A partial index on `voided_at IS NULL` cannot serve the read that
        // deliberately INCLUDES voided records, which then falls back to a
        // sequential scan of the whole table.
        const definition = normalized().slice(normalized().indexOf(index));
        expect(definition.slice(0, definition.indexOf(';'))).not.toContain('WHERE voided_at IS NULL');
      },
    );

    it('★ does NOT make (trip_id, category) unique', () => {
      // Two fuel fills on one run is ordinary data. A unique index there would
      // refuse the second one.
      expect(normalized()).not.toMatch(/UNIQUE INDEX[^;]*trip_costs \(trip_id, category\)/);
      expect(code()).not.toMatch(/CREATE UNIQUE INDEX/i);
    });
  });

  describe('★ nothing that anticipates an unmade decision', () => {
    it.each([
      'invoice',
      'payment',
      'revenue',
      'profit',
      'margin',
      'recharge',
      'shipment',
      'approval',
      'approved_by',
    ])('models no %s', (concept) => {
      expect(normalized().toLowerCase()).not.toContain(concept);
    });

    it('adds no status column to anything', () => {
      expect(normalized()).not.toMatch(/\bstatus\b/);
    });
  });
});
