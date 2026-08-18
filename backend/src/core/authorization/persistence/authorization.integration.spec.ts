import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Database, DatabaseQuery } from '../../../common/types/database.port';
import { SessionRepository } from '../../identity/persistence/session.repository';
import { SessionService } from '../../identity/application/session.service';
import { DepartmentRepository } from '../../organization/persistence/department.repository';
import { MembershipRepository } from '../../organization/persistence/membership.repository';
import { DepartmentService } from '../../organization/application/department.service';
import { MembershipService } from '../../organization/application/membership.service';
import { AuthorizationRepository } from './authorization.repository';
import { AuthorizationService } from '../application/authorization.service';
import { can } from '../domain/authorization.context';

/**
 * Authorization against a REAL PostgreSQL.
 *
 * The context spec next door proves the RULE. This file proves the things only
 * a real server can settle, and every one of them is an invariant the whole
 * model rests on:
 *
 *   #1  one active SuperAdmin, including under a concurrent grant
 *   #2  one active head per department, including under a concurrent grant
 *   #6  an active head holds an active membership of the same department —
 *       in BOTH directions, including ending that membership
 *   #7  the API cannot leave the deployment with zero SuperAdmins
 *       provenance CHECKs, and the hand-over transaction
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;

/** Its own schema — the migration-runner suite drops `public` between cases. */
const SCHEMA = 'authorization_itest';

function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(
      `DATABASE_URL_TEST points at "${name}", which is not named as a test database.`,
    );
  }
}

describeIntegration('Authorization against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let database: Database;
  let departments: DepartmentService;
  let memberships: MembershipService;
  let authorization: AuthorizationService;
  let authorizationRepository: AuthorizationRepository;

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({ connectionString: TEST_URL, max: 8, options: `-c search_path=${SCHEMA}` });

    const migrations = join(__dirname, '..', '..', '..', '..', 'migrations');
    for (const file of [
      '0001_identity.sql',
      '0002_users_updated_at.sql',
      '0003_organization.sql',
      '0004_authorization.sql',
      '0005_identity_credential_state.sql',
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

    const departmentRepository = new DepartmentRepository(database);
    const membershipRepository = new MembershipRepository(database);
    departments = new DepartmentService(database, departmentRepository, membershipRepository);
    memberships = new MembershipService(database, departmentRepository, membershipRepository);
    authorizationRepository = new AuthorizationRepository(database);
    authorization = new AuthorizationService(
      database,
      authorizationRepository,
      departmentRepository,
      membershipRepository,
      new SessionService(new SessionRepository(database)),
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE role_assignments, department_memberships, departments, sessions, identities, users CASCADE',
    );
  });

  const createUser = async (name: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING id',
      [name],
    );
    return rows[0]!.id;
  };

  // ------------------------------------------------------------ invariant #1 --

  describe('invariant #1 — one active SuperAdmin', () => {
    it('accepts the first bootstrap and rejects a second', async () => {
      const first = await createUser('First');
      const second = await createUser('Second');

      const granted = await authorization.bootstrapSuperAdmin(first);
      expect(granted.grantedVia).toBe('bootstrap');
      expect(granted.grantedBy).toBeNull();

      await expect(authorization.bootstrapSuperAdmin(second)).rejects.toThrow(
        /already an active SuperAdmin/,
      );
    });

    it('lets exactly one of two concurrent grants win', async () => {
      const a = await createUser('A');
      const b = await createUser('B');

      const results = await Promise.allSettled([
        authorization.bootstrapSuperAdmin(a),
        authorization.bootstrapSuperAdmin(b),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM role_assignments WHERE role_key = 'SUPERADMIN' AND status = 'active'",
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it('hands over atomically, cutting the previous holder’s sessions', async () => {
      const oldAdmin = await createUser('Old');
      const newAdmin = await createUser('New');
      await authorization.bootstrapSuperAdmin(oldAdmin);

      const sessions = new SessionService(new SessionRepository(database));
      await sessions.issue(oldAdmin);

      await authorization.transferSuperAdmin({ toUserId: newAdmin, actingUserId: oldAdmin });

      const active = await authorizationRepository.findActiveSuperAdmin();
      expect(active?.userId).toBe(newAdmin);
      expect(active?.grantedVia).toBe('api');
      expect(active?.grantedBy).toBe(oldAdmin);

      const { rows } = await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [oldAdmin],
      );
      expect(Number(rows[0]!.count)).toBe(0);

      const total = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM role_assignments WHERE role_key = 'SUPERADMIN' AND status = 'active'",
      );
      expect(Number(total.rows[0]!.count)).toBe(1);
    });
  });

  // ------------------------------------------------------------ invariant #7 --

  describe('invariant #7 — the API cannot reach zero SuperAdmins', () => {
    it('refuses to revoke the only SuperAdmin through the API', async () => {
      const admin = await createUser('Admin');
      const assignment = await authorization.bootstrapSuperAdmin(admin);

      await expect(
        authorization.revokeAssignment({ assignmentId: assignment.id, revokedBy: admin }),
      ).rejects.toThrow(/no SuperAdmin/);

      expect(await authorizationRepository.findActiveSuperAdmin()).not.toBeNull();
    });
  });

  // ------------------------------------------------------------ invariant #2 --

  describe('invariant #2 — one active head per department', () => {
    it('rejects a second head for the same department', async () => {
      const admin = await createUser('Admin');
      const one = await createUser('One');
      const two = await createUser('Two');
      const dept = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: one, departmentId: dept.id });
      await memberships.enroll({ userId: two, departmentId: dept.id });

      await authorization.assignDepartmentHead({
        userId: one,
        departmentId: dept.id,
        grantedBy: admin,
      });

      await expect(
        authorization.assignDepartmentHead({
          userId: two,
          departmentId: dept.id,
          grantedBy: admin,
        }),
      ).rejects.toThrow(/already has an active head/);
    });

    it('lets exactly one of two concurrent head grants win', async () => {
      const admin = await createUser('Admin');
      const one = await createUser('One');
      const two = await createUser('Two');
      const dept = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: one, departmentId: dept.id });
      await memberships.enroll({ userId: two, departmentId: dept.id });

      const results = await Promise.allSettled([
        authorization.assignDepartmentHead({ userId: one, departmentId: dept.id, grantedBy: admin }),
        authorization.assignDepartmentHead({ userId: two, departmentId: dept.id, grantedBy: admin }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM role_assignments
          WHERE role_key = 'DEPARTMENT_HEAD' AND scope_id = $1 AND status = 'active'`,
        [dept.id],
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });
  });

  // ------------------------------------------------------------ invariant #6 --

  describe('invariant #6 — an active head holds an active membership of that unit', () => {
    it('grants a head who is a member of that department', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const dept = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: dept.id });

      const granted = await authorization.assignDepartmentHead({
        userId: person,
        departmentId: dept.id,
        grantedBy: admin,
      });
      expect(granted.scopeId).toBe(dept.id);
      expect(granted.membershipId).not.toBeNull();
    });

    it('refuses a head whose membership is in another department', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });
      await memberships.enroll({ userId: person, departmentId: a.id });

      await expect(
        authorization.assignDepartmentHead({ userId: person, departmentId: b.id, grantedBy: admin }),
      ).rejects.toThrow(/active membership/);
    });

    it('refuses a head with no membership at all', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });

      await expect(
        authorization.assignDepartmentHead({ userId: person, departmentId: a.id, grantedBy: admin }),
      ).rejects.toThrow(/active membership/);
    });

    it('★ refuses to end the membership while the head assignment is still active', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      // The foreign key, not the service, is what refuses this.
      await expect(
        memberships.transfer({ userId: person, toDepartmentId: b.id }),
      ).rejects.toMatchObject({ code: '23503' });

      const membership = await memberships.findActive(person);
      expect(membership?.departmentId).toBe(a.id);
    });

    it('allows the transfer once leadership has been revoked first', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      const b = await departments.create({ slug: 'b', name: 'B' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      const head = await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      await authorization.revokeAssignment({ assignmentId: head.id, revokedBy: admin });
      const moved = await memberships.transfer({ userId: person, toDepartmentId: b.id });

      expect(moved.departmentId).toBe(b.id);
    });

    it('revoking leadership leaves the user active and still in their unit', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      const head = await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      await authorization.revokeAssignment({ assignmentId: head.id, revokedBy: admin });

      const context = await authorization.loadContext(person);
      expect(context.headOf).toEqual([]);
      expect(context.memberOf).toEqual([a.id]);

      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM users WHERE id = $1',
        [person],
      );
      expect(rows[0]!.status).toBe('active');
    });

    /**
     * The department-keyed revocation the HTTP layer uses.
     *
     * Same act, addressed by unit instead of by assignment, and the lookup has
     * to share the revocation's transaction: done as two calls the head could
     * change in between, and the caller would revoke somebody they never saw.
     */
    it('revokes by department, leaving the person a member', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      const revoked = await authorization.revokeHeadOfDepartment({
        departmentId: a.id,
        revokedBy: admin,
      });

      expect(revoked.userId).toBe(person);
      expect(revoked.status).toBe('revoked');
      expect(revoked.revokedBy).toBe(admin);

      const context = await authorization.loadContext(person);
      expect(context.headOf).toEqual([]);
      expect(context.memberOf).toEqual([a.id]);
      expect(await authorization.findActiveHeadOfDepartment(a.id)).toBeNull();
    });

    it('refuses to revoke a department that has no head', async () => {
      const admin = await createUser('Admin');
      const a = await departments.create({ slug: 'a', name: 'A' });

      await expect(
        authorization.revokeHeadOfDepartment({ departmentId: a.id, revokedBy: admin }),
      ).rejects.toThrow(/no active head/);
    });

    it('lets exactly one of two concurrent revocations win', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      const results = await Promise.allSettled([
        authorization.revokeHeadOfDepartment({ departmentId: a.id, revokedBy: admin }),
        authorization.revokeHeadOfDepartment({ departmentId: a.id, revokedBy: admin }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      // And the loser is told the truth rather than silently succeeding.
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as Error).message).toMatch(/no active head|already revoked/);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM role_assignments
          WHERE scope_id = $1 AND role_key = 'DEPARTMENT_HEAD' AND status = 'revoked'`,
        [a.id],
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it('a revoked head can be replaced, and the unique index allows it', async () => {
      const admin = await createUser('Admin');
      const first = await createUser('First');
      const second = await createUser('Second');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: first, departmentId: a.id });
      await memberships.enroll({ userId: second, departmentId: a.id });
      await authorization.assignDepartmentHead({
        userId: first,
        departmentId: a.id,
        grantedBy: admin,
      });

      await authorization.revokeHeadOfDepartment({ departmentId: a.id, revokedBy: admin });
      const replacement = await authorization.assignDepartmentHead({
        userId: second,
        departmentId: a.id,
        grantedBy: admin,
      });

      expect(replacement.userId).toBe(second);
      // The old row is kept, revoked: leadership history survives the change.
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM role_assignments
          WHERE scope_id = $1 AND role_key = 'DEPARTMENT_HEAD'`,
        [a.id],
      );
      expect(Number(rows[0]!.count)).toBe(2);
    });
  });

  // ------------------------------------------------------------- provenance --

  describe('provenance', () => {
    it('rejects an api grant with no actor, and a bootstrap grant with one', async () => {
      const person = await createUser('Person');

      await expect(
        pool.query(
          `INSERT INTO role_assignments (user_id, role_key, scope_type, granted_via)
           VALUES ($1, 'SUPERADMIN', 'GLOBAL', 'api')`,
          [person],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        pool.query(
          `INSERT INTO role_assignments (user_id, role_key, scope_type, granted_via, granted_by)
           VALUES ($1, 'SUPERADMIN', 'GLOBAL', 'bootstrap', $1)`,
          [person],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('records who revoked, and how', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      const head = await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      const revoked = await authorization.revokeAssignment({
        assignmentId: head.id,
        revokedBy: admin,
      });

      expect(revoked.revokedVia).toBe('api');
      expect(revoked.revokedBy).toBe(admin);
      expect(revoked.revokedAt).toBeInstanceOf(Date);
    });

    it('rejects a revoked_via that names no known path', async () => {
      const person = await createUser('Person');
      await expect(
        pool.query(
          `INSERT INTO role_assignments
             (user_id, role_key, scope_type, granted_via, status, revoked_at, revoked_via)
           VALUES ($1, 'SUPERADMIN', 'GLOBAL', 'bootstrap', 'revoked', now(), 'magic')`,
          [person],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // --------------------------------------------------------- context loader --

  describe('AuthorizationContext, loaded from real rows', () => {
    it('describes a SuperAdmin as global with no departments', async () => {
      const admin = await createUser('Admin');
      await authorization.bootstrapSuperAdmin(admin);

      const context = await authorization.loadContext(admin);
      expect(context).toMatchObject({ global: true, headOf: [], memberOf: [] });
      expect(can(context, 'user.write')).toBe(true);
    });

    it('describes a head as head and member of the same one department', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      const context = await authorization.loadContext(person);
      expect(context.global).toBe(false);
      expect(context.headOf).toEqual([a.id]);
      expect(context.memberOf).toEqual([a.id]);
      expect(can(context, 'unit.member.read', { departmentId: a.id })).toBe(true);
      expect(can(context, 'unit.member.write', { departmentId: a.id })).toBe(false);
    });

    it('describes a plain member with no elevated relation', async () => {
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });

      const context = await authorization.loadContext(person);
      expect(context).toMatchObject({ global: false, headOf: [], memberOf: [a.id] });
    });

    it('describes a user with nothing at all, fail-closed', async () => {
      const person = await createUser('Person');

      const context = await authorization.loadContext(person);
      expect(context).toMatchObject({ global: false, headOf: [], memberOf: [] });
      expect(can(context, 'unit.read', { departmentId: 'anything' })).toBe(false);
    });

    it('reflects a revoked role IMMEDIATELY — nothing is cached', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      const head = await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      expect((await authorization.loadContext(person)).headOf).toEqual([a.id]);
      await authorization.revokeAssignment({ assignmentId: head.id, revokedBy: admin });
      expect((await authorization.loadContext(person)).headOf).toEqual([]);
    });

    it('reports a temporary credential, which denies everything', async () => {
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      await pool.query(
        `INSERT INTO identities (user_id, provider, subject, secret_hash, must_change_secret)
         VALUES ($1, 'local', 'temp@example.com', 'hash', true)`,
        [person],
      );

      const context = await authorization.loadContext(person);
      expect(context.mustChangeSecret).toBe(true);
      expect(can(context, 'unit.read', { departmentId: a.id })).toBe(false);
    });

    it('derives the username from the local identity, and never uses it to decide', async () => {
      const person = await createUser('Person');
      await pool.query(
        `INSERT INTO identities (user_id, provider, subject, secret_hash)
         VALUES ($1, 'local', 'hieu.truong@example.com', 'hash')`,
        [person],
      );

      expect(await authorization.findLocalSubject(person)).toBe('hieu.truong@example.com');
    });
  });

  // ------------------------------------------------------ cross-invariant --

  describe('the whole database, after every flow above', () => {
    it('never holds an active head whose membership is not active in that same unit', async () => {
      const admin = await createUser('Admin');
      const person = await createUser('Person');
      const a = await departments.create({ slug: 'a', name: 'A' });
      await memberships.enroll({ userId: person, departmentId: a.id });
      await authorization.assignDepartmentHead({
        userId: person,
        departmentId: a.id,
        grantedBy: admin,
      });

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM role_assignments ra
           LEFT JOIN department_memberships m ON m.id = ra.membership_id
          WHERE ra.role_key = 'DEPARTMENT_HEAD'
            AND ra.status = 'active'
            AND (m.status IS DISTINCT FROM 'active'
                 OR m.department_id IS DISTINCT FROM ra.scope_id
                 OR m.user_id IS DISTINCT FROM ra.user_id)`,
      );
      expect(Number(rows[0]!.count)).toBe(0);
    });
  });
});
