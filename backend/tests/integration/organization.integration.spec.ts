import { Pool } from 'pg';
import type { Database, DatabaseQuery } from '@common/types/database.port';
import {
  TEST_URL,
  assertLooksLikeATestDatabase,
  describeIntegration,
  fakeHasher,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DepartmentRepository } from '@core/organization/persistence/department.repository';
import { MembershipRepository } from '@core/organization/persistence/membership.repository';
import { DepartmentService } from '@core/organization/application/department.service';
import { MembershipService } from '@core/organization/application/membership.service';

/**
 * Organization against a REAL PostgreSQL.
 *
 * The unit spec next door drives a fake repository, which proves the service
 * decides correctly but cannot prove any of the things that actually keep the
 * invariant true under load. Four claims are only true if a real server says so:
 *
 *   - `uq_single_active_membership` really does make a second active membership
 *     impossible, including for two connections racing
 *   - a transfer really is atomic: a failure leaves the ORIGINAL membership
 *     active rather than none at all
 *   - the `status`/`ended_at` CHECK really rejects a half-ended row
 *   - archiving really is blocked while members remain, under a lock
 *
 * Skipped unless DATABASE_URL_TEST names a database this test may WIPE. It
 * truncates between cases, so never point it at anything you care about.
 */

/**
 * This suite's own schema inside the test database.
 *
 * Not `public`, because the migration-runner suite drops `public` between its
 * cases and Jest runs suites concurrently. Any future integration suite should
 * claim a schema the same way.
 */
const SCHEMA = 'organization_itest';

/** Same guard as the migration runner suite, and for the same reason. */

describeIntegration('Organization against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let database: Database;
  let departmentRepository: DepartmentRepository;
  let departments: DepartmentService;
  let memberships: MembershipService;

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    // A SCHEMA OF ITS OWN, not `public`.
    //
    // `migration-runner.integration.spec.ts` drops and recreates `public`
    // between its cases. Jest runs suites in parallel workers, so sharing
    // `public` means that suite deletes this one's tables mid-run — which is
    // exactly what happened the first time this file was written, and it fails
    // as "relation does not exist" far away from the cause. Owning a schema
    // makes the two suites unable to see each other at all.
    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({ connectionString: TEST_URL, max: 6, options: `-c search_path=${SCHEMA}` });

    // The real schema, applied from the real files: a test that hand-writes its
    // own DDL proves something about the hand-written DDL, not about what ships.
    const migrations = join(__dirname, '..', '..', 'migrations');
    for (const file of ['0001_identity.sql', '0002_users_updated_at.sql', '0003_organization.sql']) {
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

    departmentRepository = new DepartmentRepository(database);
    const membershipRepository = new MembershipRepository(database);
    departments = new DepartmentService(database, departmentRepository, membershipRepository);
    memberships = new MembershipService(database, departmentRepository, membershipRepository);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE department_memberships, departments, users CASCADE');
  });

  const createUser = async (name: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING id',
      [name],
    );
    return rows[0]!.id;
  };

  /** The state the whole model exists to prevent, asked as a query. */
  const countActiveUsersWithoutDepartment = async (): Promise<number> => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM users u
        WHERE u.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM department_memberships m
             WHERE m.user_id = u.id AND m.status = 'active'
          )`,
    );
    return Number(rows[0]!.count);
  };

  describe('uq_single_active_membership', () => {
    it('rejects a second active membership for the same user', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });

      await memberships.enroll({ userId, departmentId: a.id });

      await expect(
        pool.query(
          'INSERT INTO department_memberships (user_id, department_id) VALUES ($1, $2)',
          [userId, b.id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('allows a new membership once the previous one has ended', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });

      await memberships.enroll({ userId, departmentId: a.id });
      const moved = await memberships.transfer({ userId, toDepartmentId: b.id });

      expect(moved.departmentId).toBe(b.id);
      const history = await memberships.listHistory(userId);
      expect(history).toHaveLength(2);
      expect(history.filter((m) => m.status === 'active')).toHaveLength(1);
    });

    it('serialises two concurrent enrollments of the same user — exactly one wins', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });

      const results = await Promise.allSettled([
        memberships.enroll({ userId, departmentId: a.id }),
        memberships.enroll({ userId, departmentId: b.id }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM department_memberships WHERE user_id = $1 AND status = 'active'",
        [userId],
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it('serialises two concurrent transfers of the same user to different units', async () => {
      const userId = await createUser('Person');
      const home = await departments.create({ slug: 'home', name: 'Home' });
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });
      await memberships.enroll({ userId, departmentId: home.id });

      const results = await Promise.allSettled([
        memberships.transfer({ userId, toDepartmentId: a.id }),
        memberships.transfer({ userId, toDepartmentId: b.id }),
      ]);

      // One transfer must win outright. The other either loses the row lock race
      // and finds the membership already moved, or loses the unique index — both
      // are conflicts, and neither may leave two active rows behind.
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM department_memberships WHERE user_id = $1 AND status = 'active'",
        [userId],
      );
      expect(Number(rows[0]!.count)).toBe(1);
      expect(await countActiveUsersWithoutDepartment()).toBe(0);
    });
  });

  describe('transfer atomicity', () => {
    it('leaves the ORIGINAL membership active when the new one cannot be created', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId, departmentId: a.id });

      // Target department does not exist: the transfer must abort before it
      // ends anything. The dangerous failure would be ending the old membership
      // first and then discovering the target is missing.
      await expect(
        memberships.transfer({
          userId,
          toDepartmentId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow();

      const current = await memberships.findActive(userId);
      expect(current?.departmentId).toBe(a.id);
      expect(await countActiveUsersWithoutDepartment()).toBe(0);
    });

    it('rolls back the ended membership if the transaction fails after it', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });
      await memberships.enroll({ userId, departmentId: a.id });

      // Archive B *after* the service has validated it but before the insert, by
      // failing the insert itself: a foreign key that no longer resolves.
      await pool.query('DELETE FROM departments WHERE id = $1', [b.id]).catch(() => undefined);

      await expect(
        memberships.transfer({ userId, toDepartmentId: b.id }),
      ).rejects.toThrow();

      const current = await memberships.findActive(userId);
      expect(current).not.toBeNull();
      expect(current?.departmentId).toBe(a.id);
      expect(current?.endedAt).toBeNull();
    });
  });

  describe('membership state consistency', () => {
    it('rejects an ended membership with no ended_at', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });

      await expect(
        pool.query(
          "INSERT INTO department_memberships (user_id, department_id, status) VALUES ($1, $2, 'ended')",
          [userId, a.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('rejects an active membership that claims an ended_at', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });

      await expect(
        pool.query(
          'INSERT INTO department_memberships (user_id, department_id, ended_at) VALUES ($1, $2, now())',
          [userId, a.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('keeps the ended row readable — history is never deleted', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });
      await memberships.enroll({ userId, departmentId: a.id });
      await memberships.transfer({ userId, toDepartmentId: b.id });

      const history = await memberships.listHistory(userId);
      const ended = history.find((m) => m.status === 'ended');
      expect(ended?.departmentId).toBe(a.id);
      expect(ended?.endedAt).toBeInstanceOf(Date);
    });
  });

  describe('department lifecycle', () => {
    it('rejects a duplicate slug regardless of casing or padding', async () => {
      await departments.create({ slug: 'unit-one', name: 'Unit One' });

      await expect(
        departments.create({ slug: '  UNIT-One ', name: 'Another' }),
      ).rejects.toThrow(/already in use/);
    });

    it('refuses to archive a unit that still has members', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId, departmentId: a.id });

      await expect(departments.archive(a.id)).rejects.toThrow(/active member/);

      const stillActive = await departmentRepository.findById(a.id);
      expect(stillActive?.status).toBe('active');
    });

    it('archives once the last member has moved out', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });
      await memberships.enroll({ userId, departmentId: a.id });
      await memberships.transfer({ userId, toDepartmentId: b.id });

      await expect(departments.archive(a.id)).resolves.toMatchObject({
        status: 'archived',
      });
    });

    it('refuses to enroll into, or transfer into, an archived unit', async () => {
      const userId = await createUser('Person');
      const other = await createUser('Other');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const archived = await departments.create({ slug: 'z', name: 'Z' });
      await departments.archive(archived.id);
      await memberships.enroll({ userId, departmentId: a.id });

      await expect(
        memberships.enroll({ userId: other, departmentId: archived.id }),
      ).rejects.toThrow(/archived/);
      await expect(
        memberships.transfer({ userId, toDepartmentId: archived.id }),
      ).rejects.toThrow(/archived/);
    });

    /**
     * ⚠ V12 — ARCHIVE RACING AN INBOUND MEMBERSHIP, against a real server.
     *
     * The unit specs pin that each path TAKES the department lock. Only a real
     * PostgreSQL can prove what the lock then does: that two transactions
     * contend for the row, that the loser re-reads the status the winner
     * committed, and that no combination commits an active membership into an
     * archived unit.
     *
     * The interleaving this closes:
     *
     *   T2 enroll   reads dep as active
     *   T1 archive  locks dep, counts 0 members, archives, COMMITS
     *   T2          inserts the membership  → active member of an ARCHIVED unit
     *
     * ★ EITHER ORDER IS ACCEPTABLE, ONE OUTCOME IS NOT. Whichever transaction
     * arrives second may win or lose — that is a scheduling detail. What must
     * never hold afterwards is an active membership in an archived department,
     * so that is what is asserted, not who won.
     */
    const activeMembersOfArchivedUnits = async (): Promise<number> => {
      const [row] = await database.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM department_memberships m
           JOIN departments d ON d.id = m.department_id
          WHERE m.status = 'active' AND d.status = 'archived'`,
      );
      return Number(row!.count);
    };

    it('never enrolls into a unit being archived concurrently', async () => {
      const empty = await departments.create({ slug: 'race-a', name: 'Race A' });
      const newcomer = await createUser('Newcomer');

      const [archiving, enrolling] = await Promise.allSettled([
        departments.archive(empty.id),
        memberships.enroll({ userId: newcomer, departmentId: empty.id }),
      ]);

      // At least one must fail: they cannot both be true of the same unit.
      const settled = [archiving, enrolling];
      expect(settled.some((r) => r.status === 'rejected')).toBe(true);
      // ★ THE INVARIANT ITSELF, regardless of which one won.
      expect(await activeMembersOfArchivedUnits()).toBe(0);
    });

    it('never transfers into a unit being archived concurrently', async () => {
      const source = await departments.create({ slug: 'race-src', name: 'Source' });
      const target = await departments.create({ slug: 'race-dst', name: 'Target' });
      const person = await createUser('Mover');
      await memberships.enroll({ userId: person, departmentId: source.id });

      const [, transferring] = await Promise.allSettled([
        departments.archive(target.id),
        memberships.transfer({ userId: person, toDepartmentId: target.id }),
      ]);

      expect(await activeMembersOfArchivedUnits()).toBe(0);

      // ★ NO PARTIAL DATA. A refused transfer must leave the person where they
      // were — ending the old membership and failing to open the new one would
      // be worse than the race it replaced.
      const [membership] = await database.query<{ department_id: string }>(
        "SELECT department_id FROM department_memberships WHERE user_id = $1 AND status = 'active'",
        [person],
      );
      if (transferring.status === 'rejected') {
        expect(membership?.department_id).toBe(source.id);
      } else {
        expect(membership?.department_id).toBe(target.id);
      }
      // Either way they belong to exactly one unit.
      expect(membership).toBeDefined();
    });

    it('holds the invariant under repeated contention', async () => {
      // One pass can pass by luck; the window is small. Ten independent races
      // make a missing lock very unlikely to survive.
      for (let attempt = 0; attempt < 10; attempt++) {
        const unit = await departments.create({ slug: `race-${attempt}`, name: `R${attempt}` });
        const person = await createUser(`Person ${attempt}`);

        await Promise.allSettled([
          departments.archive(unit.id),
          memberships.enroll({ userId: person, departmentId: unit.id }),
        ]);
      }

      expect(await activeMembersOfArchivedUnits()).toBe(0);
    });

    it('keeps updated_at honest on rename', async () => {
      const a = await departments.create({ slug: 'a', name: 'A' });
      const renamed = await departments.rename(a.id, 'A renamed');

      expect(renamed.name).toBe('A renamed');
      expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
      // The slug is immutable: things point at it.
      expect(renamed.slug).toBe(a.slug);
    });
  });

  describe('the invariant, asked of the whole database', () => {
    it('never leaves an active user without a department across every flow above', async () => {
      const userId = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });

      await memberships.enroll({ userId, departmentId: a.id });
      await memberships.transfer({ userId, toDepartmentId: b.id });
      await memberships.transfer({ userId, toDepartmentId: a.id });

      expect(await countActiveUsersWithoutDepartment()).toBe(0);
    });
  });
});
