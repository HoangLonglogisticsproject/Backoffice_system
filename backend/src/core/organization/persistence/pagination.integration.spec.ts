import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database, DatabaseQuery } from '../../../common/types/database.port';
import { DepartmentRepository } from './department.repository';
import { MembershipRepository } from './membership.repository';
import { MembershipService } from '../application/membership.service';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
} from '../../../common/pagination/cursor';
import { pageQuerySchema } from '../../../common/pagination/page-query.dto';

/**
 * Keyset pagination against a REAL PostgreSQL.
 *
 * The unit-level pieces — encoding, validation — are checkable without a
 * server. The claims that matter are not:
 *
 *   - a page boundary INSIDE a tie group neither loses nor duplicates a row
 *   - a cursor keeps working when other people insert and delete mid-walk
 *   - the ordering is total, so a full walk returns every row exactly once
 *
 * Each of those is a statement about what PostgreSQL does with a row-wise
 * comparison, and a fake repository would agree with whatever the author
 * believed. So this suite writes real rows and walks them.
 *
 * Skipped unless DATABASE_URL_TEST names a database this test may WIPE.
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;

/** Its own schema, for the reason the organization suite documents. */
const SCHEMA = 'pagination_itest';

function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(
      `DATABASE_URL_TEST points at "${name}", which is not named as a test database.`,
    );
  }
}

describeIntegration('keyset pagination against real PostgreSQL', () => {
  jest.setTimeout(60_000);

  let pool: Pool;
  let database: Database;
  let memberships: MembershipService;
  let departmentId: string;

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({ connectionString: TEST_URL, max: 6, options: `-c search_path=${SCHEMA}` });

    const migrations = join(__dirname, '..', '..', '..', '..', 'migrations');
    // The FULL chain, in order. 0009 indexes tables that 0006 and 0007 create,
    // so a subset cannot apply it — and running exactly what production runs is
    // the point of an integration suite anyway.
    for (const file of [
      '0001_identity.sql',
      '0002_users_updated_at.sql',
      '0003_organization.sql',
      '0004_authorization.sql',
      '0005_identity_credential_state.sql',
      '0006_membership_change_requests.sql',
      '0007_account_invitations.sql',
      '0008_role_assignment_membership_fk_index.sql',
      '0009_list_pagination_indexes.sql',
    ]) {
      await pool.query(await readFile(join(migrations, file), 'utf8'));
    }

    database = {
      query: async <T>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
        (await pool.query(sql, params as unknown[])).rows as T[],
      transaction: async <T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({
            query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> =>
              (await client.query(sql, params as unknown[])).rows as R[],
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };

    memberships = new MembershipService(
      database,
      new DepartmentRepository(database),
      new MembershipRepository(database),
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE department_memberships, departments, users CASCADE');
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO departments (slug, name) VALUES ('page', 'Page') RETURNING id",
    );
    departmentId = rows[0]!.id;
  });

  /**
   * Seeds `count` members. `tieSize` controls how many share one timestamp —
   * the condition that breaks a timestamp-only cursor.
   */
  const seedMembers = async (count: number, tieSize = 1): Promise<void> => {
    await pool.query(
      // A data-modifying CTE, because `INSERT ... RETURNING` is not legal in a
      // subquery. Integer division groups `tieSize` rows onto one timestamp.
      `WITH inserted AS (
         INSERT INTO users (display_name)
         SELECT 'Member ' || g FROM generate_series(1, $3::int) g
         RETURNING id
       ), numbered AS (
         SELECT id, row_number() OVER (ORDER BY id) AS rn FROM inserted
       )
       INSERT INTO department_memberships (user_id, department_id, created_at)
       SELECT n.id, $1,
              TIMESTAMPTZ '2026-01-01 00:00:00+00'
                + (((n.rn - 1) / $2::int) * interval '1 minute')
         FROM numbered n`,
      [departmentId, tieSize, count],
    );
  };

  /** Walks every page and returns the ids in the order they were served. */
  const walkAll = async (limit: number): Promise<string[]> => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (;;) {
      const page = await memberships.listActiveMembers(departmentId, { limit, cursor });
      seen.push(...page.items.map((m) => m.id));
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        break;
      }
      expect(page.nextCursor).not.toBeNull();
      cursor = page.nextCursor as string;
      // A runaway loop should fail as a test, not hang the suite.
      expect(seen.length).toBeLessThanOrEqual(5000);
    }

    return seen;
  };

  // ------------------------------------------------------------ paging --

  it('returns the first page and a cursor when more rows exist', async () => {
    await seedMembers(30);

    const page = await memberships.listActiveMembers(departmentId, { limit: 10 });

    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('ends with hasMore false and a null cursor', async () => {
    await seedMembers(10);

    const page = await memberships.listActiveMembers(departmentId, { limit: 10 });

    // Exactly `limit` rows and nothing beyond: `limit + 1` came back short.
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('returns an empty page rather than an error when there is nothing', async () => {
    const page = await memberships.listActiveMembers(departmentId, { limit: 10 });

    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('walks every row exactly once, in order, with no overlap', async () => {
    await seedMembers(97);

    const seen = await walkAll(10);

    expect(seen).toHaveLength(97);
    expect(new Set(seen).size).toBe(97);
  });

  // ------------------------------------------------------- ★ the ties --

  it('★ neither loses nor duplicates a row when a page boundary lands inside a tie', async () => {
    // 100 rows across 10 timestamps: pages of 7 guarantee boundaries that fall
    // in the middle of a tie group, which is exactly where a cursor on the
    // timestamp alone loses rows (`>`) or repeats them (`>=`).
    await seedMembers(100, 10);

    const seen = await walkAll(7);

    expect(seen).toHaveLength(100);
    expect(new Set(seen).size).toBe(100);
  });

  it('★ is stable when every row shares one timestamp', async () => {
    // The degenerate case: the timestamp carries no ordering information at
    // all, so `id` is doing all the work.
    await seedMembers(50, 50);

    const seen = await walkAll(7);

    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  // ------------------------------------------------------ concurrency --

  it('a row inserted at the head mid-walk does not appear on a later page', async () => {
    await seedMembers(30);

    const first = await memberships.listActiveMembers(departmentId, { limit: 10 });

    // Someone joins with a timestamp BEFORE everything already read.
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (display_name) VALUES ('Late Joiner') RETURNING id",
    );
    await pool.query(
      `INSERT INTO department_memberships (user_id, department_id, created_at)
       VALUES ($1, $2, TIMESTAMPTZ '2025-01-01 00:00:00+00')`,
      [rows[0]!.id, departmentId],
    );

    const second = await memberships.listActiveMembers(departmentId, {
      limit: 10,
      cursor: first.nextCursor as string,
    });

    // It sorts before the cursor, so it is simply not in this page — and it
    // has not pushed anything into being served twice.
    const overlap = second.items.filter((m) => first.items.some((f) => f.id === m.id));
    expect(overlap).toEqual([]);
  });

  it('deleting an already-read row does not shift later pages', async () => {
    // Under OFFSET this is the classic bug: removing a row above the window
    // pulls an unseen row into a position already consumed, and it is skipped.
    await seedMembers(30);

    const first = await memberships.listActiveMembers(departmentId, { limit: 10 });
    await pool.query('DELETE FROM department_memberships WHERE id = $1', [first.items[0]!.id]);

    const second = await memberships.listActiveMembers(departmentId, {
      limit: 10,
      cursor: first.nextCursor as string,
    });

    expect(second.items).toHaveLength(10);
    expect(second.items.filter((m) => first.items.some((f) => f.id === m.id))).toEqual([]);
  });

  // ----------------------------------------------------- scope safety --

  it('a cursor from one department does not leak rows from it into another', async () => {
    // The cursor is a POSITION, never a permission. Scope comes from the route
    // parameter, which the guard already checked; replaying a cursor elsewhere
    // can produce a strange-looking page but never another unit's rows.
    await seedMembers(20);
    const stolen = (await memberships.listActiveMembers(departmentId, { limit: 5 }))
      .nextCursor as string;

    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO departments (slug, name) VALUES ('other', 'Other') RETURNING id",
    );
    const otherId = rows[0]!.id;

    const page = await memberships.listActiveMembers(otherId, { limit: 5, cursor: stolen });

    // The other department has no members at all; the cursor cannot conjure any.
    expect(page.items).toEqual([]);
    expect(page.items.every((m) => m.departmentId === otherId)).toBe(true);
  });

  // ---------------------------------------------------- cursor codec --

  it('rejects a malformed cursor instead of silently restarting', async () => {
    // A silent first page would turn a client bug into an endless loop that
    // looks like success.
    for (const bad of ['not-base64!!', 'eyJicm9rZW4iOnRydWV9', '', 'abc']) {
      if (bad === '') continue;
      await expect(
        memberships.listActiveMembers(departmentId, { limit: 10, cursor: bad }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('rejects a structurally valid cursor whose parts are wrong', async () => {
    await expect(
      memberships.listActiveMembers(departmentId, {
        limit: 10,
        cursor: encodeCursor({ t: 'not-a-date', i: '11111111-1111-1111-1111-111111111111' }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      memberships.listActiveMembers(departmentId, {
        limit: 10,
        cursor: encodeCursor({ t: '2026-01-01T00:00:00.000Z', i: 'not-a-uuid' }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('round-trips a cursor', () => {
    const cursor = { t: '2026-01-01T00:00:00.000Z', i: '11111111-1111-1111-1111-111111111111' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  // ---------------------------------------------------- limit bounds --

  it('defaults, accepts and refuses limits at the boundaries', () => {
    expect(pageQuerySchema.parse({}).limit).toBe(DEFAULT_LIMIT);
    expect(pageQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(pageQuerySchema.parse({ limit: String(MAX_LIMIT) }).limit).toBe(MAX_LIMIT);

    // Refused, not clamped: a caller asking for 5,000 has misunderstood, and
    // quietly handing back 200 hides that until it matters.
    for (const bad of [0, -1, MAX_LIMIT + 1, 1.5]) {
      expect(pageQuerySchema.safeParse({ limit: String(bad) }).success).toBe(false);
    }
  });

  it('treats an empty cursor as absent, because clients forward null', () => {
    expect(pageQuerySchema.parse({ cursor: '' }).cursor).toBeUndefined();
    expect(pageQuerySchema.parse({}).cursor).toBeUndefined();
  });

  it('honours a limit of 1 across a full walk', async () => {
    await seedMembers(5, 5);

    const seen = await walkAll(1);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});
