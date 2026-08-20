import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database, DatabaseQuery } from '../../../common/types/database.port';
import { DepartmentRepository } from './department.repository';
import { MembershipRepository } from './membership.repository';
import { MembershipService } from '../application/membership.service';
import { AuthorizationRepository } from '../../authorization/persistence/authorization.repository';
import { decodeCursor } from '../../../common/pagination/cursor';

/**
 * The user identity projection against a REAL PostgreSQL (ADR-0001).
 *
 * What needs a real server, and why a mock would prove nothing:
 *
 *   - that the JOIN returns the RIGHT name per row. A fake repository would
 *     hand back whatever names the author paired up; only a database can get
 *     the pairing wrong, and only a database can prove it does not.
 *   - that the projection does not disturb keyset pagination. Two tables in
 *     these queries carry `id` and `created_at`, and the ordered index only
 *     applies when the cursor comparison names the membership's own columns.
 *   - that a name is reachable ONLY through a row the caller already reads.
 *
 * Skipped unless DATABASE_URL_TEST names a database this test may WIPE.
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;

/** Its own schema, so it cannot collide with the other integration suites. */
const SCHEMA = 'projection_itest';

function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(
      `DATABASE_URL_TEST points at "${name}", which is not named as a test database.`,
    );
  }
}

describeIntegration('user identity projection against real PostgreSQL', () => {
  jest.setTimeout(60_000);

  let pool: Pool;
  let database: Database;
  let memberships: MembershipService;
  let assignments: AuthorizationRepository;
  let departmentId: string;
  let otherDepartmentId: string;

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
    assignments = new AuthorizationRepository(database);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE role_assignments, department_memberships, departments, users CASCADE',
    );
    const { rows } = await pool.query<{ id: string; slug: string }>(
      `INSERT INTO departments (slug, name)
       VALUES ('one', 'One'), ('two', 'Two') RETURNING id, slug`,
    );
    departmentId = rows.find((r) => r.slug === 'one')!.id;
    otherDepartmentId = rows.find((r) => r.slug === 'two')!.id;
  });

  /** One member with a known name, joined to `department`. */
  const addMember = async (displayName: string, department = departmentId): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING id',
      [displayName],
    );
    const userId = rows[0]!.id;
    await pool.query(
      'INSERT INTO department_memberships (user_id, department_id) VALUES ($1, $2)',
      [userId, department],
    );
    return userId;
  };

  // ------------------------------------------------------------- the shape --

  describe('the member list', () => {
    it('carries each member’s name alongside the id it already had', async () => {
      const userId = await addMember('Ada Lovelace');

      const page = await memberships.listActiveMembers(departmentId, { limit: 50 });

      expect(page.items).toHaveLength(1);
      // ADDITIVE: the scalar `userId` is exactly where it always was.
      expect(page.items[0]!.userId).toBe(userId);
      expect(page.items[0]!.user).toEqual({ id: userId, displayName: 'Ada Lovelace' });
    });

    it('pairs the RIGHT name with the RIGHT row, which is the only thing a join can get wrong', async () => {
      // Distinct names in a known join order. A join that pairs rows by
      // position rather than by key passes with one member and fails here.
      const names = ['Zoe', 'Adam', 'Mia', 'Bo', 'Ivan'];
      const ids: string[] = [];
      for (const name of names) ids.push(await addMember(name));

      const page = await memberships.listActiveMembers(departmentId, { limit: 50 });

      // Every row's projected id must equal its own scalar userId...
      for (const item of page.items) {
        expect(item.user.id).toBe(item.userId);
      }
      // ...and the name must be the one that user was actually created with.
      const byId = new Map(ids.map((id, n) => [id, names[n]!]));
      for (const item of page.items) {
        expect(item.user.displayName).toBe(byId.get(item.userId));
      }
    });

    it('never invents a placeholder: the name is the row in `users`, or the query fails', async () => {
      const userId = await addMember('Real Person');
      await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', ['Renamed', userId]);

      const page = await memberships.listActiveMembers(departmentId, { limit: 50 });

      // Reads through to the live row rather than a copy taken at join time.
      expect(page.items[0]!.user.displayName).toBe('Renamed');
    });
  });

  // -------------------------------------------------------- pagination kept --

  describe('keyset pagination still works with the join attached', () => {
    it('walks every member exactly once across pages, names included', async () => {
      const names = Array.from({ length: 25 }, (_, n) => `Person ${n}`);
      for (const name of names) await addMember(name);

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await memberships.listActiveMembers(departmentId, { limit: 10, cursor });
        for (const item of page.items) {
          // Every row on every page carries its projection — not just page one.
          expect(item.user.id).toBe(item.userId);
          seen.push(item.user.displayName);
        }
        if (!page.hasMore) break;
        cursor = page.nextCursor ?? undefined;
      }

      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
      expect(new Set(seen)).toEqual(new Set(names));
    });

    it('the cursor still points at the MEMBERSHIP, not at the joined user', async () => {
      // If a star-select let `users.id` overwrite the membership id, the cursor
      // would encode a user id and the next page would silently be wrong.
      for (const name of ['A', 'B', 'C']) await addMember(name);

      const page = await memberships.listActiveMembers(departmentId, { limit: 2 });
      const cursor = decodeCursor(page.nextCursor as string);

      expect(cursor.i).toBe(page.items[1]!.id);
      expect(cursor.i).not.toBe(page.items[1]!.userId);
    });

    it('survives a timestamp tie, which is where a broken ORDER BY would show', async () => {
      // All five share one `created_at`, so ordering rests entirely on the id
      // tiebreaker — and the tiebreaker must be the membership's own id.
      await pool.query(
        `WITH inserted AS (
           INSERT INTO users (display_name)
           SELECT 'Tied ' || g FROM generate_series(1, 5) g RETURNING id
         )
         INSERT INTO department_memberships (user_id, department_id, created_at)
         SELECT id, $1, TIMESTAMPTZ '2026-01-01 00:00:00+00' FROM inserted`,
        [departmentId],
      );

      const first = await memberships.listActiveMembers(departmentId, { limit: 3 });
      const second = await memberships.listActiveMembers(departmentId, {
        limit: 3,
        cursor: first.nextCursor as string,
      });

      const ids = [...first.items, ...second.items].map((m) => m.id);
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
    });
  });

  // ------------------------------------------------------------- the scope --

  describe('the projection reaches no further than the resource that carries it', () => {
    it('a department’s list names only that department’s members', async () => {
      await addMember('Inside Person', departmentId);
      await addMember('Outside Person', otherDepartmentId);

      const page = await memberships.listActiveMembers(departmentId, { limit: 50 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.user.displayName).toBe('Inside Person');
      // The other department's member is not merely unnamed here — absent.
      const names = page.items.map((m) => m.user.displayName);
      expect(names).not.toContain('Outside Person');
    });

    it('an ended membership takes its name out of the list with it', async () => {
      const stays = await addMember('Still Here');
      const leaves = await addMember('Has Left');
      await pool.query(
        "UPDATE department_memberships SET status = 'ended', ended_at = now() WHERE user_id = $1",
        [leaves],
      );

      const page = await memberships.listActiveMembers(departmentId, { limit: 50 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.userId).toBe(stays);
    });

    it('a disabled user is still named, because the MEMBERSHIP is what is listed', async () => {
      // `users.status` is the account lifecycle, not the membership's. A head
      // reading their unit should still see who is in it.
      const userId = await addMember('Disabled Person');
      await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [userId]);

      const page = await memberships.listActiveMembers(departmentId, { limit: 50 });

      expect(page.items[0]!.user.displayName).toBe('Disabled Person');
    });
  });

  // --------------------------------------------------------- the head read --

  describe('the department head read', () => {
    it('names the head', async () => {
      const userId = await addMember('Head Person');
      const { rows } = await pool.query<{ id: string }>(
        'SELECT id FROM department_memberships WHERE user_id = $1',
        [userId],
      );
      await pool.query(
        `INSERT INTO role_assignments
           (user_id, role_key, scope_type, scope_id, membership_id, status, granted_via, granted_by)
         VALUES ($1, 'DEPARTMENT_HEAD', 'DEPARTMENT', $2, $3, 'active', 'api', $1)`,
        [userId, departmentId, rows[0]!.id],
      );

      const head = await assignments.findActiveHeadOfDepartmentWithUser(departmentId);

      expect(head).not.toBeNull();
      expect(head!.userId).toBe(userId);
      expect(head!.user).toEqual({ id: userId, displayName: 'Head Person' });
    });

    it('is null for a department with no head, rather than a nameless shell', async () => {
      expect(await assignments.findActiveHeadOfDepartmentWithUser(departmentId)).toBeNull();
    });
  });

  // ------------------------------------------------------ the lifecycle bet --

  describe('the guarantee the INNER JOIN rests on', () => {
    it('PostgreSQL refuses to delete a user who is still referenced', async () => {
      // This is why the join is INNER and not LEFT. If this ever starts
      // succeeding, the projection can produce a null and this test is the
      // thing that says so out loud.
      const userId = await addMember('Referenced Person');

      await expect(pool.query('DELETE FROM users WHERE id = $1', [userId])).rejects.toThrow(
        /violates foreign key constraint/,
      );
    });
  });
});
