import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

/**
 * The cost tables against a REAL PostgreSQL.
 *
 * ★ THIS SPEC TALKS SQL, NOT SERVICES, AND THAT IS THE POINT. `0012` ships
 * before any endpoint does, so the only thing that can be wrong yet is the
 * schema — and the whole value of putting these rules in the database is that
 * they hold against a stray `INSERT` from a script, not only against the
 * service somebody will write next month. Asserting them through a repository
 * would prove the repository, which does not exist.
 *
 * The claims that need a real server rather than a file-shape check:
 *
 *   MONEY IS EXACT             NUMERIC(14,2) round-trips a large VND figure
 *                              without the drift a float would introduce
 *   THE CATEGORY LIST HOLDS    a sixth heading is refused by the database
 *   VOID MOVES AS ONE          a half-set void cannot be stored at all
 *   HISTORY SURVIVES           archiving a trip leaves its cost rows untouched
 *   STATUS IS IRRELEVANT       a finished trip still accepts cost, which is the
 *                              case the feature exists for
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;
const SCHEMA = 'trip_cost_itest';

function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(`DATABASE_URL_TEST points at "${name}", which is not named as a test database.`);
  }
}

describeIntegration('Trip cost against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let author: string;
  let trip: string;

  /** Postgres error code for the failure a case expects, or `null` if it succeeded. */
  const failureOf = async (sql: string, params: unknown[] = []): Promise<string | null> => {
    try {
      await pool.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  };

  const CHECK_VIOLATION = '23514';
  const FK_VIOLATION = '23503';
  const NOT_NULL_VIOLATION = '23502';

  const addCost = (values: Partial<Record<string, unknown>> = {}) =>
    pool.query(
      `INSERT INTO trip_costs (trip_id, category, amount, note, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        values['trip_id'] ?? trip,
        values['category'] ?? 'fuel',
        values['amount'] ?? 1_000_000,
        values['note'] ?? null,
        values['created_by'] ?? author,
      ],
    );

  const addHire = (values: Partial<Record<string, unknown>> = {}) =>
    pool.query(
      `INSERT INTO trip_outsource_hires
         (trip_id, carrier_name, agreed_amount, amount_includes_vat, document_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        values['trip_id'] ?? trip,
        values['carrier_name'] ?? 'Hai Thành',
        values['agreed_amount'] ?? 4_500_000,
        values['amount_includes_vat'] ?? false,
        values['document_ref'] ?? null,
        values['created_by'] ?? author,
      ],
    );

  /** The live total for a trip: own-vehicle lines plus outsourced hires. */
  const liveTotal = async (tripId = trip): Promise<string> => {
    const { rows } = await pool.query<{ total: string }>(
      `SELECT COALESCE(
                (SELECT SUM(amount) FROM trip_costs
                  WHERE trip_id = $1 AND voided_at IS NULL), 0)
            + COALESCE(
                (SELECT SUM(agreed_amount) FROM trip_outsource_hires
                  WHERE trip_id = $1 AND voided_at IS NULL), 0) AS total`,
      [tripId],
    );
    return rows[0]?.total as string;
  };

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({
      connectionString: TEST_URL,
      max: 4,
      options: `-c search_path=${SCHEMA}`,
    });

    const migrations = join(__dirname, '..', '..', 'migrations');
    for (const file of [
      '0001_identity.sql',
      '0002_users_updated_at.sql',
      '0011_trip_schedule.sql',
      '0012_trip_cost.sql',
    ]) {
      await pool.query(await readFile(join(migrations, file), 'utf8'));
    }

    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (display_name) VALUES ('Kế Toán') RETURNING id`,
    );
    author = user.rows[0]?.id as string;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM trip_costs');
    await pool.query('DELETE FROM trip_outsource_hires');
    await pool.query('DELETE FROM trip_schedules');

    const row = await pool.query<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ('2026-08-04', $1) RETURNING id`,
      [author],
    );
    trip = row.rows[0]?.id as string;
  });

  // ------------------------------------------------------------- the money ----

  describe('★ money is exact, not approximate', () => {
    it('round-trips a large VND figure without drift', async () => {
      await addCost({ amount: '999999999.99' });
      const { rows } = await pool.query<{ amount: string }>('SELECT amount FROM trip_costs');
      // A float column would return 1000000000 here.
      expect(rows[0]?.amount).toBe('999999999.99');
    });

    it('★ sums a hundred lines to the exact expected total', async () => {
      // 100 × 0.01 is 1.00 in NUMERIC and 1.0000000000000007 in float64.
      for (let index = 0; index < 100; index += 1) await addCost({ amount: '0.01' });
      expect(await liveTotal()).toBe('1.00');
    });

    it.each([['0'], ['-1'], ['-0.01']])('refuses an amount of %s on a cost line', async (amount) => {
      expect(await failureOf(
        `INSERT INTO trip_costs (trip_id, category, amount, created_by) VALUES ($1,'fuel',$2,$3)`,
        [trip, amount, author],
      )).toBe(CHECK_VIOLATION);
    });

    it.each([['0'], ['-1']])('refuses an agreed amount of %s on a hire', async (amount) => {
      expect(await failureOf(
        `INSERT INTO trip_outsource_hires (trip_id, carrier_name, agreed_amount, created_by)
         VALUES ($1,'Hải Râu',$2,$3)`,
        [trip, amount, author],
      )).toBe(CHECK_VIOLATION);
    });
  });

  // ---------------------------------------------------------- the category ----

  describe('★ the category list is enforced by the database', () => {
    it.each(['fuel', 'toll', 'warehouse', 'loading', 'overtime'])('accepts %s', async (category) => {
      await expect(addCost({ category })).resolves.toBeDefined();
    });

    it.each(['other', 'misc', 'allowance', 'FUEL', ''])('refuses %s', async (category) => {
      expect(await failureOf(
        `INSERT INTO trip_costs (trip_id, category, amount, created_by) VALUES ($1,$2,100,$3)`,
        [trip, category, author],
      )).toBe(CHECK_VIOLATION);
    });

    it('★ allows several lines of the SAME category on one trip', async () => {
      // Two fuel fills on one run. A unique index on (trip_id, category) would
      // refuse the second, which is why there is not one.
      await addCost({ category: 'fuel', amount: 500_000 });
      await addCost({ category: 'fuel', amount: 300_000 });

      const { rows } = await pool.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM trip_costs WHERE category = $1',
        ['fuel'],
      );
      expect(rows[0]?.count).toBe('2');
      expect(await liveTotal()).toBe('800000.00');
    });
  });

  // ------------------------------------------------------- the void state ----

  describe('★ a void moves as one, or not at all', () => {
    it.each([
      ['voided_at alone', 'voided_at = now()'],
      ['voided_by alone', 'voided_by = $2'],
      ['void_reason alone', "void_reason = 'nhập nhầm'"],
      ['at and by without a reason', 'voided_at = now(), voided_by = $2'],
      ['at and reason without a person', "voided_at = now(), void_reason = 'nhập nhầm'"],
    ])('refuses %s', async (_label, assignment) => {
      const { rows } = await addCost();
      expect(await failureOf(
        `UPDATE trip_costs SET ${assignment} WHERE id = $1`,
        assignment.includes('$2') ? [rows[0].id, author] : [rows[0].id],
      )).toBe(CHECK_VIOLATION);
    });

    it('accepts all three together', async () => {
      const { rows } = await addCost();
      expect(await failureOf(
        `UPDATE trip_costs SET voided_at = now(), voided_by = $2, void_reason = 'nhập nhầm'
          WHERE id = $1`,
        [rows[0].id, author],
      )).toBeNull();
    });

    it('refuses a void reason made only of whitespace', async () => {
      const { rows } = await addCost();
      expect(await failureOf(
        `UPDATE trip_costs SET voided_at = now(), voided_by = $2, void_reason = '   '
          WHERE id = $1`,
        [rows[0].id, author],
      )).toBe(CHECK_VIOLATION);
    });

    it('holds the same way on an outsourced hire', async () => {
      const { rows } = await addHire();
      expect(await failureOf('UPDATE trip_outsource_hires SET voided_at = now() WHERE id = $1', [
        rows[0].id,
      ])).toBe(CHECK_VIOLATION);
    });
  });

  // ------------------------------------------------- correction, not edit ----

  describe('★ a wrong figure is voided and re-entered, never overwritten', () => {
    it('leaves the voided line readable and out of the total', async () => {
      const wrong = await addCost({ amount: 5_000_000 });
      await pool.query(
        `UPDATE trip_costs SET voided_at = now(), voided_by = $2, void_reason = 'sai số tiền'
          WHERE id = $1`,
        [wrong.rows[0].id, author],
      );
      await addCost({ amount: 500_000 });

      // The correction counts…
      expect(await liveTotal()).toBe('500000.00');

      // …and the original is still there, with why it was withdrawn.
      const { rows } = await pool.query<{ amount: string; void_reason: string }>(
        'SELECT amount, void_reason FROM trip_costs WHERE id = $1',
        [wrong.rows[0].id],
      );
      expect(rows[0]?.amount).toBe('5000000.00');
      expect(rows[0]?.void_reason).toBe('sai số tiền');
    });

    it('★ has no updated_at to overwrite in the first place', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name IN ('trip_costs','trip_outsource_hires')
            AND column_name = 'updated_at'`,
        [SCHEMA],
      );
      expect(rows).toHaveLength(0);
    });

    it('installs no trigger on either table', async () => {
      const { rows } = await pool.query(
        `SELECT t.tgname FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND NOT t.tgisinternal
            AND c.relname IN ('trip_costs','trip_outsource_hires')`,
        [SCHEMA],
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------ integrity ----

  describe('referential integrity', () => {
    it('refuses a cost line for a trip that does not exist', async () => {
      expect(await failureOf(
        `INSERT INTO trip_costs (trip_id, category, amount, created_by)
         VALUES ('00000000-0000-4000-8000-000000000000','fuel',100,$1)`,
        [author],
      )).toBe(FK_VIOLATION);
    });

    it('refuses a hire for a trip that does not exist', async () => {
      expect(await failureOf(
        `INSERT INTO trip_outsource_hires (trip_id, carrier_name, agreed_amount, created_by)
         VALUES ('00000000-0000-4000-8000-000000000000','xe Út',100,$1)`,
        [author],
      )).toBe(FK_VIOLATION);
    });

    it('refuses a cost line with no author', async () => {
      expect(await failureOf(
        `INSERT INTO trip_costs (trip_id, category, amount) VALUES ($1,'fuel',100)`,
        [trip],
      )).toBe(NOT_NULL_VIOLATION);
    });

    it('★ refuses to delete a trip that has cost against it', async () => {
      // The runtime never issues DELETE (B13); this proves the database would
      // refuse it anyway, so a stray script cannot erase a month's spending by
      // removing one dispatch row.
      await addCost();
      expect(await failureOf('DELETE FROM trip_schedules WHERE id = $1', [trip])).toBe(
        FK_VIOLATION,
      );
    });

    it('refuses a blank carrier name', async () => {
      expect(await failureOf(
        `INSERT INTO trip_outsource_hires (trip_id, carrier_name, agreed_amount, created_by)
         VALUES ($1,'   ',100,$2)`,
        [trip, author],
      )).toBe(CHECK_VIOLATION);
    });
  });

  // ----------------------------------------------- independence from trips ----

  describe('★ cost does not care what state the trip is in', () => {
    it.each([
      'awaiting_production',
      'awaiting_vehicle',
      'needs_confirmation',
      'external_booking',
      'done',
    ])('accepts a cost line on a trip that is %s', async (status) => {
      await pool.query('UPDATE trip_schedules SET status = $2 WHERE id = $1', [trip, status]);
      await expect(addCost()).resolves.toBeDefined();
    });

    it('★ accepts cost on a FINISHED trip — the case the feature exists for', async () => {
      // Cost is a later workflow with a different approver, so the figures
      // routinely arrive after dispatch has closed the trip.
      await pool.query(`UPDATE trip_schedules SET status = 'done' WHERE id = $1`, [trip]);

      await addCost({ category: 'overtime', amount: 250_000 });
      await addHire({ agreed_amount: 3_000_000 });

      expect(await liveTotal()).toBe('3250000.00');
    });

    it('★ keeps every cost row when the trip is archived', async () => {
      await addCost({ amount: 800_000 });
      await addHire({ agreed_amount: 200_000 });

      await pool.query(
        'UPDATE trip_schedules SET archived_at = now(), archived_by = $2 WHERE id = $1',
        [trip, author],
      );

      // Archiving takes the trip off the board. It does not touch the money.
      expect(await liveTotal()).toBe('1000000.00');
    });
  });

  // ------------------------------------------------------------- the hire ----

  describe('the outsourced hire', () => {
    it('records the carrier exactly as it was typed', async () => {
      await addHire({ carrier_name: '  Hải Râu  ' });
      const { rows } = await pool.query<{ carrier_name: string }>(
        'SELECT carrier_name FROM trip_outsource_hires',
      );
      // Not trimmed by the database: formatting is theirs. Only the emptiness
      // check is ours, and normalisation waits for the catalogue.
      expect(rows[0]?.carrier_name).toBe('  Hải Râu  ');
    });

    it('defaults the VAT flag to "the figure is net"', async () => {
      await addHire();
      const { rows } = await pool.query<{ amount_includes_vat: boolean }>(
        'SELECT amount_includes_vat FROM trip_outsource_hires',
      );
      expect(rows[0]?.amount_includes_vat).toBe(false);
    });

    it('★ allows more than one hire on a trip', async () => {
      // Deliberately not unique on trip_id while the business shape is open.
      await addHire({ carrier_name: 'Hai Thành', agreed_amount: 2_000_000 });
      await addHire({ carrier_name: 'Mr Đạt', agreed_amount: 1_500_000 });
      expect(await liveTotal()).toBe('3500000.00');
    });

    it('excludes a voided hire from the total, and keeps the row', async () => {
      const { rows } = await addHire({ agreed_amount: 2_000_000 });
      await addHire({ agreed_amount: 1_000_000 });

      await pool.query(
        `UPDATE trip_outsource_hires
            SET voided_at = now(), voided_by = $2, void_reason = 'đổi nhà xe'
          WHERE id = $1`,
        [rows[0].id, author],
      );

      expect(await liveTotal()).toBe('1000000.00');
      const remaining = await pool.query('SELECT id FROM trip_outsource_hires');
      expect(remaining.rows).toHaveLength(2);
    });
  });

  // ------------------------------------------------------------ the index ----

  describe('the partial indexes', () => {
    it.each([
      ['idx_trip_cost_trip', 'trip_costs'],
      ['idx_trip_outsource_hire_trip', 'trip_outsource_hires'],
    ])('%s exists and covers live rows only', async (index, table) => {
      const { rows } = await pool.query<{ indexdef: string }>(
        'SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2',
        [SCHEMA, index],
      );
      expect(rows[0]?.indexdef).toContain(`ON ${SCHEMA}.${table}`);
      expect(rows[0]?.indexdef).toContain('(trip_id)');
      expect(rows[0]?.indexdef).toContain('WHERE (voided_at IS NULL)');
    });

    it('★ has no unique index on either table', async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = $1 AND tablename IN ('trip_costs','trip_outsource_hires')
            AND indexdef LIKE 'CREATE UNIQUE%' AND indexname NOT LIKE '%_pkey'`,
        [SCHEMA],
      );
      expect(rows).toEqual([]);
    });
  });

  // --------------------------------------------------------- 0011 untouched ----

  describe('★ 0011 is untouched', () => {
    it('adds no money column to trip_schedules', async () => {
      const { rows } = await pool.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'trip_schedules'`,
        [SCHEMA],
      );

      expect(rows.map((row) => row.data_type)).not.toContain('numeric');
      const names = rows.map((row) => row.column_name);
      for (const forbidden of ['amount', 'cost', 'price', 'total']) {
        expect(names).not.toContain(forbidden);
      }
    });

    it('creates no carrier catalogue', async () => {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = 'trip_carriers'`,
        [SCHEMA],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
