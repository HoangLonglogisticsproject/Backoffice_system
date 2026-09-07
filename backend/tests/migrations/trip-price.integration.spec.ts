import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  TEST_URL,
  assertLooksLikeATestDatabase,
  describeIntegration,
  openTestSchema,
} from '../helpers/integration-database';

/**
 * 0026's two price columns against a REAL PostgreSQL.
 *
 * ★ THIS SPEC TALKS SQL, NOT SERVICES, for the same reason `trip-cost` does:
 * the value of putting a rule in the database is that it holds against a stray
 * INSERT from a script, not only against the service that happens to call it
 * today. Everything here is a claim about the schema.
 *
 * The claims that need a real server rather than a file-shape check:
 *
 *   THE RENAME CARRIED THE DATA   a row priced under 0024 still holds its
 *                                 figure, under the new name, EXACTLY
 *   NO `price` SURVIVES           the old column is gone rather than kept as a
 *                                 second, drifting copy
 *   BOTH ARE NULLABLE             unpriced and unbought are real states
 *   BOTH REFUSE A ZERO            a run charged nothing is not a run not yet
 *                                 priced, and the CHECK says so for each
 *   MONEY IS EXACT                NUMERIC(14,2) round-trips a large VND figure
 *                                 as a STRING, without a float anywhere
 */
const SCHEMA = 'trip_price_itest';

describeIntegration('Trip prices against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;

  const CHECK_VIOLATION = '23514';
  const UNDEFINED_COLUMN = '42703';

  /** Postgres error code for the failure a case expects, or `null` if it succeeded. */
  const failureOf = async (sql: string, params: unknown[] = []): Promise<string | null> => {
    try {
      await pool.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  };

  /**
   * Applies migrations up to and INCLUDING `last`, continuing from wherever the
   * previous call stopped.
   *
   * ★ THE POINT OF THE WHOLE FILE IS WHAT HAPPENS BETWEEN 0024 AND 0026, so the
   * two halves cannot be applied in one go. A row is priced under the old column
   * name by a statement that would not compile against the new schema — which
   * is the only honest way to prove a rename carried live data rather than that
   * a fresh column accepts writes.
   *
   * ⚠ RESUMES RATHER THAN REPLAYING. An earlier version re-ran 0001–0024 on the
   * second call. Most migrations survive that — they are written `IF NOT
   * EXISTS` — but 0026 is a RENAME, which is not idempotent by nature, and a
   * helper that quietly re-runs everything is one edit away from proving
   * nothing.
   */
  let appliedCount = 0;

  const applyThrough = async (last: string): Promise<void> => {
    const directory = join(__dirname, '..', '..', 'migrations');
    const wanted = (await readdir(directory))
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .filter((file) => file <= last);

    for (const file of wanted.slice(appliedCount)) {
      await pool.query(await readFile(join(directory, file), 'utf8'));
    }
    appliedCount = wanted.length;
  };

  /** A trip row, written straight to the table. `created_by` needs a real user. */
  let author: string;

  /**
   * A trip AFTER 0026, so `'pending'` is a word the CHECK accepts.
   *
   * ⚠ ONLY VALID ONCE 0025 HAS RUN. Before it, `trip_schedules.status` held the
   * workbook's five fill-colours — `awaiting_production`, `awaiting_vehicle`,
   * `needs_confirmation`, `external_booking`, `done` — and `'pending'` violates
   * the CHECK outright. That is exactly the trap the pre-0026 insert below
   * steps around by naming no status at all.
   */
  const addTrip = (columns: string, values: string, params: unknown[]): Promise<{ rows: { id: string }[] }> =>
    pool.query(
      `INSERT INTO trip_schedules (scheduled_on, status, created_by${columns})
       VALUES ('2026-08-04', 'pending', $1${values}) RETURNING id`,
      [author, ...params],
    );

  /** The id of a trip priced BEFORE 0026 ran, under 0024's column name. */
  let priced: string;

  /**
   * ★ THE WHOLE MIGRATION STORY HAPPENS HERE, NOT IN A TEST.
   *
   * An earlier version priced the trip and applied 0026 inside the first
   * `it()`, which made every later case depend on that one having run. When it
   * failed, all twelve failed — eleven of them reporting missing columns rather
   * than the actual fault. Setup that other tests need is `beforeAll`'s job;
   * a test should assert, not arrange for its neighbours.
   */
  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);
    pool = await openTestSchema(TEST_URL as string, SCHEMA);

    await applyThrough('0024_trip_price.sql');

    // ★ `display_name` AND NOTHING ELSE, which is the whole of what this spec
    // needs from identity. `users` carries no email — that lives in
    // `identities`, one row per credential — and `status` and `account_type`
    // both have defaults. The same one-column insert every other integration
    // spec here uses; anything more would be this file inventing a schema.
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (display_name) VALUES ('Pricer') RETURNING id`,
    );
    author = user.rows[0]!.id;

    // ★ NO `status` COLUMN NAMED, AND THAT IS THE POINT. This row is written
    // against the schema as it stood at 0024, where the five workbook words are
    // what the CHECK accepts and `awaiting_production` is the DEFAULT. Naming
    // `'pending'` here — the word the board uses TODAY — is refused outright,
    // because 0025 has not run yet. Letting the default apply keeps this
    // statement about the price, which is all this spec is about.
    const trip = await pool.query<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, created_by, price)
       VALUES ('2026-08-04', $1, '4500000.00') RETURNING id`,
      [author],
    );
    priced = trip.rows[0]!.id;

    // 0025 remaps the five old words to the four new ones; 0026 renames the
    // price column over the top of the live row written above.
    await applyThrough('0026_trip_sell_and_purchase_price.sql');
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe('★ the rename, which is the only irreversible thing 0026 does', () => {
    it('★ carries the stored figure across, EXACTLY and as a string', async () => {
      const { rows } = await pool.query<{ sell_price: string | null }>(
        `SELECT sell_price FROM trip_schedules WHERE id = $1`,
        [priced],
      );

      // ★ `'4500000.00'`, NOT `4500000`. `pg` hands NUMERIC back as text
      // precisely so nothing rounds it, and a rename that quietly changed the
      // type would show up here as a number.
      expect(rows[0]?.sell_price).toBe('4500000.00');
      expect(typeof rows[0]?.sell_price).toBe('string');
    });

    it('★ leaves NO `price` column behind — a rename, not a copy', async () => {
      // Two columns holding the same figure is the failure a "safe" additive
      // migration would have produced: one of them goes stale and nobody knows
      // which is authoritative.
      expect(await failureOf(`SELECT price FROM trip_schedules`)).toBe(UNDEFINED_COLUMN);
    });

    it('gives the migrated row no buying price, rather than a zero', async () => {
      const { rows } = await pool.query<{ purchase_price: string | null }>(
        `SELECT purchase_price FROM trip_schedules WHERE id = $1`,
        [priced],
      );
      expect(rows[0]?.purchase_price).toBeNull();
    });
  });

  describe('★ what each column accepts', () => {
    it('takes a trip with neither figure — both are entered later, or never', async () => {
      await expect(addTrip('', '', [])).resolves.toBeDefined();
    });

    it('takes a selling price with no buying price — our own lorry, the ordinary case', async () => {
      await expect(
        addTrip(', sell_price', ", '4500000'", []),
      ).resolves.toBeDefined();
    });

    it('takes a buying price with no selling price — priced later by whoever agreed it', async () => {
      await expect(
        addTrip(', purchase_price', ", '3000000'", []),
      ).resolves.toBeDefined();
    });

    it('★ refuses a zero selling price — charged nothing and not yet priced differ', async () => {
      expect(
        await failureOf(
          `INSERT INTO trip_schedules (scheduled_on, status, created_by, sell_price)
           VALUES ('2026-08-04', 'pending', $1, 0)`,
          [author],
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('★ refuses a zero buying price for the same reason', async () => {
      expect(
        await failureOf(
          `INSERT INTO trip_schedules (scheduled_on, status, created_by, purchase_price)
           VALUES ('2026-08-04', 'pending', $1, 0)`,
          [author],
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it('refuses a negative figure in either column', async () => {
      for (const column of ['sell_price', 'purchase_price']) {
        expect(
          await failureOf(
            `INSERT INTO trip_schedules (scheduled_on, status, created_by, ${column})
             VALUES ('2026-08-04', 'pending', $1, -1)`,
            [author],
          ),
        ).toBe(CHECK_VIOLATION);
      }
    });

    it('★ holds a large VND figure without the drift a float would introduce', async () => {
      const { rows } = await pool.query<{ sell_price: string; purchase_price: string }>(
        `INSERT INTO trip_schedules (scheduled_on, status, created_by, sell_price, purchase_price)
         VALUES ('2026-08-04', 'pending', $1, '999999999999.99', '123456789012.34')
         RETURNING sell_price, purchase_price`,
        [author],
      );

      // Twelve digits before the point is the column's limit and far past any
      // single freight charge. Both come back as the strings they went in as.
      expect(rows[0]?.sell_price).toBe('999999999999.99');
      expect(rows[0]?.purchase_price).toBe('123456789012.34');
    });

    it('★ ROUNDS a third decimal place rather than refusing it — which the DTO does not', async () => {
      // Stated here because it is the reason the API refuses that shape before
      // a statement is ever built: PostgreSQL would accept `.005` and store
      // something else, and a caller told "stored" about a figure that is not
      // theirs is the failure the whole NUMERIC choice exists to prevent.
      const { rows } = await pool.query<{ sell_price: string }>(
        `INSERT INTO trip_schedules (scheduled_on, status, created_by, sell_price)
         VALUES ('2026-08-04', 'pending', $1, '4500000.005') RETURNING sell_price`,
        [author],
      );
      expect(rows[0]?.sell_price).not.toBe('4500000.005');
    });
  });
});
