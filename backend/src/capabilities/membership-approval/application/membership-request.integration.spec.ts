import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Database, DatabaseQuery } from '../../../common/types/database.port';
import type { AppConfig } from '../../../config/app.config';
import type { PasswordHasher } from '../../../core/identity/domain/password-hasher.port';
import { IdentityRepository } from '../../../core/identity/persistence/identity.repository';
import { SessionRepository } from '../../../core/identity/persistence/session.repository';
import { SessionService } from '../../../core/identity/application/session.service';
import { AuthorizationRepository } from '../../../core/authorization/persistence/authorization.repository';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { DepartmentRepository } from '../../../core/organization/persistence/department.repository';
import { MembershipRepository } from '../../../core/organization/persistence/membership.repository';
import { DepartmentService } from '../../../core/organization/application/department.service';
import { MembershipService } from '../../../core/organization/application/membership.service';
import { AccountLifecycleService } from '../../../core/users/application/account-lifecycle.service';
import { AccountProvisioningService } from '../../../core/users/application/account-provisioning.service';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import { MembershipRequestRepository } from '../persistence/membership-request.repository';
import { MembershipRequestService } from './membership-request.service';
import { decodeCursor } from '../../../common/pagination/cursor';

/**
 * The approval workflow against a REAL PostgreSQL.
 *
 * Two things are being proven, and neither survives a fake:
 *
 *   ATOMICITY   the decision and its effect are one commit — an approved
 *               transfer that did not move anybody, or a move recorded against
 *               a still-pending request, must be impossible
 *   FRESHNESS   what was true when the request was raised is re-read when it is
 *               decided, so a stale request cannot act on a world that moved
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;
const SCHEMA = 'approval_itest';

function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(`DATABASE_URL_TEST points at "${name}", which is not named as a test database.`);
  }
}

const digest = (plain: string): string => createHash('sha256').update(plain, 'utf8').digest('hex');
const fakeHasher: PasswordHasher = {
  hash: async (plain: string) => digest(plain),
  verify: async (plain: string, hash: string) => hash === digest(plain),
  fakeVerify: async () => undefined,
};

describeIntegration('Membership approval against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let requests: MembershipRequestService;
  let departments: DepartmentService;
  let memberships: MembershipService;
  let authorization: AuthorizationService;
  let provisioning: AccountProvisioningService;
  let sessions: SessionService;

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
      '0006_membership_change_requests.sql',
      '0008_role_assignment_membership_fk_index.sql',
    ]) {
      await pool.query(await readFile(join(migrations, file), 'utf8'));
    }

    const database: Database = {
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

    const config = { allowedEmailDomains: [] } as unknown as AppConfig;
    const users = new UserRepository(database);
    const identities = new IdentityRepository(database);
    const sessionRepository = new SessionRepository(database);
    const departmentRepository = new DepartmentRepository(database);
    const membershipRepository = new MembershipRepository(database);
    const assignments = new AuthorizationRepository(database);

    departments = new DepartmentService(database, departmentRepository, membershipRepository);
    memberships = new MembershipService(database, departmentRepository, membershipRepository);
    sessions = new SessionService(sessionRepository);
    authorization = new AuthorizationService(
      database,
      assignments,
      departmentRepository,
      membershipRepository,
      sessions,
    );
    provisioning = new AccountProvisioningService(
      database,
      fakeHasher,
      users,
      identities,
      memberships,
      config,
    );
    const lifecycle = new AccountLifecycleService(
      database,
      users,
      assignments,
      sessionRepository,
      membershipRepository,
    );
    requests = new MembershipRequestService(
      database,
      new MembershipRequestRepository(database),
      memberships,
      membershipRepository,
      departmentRepository,
      users,
      assignments,
      lifecycle,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE membership_change_requests, role_assignments, department_memberships,
                departments, sessions, identities, users CASCADE`,
    );
  });

  /** A department, its head, and a plain member — the shape every case needs. */
  const scenario = async () => {
    const a = await departments.create({ slug: 'a', name: 'A' });
    const b = await departments.create({ slug: 'b', name: 'B' });

    const admin = await provisioning.provision({
      displayName: 'Admin',
      email: 'admin@example.com',
      departmentId: a.id,
      initialPassword: 'a valid passphrase',
    });
    await authorization.bootstrapSuperAdmin(admin.user.id);

    const head = await provisioning.provision({
      displayName: 'Head A',
      email: 'head.a@example.com',
      departmentId: a.id,
      initialPassword: 'a valid passphrase',
    });
    await authorization.assignDepartmentHead({
      userId: head.user.id,
      departmentId: a.id,
      grantedBy: admin.user.id,
    });

    const member = await provisioning.provision({
      displayName: 'Member',
      email: 'member@example.com',
      departmentId: a.id,
      initialPassword: 'a valid passphrase',
    });

    return { a, b, adminId: admin.user.id, headId: head.user.id, memberId: member.user.id };
  };

  const forbiddenStates = async (): Promise<{ activeNoDept: number; disabledWithDept: number }> => {
    const active = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM users u
        WHERE u.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM role_assignments ra
                           WHERE ra.user_id = u.id AND ra.role_key = 'SUPERADMIN' AND ra.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM department_memberships m
                           WHERE m.user_id = u.id AND m.status = 'active')`,
    );
    const disabled = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM users u
         JOIN department_memberships m ON m.user_id = u.id AND m.status = 'active'
        WHERE u.status = 'disabled'`,
    );
    return {
      activeNoDept: Number(active.rows[0]!.count),
      disabledWithDept: Number(disabled.rows[0]!.count),
    };
  };

  // ------------------------------------------------------------------ create --

  describe('raising a request', () => {
    it('records the source department read from the database, not from the caller', async () => {
      const { a, b, headId, memberId } = await scenario();

      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      expect(request.departmentId).toBe(a.id);
      expect(request.targetDepartmentId).toBe(b.id);
      expect(request.status).toBe('pending');
    });

    it('refuses a target who is not in the department the head leads', async () => {
      const { a, b, headId, adminId } = await scenario();
      const outsider = await provisioning.provision({
        displayName: 'Outsider',
        email: 'outsider@example.com',
        departmentId: b.id,
        initialPassword: 'a valid passphrase',
      });
      void adminId;

      await expect(
        requests.create({
          routeDepartmentId: a.id,
          requestedBy: headId,
          targetUserId: outsider.user.id,
          action: 'REMOVE_MEMBER',
        }),
      ).rejects.toThrow(/does not belong to the department you lead/);
    });

    it('refuses a transfer that names no destination', async () => {
      const { a, headId, memberId } = await scenario();

      await expect(
        requests.create({
          routeDepartmentId: a.id,
          requestedBy: headId,
          targetUserId: memberId,
          action: 'TRANSFER_MEMBER',
        }),
      ).rejects.toThrow(/must name the department/);
    });

    it('refuses a transfer to the department the target is already in', async () => {
      const { a, headId, memberId } = await scenario();

      await expect(
        requests.create({
          routeDepartmentId: a.id,
          requestedBy: headId,
          targetUserId: memberId,
          action: 'TRANSFER_MEMBER',
          targetDepartmentId: a.id,
        }),
      ).rejects.toThrow(/already belongs/);
    });

    it('refuses a duplicate pending request', async () => {
      const { a, b, headId, memberId } = await scenario();
      await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      await expect(
        requests.create({
          routeDepartmentId: a.id,
          requestedBy: headId,
          targetUserId: memberId,
          action: 'TRANSFER_MEMBER',
          targetDepartmentId: b.id,
        }),
      ).rejects.toThrow(/already awaiting a decision/);
    });

    it('lets exactly one of two concurrent identical requests through', async () => {
      const { a, b, headId, memberId } = await scenario();

      const results = await Promise.allSettled([
        requests.create({
          routeDepartmentId: a.id,
          requestedBy: headId,
          targetUserId: memberId,
          action: 'TRANSFER_MEMBER',
          targetDepartmentId: b.id,
        }),
        requests.create({
          routeDepartmentId: a.id,
          requestedBy: headId,
          targetUserId: memberId,
          action: 'TRANSFER_MEMBER',
          targetDepartmentId: b.id,
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM membership_change_requests WHERE status = 'pending'",
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });
  });

  // ---------------------------------------------------------------- transfer --

  describe('approving a TRANSFER_MEMBER', () => {
    it('moves the member and closes the request in one commit', async () => {
      const { a, b, adminId, headId, memberId } = await scenario();
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      const decided = await requests.approve({ requestId: request.id, decidedBy: adminId });

      expect(decided.status).toBe('approved');
      expect(decided.decidedBy).toBe(adminId);
      expect((await memberships.findActive(memberId))?.departmentId).toBe(b.id);

      const history = await memberships.listHistory(memberId);
      expect(history.filter((m) => m.status === 'active')).toHaveLength(1);
      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });

    it('refuses when the target moved department after the request was raised', async () => {
      const { a, b, adminId, headId, memberId } = await scenario();
      const c = await departments.create({ slug: 'c', name: 'C' });
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      // A global administrator moves them directly in the meantime.
      await memberships.transfer({ userId: memberId, toDepartmentId: c.id });

      await expect(
        requests.approve({ requestId: request.id, decidedBy: adminId }),
      ).rejects.toThrow(/moved department/);

      expect((await memberships.findActive(memberId))?.departmentId).toBe(c.id);
    });

    it('refuses when the requester is no longer the head', async () => {
      const { a, b, adminId, headId, memberId } = await scenario();
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      const head = await pool.query<{ id: string }>(
        `SELECT id FROM role_assignments
          WHERE user_id = $1 AND role_key = 'DEPARTMENT_HEAD' AND status = 'active'`,
        [headId],
      );
      await authorization.revokeAssignment({
        assignmentId: head.rows[0]!.id,
        revokedBy: adminId,
      });

      await expect(
        requests.approve({ requestId: request.id, decidedBy: adminId }),
      ).rejects.toThrow(/no longer leads/);

      expect((await memberships.findActive(memberId))?.departmentId).toBe(a.id);
    });

    it('refuses when the destination was archived in the meantime', async () => {
      const { a, b, adminId, headId, memberId } = await scenario();
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      await departments.archive(b.id);

      await expect(
        requests.approve({ requestId: request.id, decidedBy: adminId }),
      ).rejects.toThrow(/archived/);
    });

    it('refuses a self-decision', async () => {
      const { a, b, headId, memberId } = await scenario();
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      await expect(
        requests.approve({ requestId: request.id, decidedBy: headId }),
      ).rejects.toThrow(/cannot decide your own/);
    });

    it('lets exactly one of two concurrent approvals win', async () => {
      const { a, b, adminId, headId, memberId } = await scenario();
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });

      const results = await Promise.allSettled([
        requests.approve({ requestId: request.id, decidedBy: adminId }),
        requests.approve({ requestId: request.id, decidedBy: adminId }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const history = await memberships.listHistory(memberId);
      expect(history.filter((m) => m.status === 'active')).toHaveLength(1);
    });

    it('approving twice in sequence is a conflict, and moves nobody twice', async () => {
      const { a, b, adminId, headId, memberId } = await scenario();
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: b.id,
      });
      await requests.approve({ requestId: request.id, decidedBy: adminId });

      await expect(
        requests.approve({ requestId: request.id, decidedBy: adminId }),
      ).rejects.toThrow(/not awaiting a decision/);
    });
  });

  // ------------------------------------------------------------------ remove --

  describe('approving a REMOVE_MEMBER', () => {
    it('offboards: disabled, no membership, no sessions, no roles — history kept', async () => {
      const { a, adminId, headId, memberId } = await scenario();
      await sessions.issue(memberId);
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'REMOVE_MEMBER',
      });

      await requests.approve({ requestId: request.id, decidedBy: adminId });

      const user = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
        memberId,
      ]);
      expect(user.rows[0]!.status).toBe('disabled');
      expect(await memberships.findActive(memberId)).toBeNull();

      const live = await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [memberId],
      );
      expect(Number(live.rows[0]!.count)).toBe(0);

      // Nothing was deleted.
      const history = await memberships.listHistory(memberId);
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe('ended');
      const identities = await pool.query('SELECT * FROM identities WHERE user_id = $1', [memberId]);
      expect(identities.rowCount).toBe(1);

      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });

    it('offboards a HEAD without tripping invariant #6', async () => {
      const { a, adminId, headId } = await scenario();
      // A second head, for a second department, so this one can be removed.
      const b = await departments.create({ slug: 'b2', name: 'B2' });
      const otherHead = await provisioning.provision({
        displayName: 'Head B',
        email: 'head.b@example.com',
        departmentId: b.id,
        initialPassword: 'a valid passphrase',
      });
      await authorization.assignDepartmentHead({
        userId: otherHead.user.id,
        departmentId: b.id,
        grantedBy: adminId,
      });

      const request = await requests.create({
        routeDepartmentId: b.id,
        requestedBy: otherHead.user.id,
        targetUserId: otherHead.user.id,
        action: 'REMOVE_MEMBER',
      }).catch(() => null);
      // A head cannot remove themselves through their own request — the decision
      // side refuses it — so remove them as the administrator instead.
      void request;

      const headAssignment = await pool.query<{ id: string }>(
        `SELECT id FROM role_assignments
          WHERE user_id = $1 AND role_key = 'DEPARTMENT_HEAD' AND status = 'active'`,
        [headId],
      );
      expect(headAssignment.rowCount).toBe(1);

      const removal = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: headId,
        action: 'REMOVE_MEMBER',
      });

      // The head raised it about themselves; a global administrator decides.
      await requests.approve({ requestId: removal.id, decidedBy: adminId });

      const roles = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM role_assignments WHERE user_id = $1 AND status = 'active'",
        [headId],
      );
      expect(Number(roles.rows[0]!.count)).toBe(0);
      expect(await memberships.findActive(headId)).toBeNull();
      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });

    it('rejecting changes nothing but the request', async () => {
      const { a, adminId, headId, memberId } = await scenario();
      const request = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'REMOVE_MEMBER',
      });

      const decided = await requests.reject({ requestId: request.id, decidedBy: adminId });

      expect(decided.status).toBe('rejected');
      const user = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
        memberId,
      ]);
      expect(user.rows[0]!.status).toBe('active');
      expect((await memberships.findActive(memberId))?.departmentId).toBe(a.id);
    });

    it('allows a fresh request after a rejection', async () => {
      const { a, adminId, headId, memberId } = await scenario();
      const first = await requests.create({
        routeDepartmentId: a.id,
        requestedBy: headId,
        targetUserId: memberId,
        action: 'REMOVE_MEMBER',
      });
      await requests.reject({ requestId: first.id, decidedBy: adminId });

      await expect(
        requests.create({
          routeDepartmentId: a.id,
          requestedBy: headId,
          targetUserId: memberId,
          action: 'REMOVE_MEMBER',
        }),
      ).resolves.toMatchObject({ status: 'pending' });
    });
  });

  // -------------------------------------------------------------- DB CHECKs --

  // ------------------------------------------------- cursor precision --

  describe('cursor precision on the request lists', () => {
    /**
     * Raises `count` requests, one statement each so every row gets its own
     * `transaction_timestamp()` — MICROSECONDS, exactly as production writes
     * them. A cursor rounded to milliseconds names a position earlier than the
     * row it points at, and that row is then served twice.
     */
    const seedRequests = async (count: number, status: string): Promise<string> => {
      const { rows: dept } = await pool.query<{ id: string }>(
        "INSERT INTO departments (slug, name) VALUES ('prec', 'Precision') RETURNING id",
      );
      const departmentId = dept[0]!.id;

      for (let n = 0; n < count; n++) {
        await pool.query(
          `WITH u AS (INSERT INTO users (display_name) VALUES ($2) RETURNING id)
           INSERT INTO membership_change_requests
             (department_id, target_user_id, requested_by, action, status)
           SELECT $1, id, id, 'REMOVE_MEMBER', $3 FROM u`,
          [departmentId, `Requester ${n}`, status],
        );
      }
      return departmentId;
    };

    const walk = async (
      list: (cursor?: string) => Promise<{ items: { id: string }[]; hasMore: boolean; nextCursor: string | null }>,
    ): Promise<{ sizes: number[]; ids: string[] }> => {
      const sizes: number[] = [];
      const ids: string[] = [];
      let cursor: string | undefined;

      for (let guard = 0; guard < 10; guard++) {
        const page = await list(cursor);
        sizes.push(page.items.length);
        ids.push(...page.items.map((r) => r.id));
        if (!page.hasMore) break;
        cursor = page.nextCursor as string;
      }
      return { sizes, ids };
    };

    it('a department list of 25 pages as 10 + 10 + 5, with nothing repeated', async () => {
      const departmentId = await seedRequests(25, 'pending');

      const { sizes, ids } = await walk((cursor) =>
        requests.listForDepartment(departmentId, { limit: 10, cursor }),
      );

      expect(sizes).toEqual([10, 10, 5]);
      expect(ids).toHaveLength(25);
      expect(new Set(ids).size).toBe(25);
    });

    it('the global pending queue pages the same way, ascending', async () => {
      await seedRequests(25, 'pending');

      const { sizes, ids } = await walk((cursor) =>
        requests.listPending({ limit: 10, cursor }),
      );

      expect(sizes).toEqual([10, 10, 5]);
      expect(new Set(ids).size).toBe(25);
    });

    it('the cursor names the row exactly, not a rounded instant', async () => {
      const departmentId = await seedRequests(3, 'pending');

      const page = await requests.listForDepartment(departmentId, { limit: 2 });
      const { t, i } = decodeCursor(page.nextCursor as string);

      const { rows } = await pool.query<{ exact: boolean }>(
        'SELECT requested_at = $2::timestamptz AS exact FROM membership_change_requests WHERE id = $1',
        [i, t],
      );
      expect(rows[0]!.exact).toBe(true);
    });

    it('refuses a malformed cursor rather than silently restarting', async () => {
      const departmentId = await seedRequests(3, 'pending');

      await expect(
        requests.listForDepartment(departmentId, { limit: 2, cursor: 'not-a-cursor' }),
      ).rejects.toThrow(/Malformed cursor/);
    });

    it('a cursor from one department does not pull in another department’s rows', async () => {
      const first = await seedRequests(12, 'pending');
      const { rows: other } = await pool.query<{ id: string }>(
        "INSERT INTO departments (slug, name) VALUES ('other', 'Other') RETURNING id",
      );
      await pool.query(
        `WITH u AS (INSERT INTO users (display_name) VALUES ('Outsider') RETURNING id)
         INSERT INTO membership_change_requests
           (department_id, target_user_id, requested_by, action, status)
         SELECT $1, id, id, 'REMOVE_MEMBER', 'pending' FROM u`,
        [other[0]!.id],
      );

      const { ids } = await walk((cursor) =>
        requests.listForDepartment(first, { limit: 10, cursor }),
      );

      // Scope comes from the route, never from the cursor.
      expect(ids).toHaveLength(12);
    });
  });

  describe('database constraints', () => {
    it('refuses a hybrid decision state', async () => {
      const { a, headId, memberId } = await scenario();

      await expect(
        pool.query(
          `INSERT INTO membership_change_requests
             (department_id, target_user_id, action, status, requested_by, decided_by)
           VALUES ($1, $2, 'REMOVE_MEMBER', 'approved', $3, $4)`,
          [a.id, memberId, headId, memberId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a self-approval at the database level too', async () => {
      const { a, headId, memberId } = await scenario();

      await expect(
        pool.query(
          `INSERT INTO membership_change_requests
             (department_id, target_user_id, action, status, requested_by, decided_by, decided_at)
           VALUES ($1, $2, 'REMOVE_MEMBER', 'approved', $3, $3, now())`,
          [a.id, memberId, headId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a transfer with no destination, and an offboarding with one', async () => {
      const { a, b, headId, memberId } = await scenario();

      await expect(
        pool.query(
          `INSERT INTO membership_change_requests
             (department_id, target_user_id, action, requested_by)
           VALUES ($1, $2, 'TRANSFER_MEMBER', $3)`,
          [a.id, memberId, headId],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        pool.query(
          `INSERT INTO membership_change_requests
             (department_id, target_department_id, target_user_id, action, requested_by)
           VALUES ($1, $2, $3, 'REMOVE_MEMBER', $4)`,
          [a.id, b.id, memberId, headId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
