import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Database, DatabaseQuery } from '@common/types/database.port';
import type { AppConfig } from '@config/app.config';
import { ConflictError, ValidationError } from '@common/errors/domain.error';
import type { PasswordHasher } from '@core/identity/domain/password-hasher.port';
import { IdentityRepository } from '@core/identity/persistence/identity.repository';
import { DepartmentRepository } from '@core/organization/persistence/department.repository';
import { MembershipRepository } from '@core/organization/persistence/membership.repository';
import { DepartmentService } from '@core/organization/application/department.service';
import { MembershipService } from '@core/organization/application/membership.service';
import { AccountProvisioningService } from '@core/users/application/account-provisioning.service';
import { UserRepository } from '@core/users/persistence/user.repository';
import { DriverAccountRequestRepository } from '../../src/capabilities/driver-account/persistence/driver-account-request.repository';
import { DriverAccountService } from '../../src/capabilities/driver-account/application/driver-account.service';

/**
 * Driver accounts against a real PostgreSQL.
 *
 * ★ WHAT ONLY A REAL SERVER CAN ANSWER. Four of the rules in this feature are
 * database constraints, not service code: no self-approval, a rejection needs a
 * reason, approved implies an account exists, and one pending request per
 * address. A mocked client will agree with whatever the service believes; only
 * PostgreSQL can say whether it would have refused.
 *
 * ★ AND THE ONE THAT MATTERS MOST IS AN ABSENCE. A driver must have NO
 * department membership — not an empty one, not a placeholder unit. That is a
 * row that should not exist, and the only honest way to assert it is to look.
 */

const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;
const SCHEMA = 'driver_account_itest';

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

describeIntegration('Driver accounts against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let drivers: DriverAccountService;
  let provisioning: AccountProvisioningService;
  let departments: DepartmentService;

  /** The two people who act in these cases. */
  let boss: string;
  let head: string;
  let department: string;

  const sql = async <T = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => (await pool.query(text, params as unknown[])).rows as T[];

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({ connectionString: TEST_URL, max: 8, options: `-c search_path=${SCHEMA}` });

    // READ from disk, never a hand-kept list — the same reasoning the invitation
    // spec documents: a list goes stale the day somebody adds a migration.
    const migrations = join(__dirname, '..', '..', 'migrations');
    const files = (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await pool.query(await readFile(join(migrations, file), 'utf8'));
    }

    const database: Database = {
      query: async <T>(text: string, params?: readonly unknown[]): Promise<T[]> =>
        (await pool.query(text, params as unknown[])).rows as T[],
      transaction: async <T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({
            query: async <R>(text: string, params?: readonly unknown[]): Promise<R[]> =>
              (await client.query(text, params as unknown[])).rows as R[],
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

    const config = {
      get allowedEmailDomains() {
        return [] as string[];
      },
    } as unknown as AppConfig;

    const users = new UserRepository(database);
    const identities = new IdentityRepository(database);
    const departmentRepository = new DepartmentRepository(database);
    const membershipRepository = new MembershipRepository(database);
    const memberships = new MembershipService(database, departmentRepository, membershipRepository);

    departments = new DepartmentService(database, departmentRepository, membershipRepository);
    provisioning = new AccountProvisioningService(
      database,
      fakeHasher,
      users,
      identities,
      memberships,
      config,
    );
    drivers = new DriverAccountService(
      database,
      new DriverAccountRequestRepository(database),
      provisioning,
      identities,
      config,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // TRUNCATE rather than DELETE: it fires no row triggers and resets nothing
    // these cases depend on.
    await sql(
      `TRUNCATE driver_account_requests, department_memberships, identities, sessions,
                role_assignments, departments, users RESTART IDENTITY CASCADE`,
    );

    const unit = await departments.create({ slug: 'van-hanh', name: 'Vận hành' });
    department = unit.id;

    const bossAccount = await provisioning.provision({
      displayName: 'Giám Đốc',
      email: 'boss@hoanglonglti.com',
      departmentId: department,
      initialPassword: 'Boss-Tam-2026!',
    });
    boss = bossAccount.user.id;

    const headAccount = await provisioning.provision({
      displayName: 'Trưởng Phòng Vận Hành',
      email: 'ops.head@hoanglonglti.com',
      departmentId: department,
      initialPassword: 'Head-Tam-2026!',
    });
    head = headAccount.user.id;
  });

  const propose = (email = 'taixea@hoanglonglti.com') =>
    drivers.request({ displayName: 'Tài Xế A', email, requestedBy: head });

  const membershipsOf = (userId: string) =>
    sql(`SELECT id FROM department_memberships WHERE user_id = $1`, [userId]);

  const accountOf = (userId: string) =>
    sql<{ account_type: string; status: string }>(
      `SELECT account_type, status FROM users WHERE id = $1`,
      [userId],
    );

  // ============================================ 1, 2 · direct creation ==

  describe('a global administrator creating one directly', () => {
    it('★ produces an ACTIVE driver with NO department membership', async () => {
      const created = await drivers.createDirectly({
        displayName: 'Tài Xế A',
        email: 'taixea@hoanglonglti.com',
        initialPassword: 'Tam-2026!',
      });

      const [account] = await accountOf(created.userId);
      expect(account?.account_type).toBe('driver');
      expect(account?.status).toBe('active');

      // ★ THE ABSENCE THAT IS THE WHOLE POINT. Not an empty department, not a
      // unit called "Tài xế" — no row at all.
      expect(await membershipsOf(created.userId)).toHaveLength(0);
    });

    it('★ reuses the ordinary first-login credential, and never returns the password', async () => {
      const created = await drivers.createDirectly({
        displayName: 'Tài Xế B',
        email: 'taixeb@hoanglonglti.com',
        initialPassword: 'Tam-2026!',
      });

      const [identity] = await sql<{ must_change_secret: boolean; secret_hash: string }>(
        `SELECT must_change_secret, secret_hash FROM identities WHERE user_id = $1`,
        [created.userId],
      );

      // Same lifecycle as an employee: log in, change it, do nothing else first.
      expect(identity?.must_change_secret).toBe(true);
      // Stored as a hash, and the plaintext is not echoed back to the caller.
      expect(identity?.secret_hash).not.toBe('Tam-2026!');
      expect(created.temporaryPassword).toBeUndefined();
    });

    it('leaves employee provisioning exactly as it was', async () => {
      const employee = await provisioning.provision({
        displayName: 'Nhân Viên',
        email: 'nhanvien@hoanglonglti.com',
        departmentId: department,
        initialPassword: 'Tam-2026!',
      });

      const [account] = await accountOf(employee.user.id);
      expect(account?.account_type).toBe('employee');
      // An employee still lands in their unit, in the same transaction.
      expect(await membershipsOf(employee.user.id)).toHaveLength(1);
    });
  });

  // ================================================ 3, 4 · the request ==

  describe('a department head proposing one', () => {
    it('★ creates a PENDING request and no account whatsoever', async () => {
      const proposed = await propose();

      expect(proposed.status).toBe('pending');
      expect(proposed.createdUserId).toBeNull();

      // Nobody was provisioned: the address still has no identity.
      const identities = await sql(`SELECT id FROM identities WHERE subject = $1`, [
        'taixea@hoanglonglti.com',
      ]);
      expect(identities).toHaveLength(0);
    });

    it('★ stores no password anywhere on the request', async () => {
      await propose();

      const [row] = await sql<Record<string, unknown>>(
        `SELECT * FROM driver_account_requests WHERE email = $1`,
        ['taixea@hoanglonglti.com'],
      );

      // ⚠ Asserted on the WHOLE ROW rather than on named columns, so adding a
      // password column later fails this test instead of passing quietly.
      const columns = Object.keys(row ?? {});
      expect(columns.filter((c) => /password|secret|credential/i.test(c))).toEqual([]);
    });

    it('refuses a second proposal for an address already awaiting a decision', async () => {
      await propose();

      await expect(propose()).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // ==================================== 8, 9, 10, 11, 12, 13 · deciding ==

  describe('the decision', () => {
    it('★ APPROVE activates the driver, with no membership and a generated password', async () => {
      const proposed = await propose();

      const { request, driver } = await drivers.approve({
        requestId: proposed.id,
        decidedBy: boss,
      });

      expect(request.status).toBe('approved');
      expect(request.createdUserId).toBe(driver.userId);

      const [account] = await accountOf(driver.userId);
      expect(account?.account_type).toBe('driver');
      expect(account?.status).toBe('active');
      expect(await membershipsOf(driver.userId)).toHaveLength(0);

      // ★ GENERATED AT APPROVAL, handed over exactly once. It was never stored
      // on the request, so this is the only moment it exists in plaintext.
      expect(driver.temporaryPassword).toEqual(expect.any(String));
      expect(driver.temporaryPassword?.length).toBeGreaterThan(0);

      const [identity] = await sql<{ must_change_secret: boolean }>(
        `SELECT must_change_secret FROM identities WHERE user_id = $1`,
        [driver.userId],
      );
      expect(identity?.must_change_secret).toBe(true);
    });

    it('★ REJECT creates no account and keeps the reason', async () => {
      const proposed = await propose();

      const rejected = await drivers.reject({
        requestId: proposed.id,
        decidedBy: boss,
        reason: 'Chưa đủ hồ sơ.',
      });

      expect(rejected.status).toBe('rejected');
      expect(rejected.createdUserId).toBeNull();
      // The one thing that tells the head what to fix.
      expect(rejected.decisionReason).toBe('Chưa đủ hồ sơ.');

      const identities = await sql(`SELECT id FROM identities WHERE subject = $1`, [
        'taixea@hoanglonglti.com',
      ]);
      expect(identities).toHaveLength(0);
    });

    it('★ REJECT without a reason is refused before anything is written', async () => {
      const proposed = await propose();

      await expect(
        drivers.reject({ requestId: proposed.id, decidedBy: boss, reason: '   ' }),
      ).rejects.toBeInstanceOf(ValidationError);

      // Still awaiting a decision — the refusal changed nothing.
      const [row] = await sql<{ status: string }>(
        `SELECT status FROM driver_account_requests WHERE id = $1`,
        [proposed.id],
      );
      expect(row?.status).toBe('pending');
    });

    it('★ nobody decides their own request — approve', async () => {
      const proposed = await propose();

      await expect(
        drivers.approve({ requestId: proposed.id, decidedBy: head }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('★ nobody decides their own request — reject', async () => {
      const proposed = await propose();

      await expect(
        drivers.reject({ requestId: proposed.id, decidedBy: head, reason: 'Tự từ chối.' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('★ two simultaneous decisions on one request: exactly one wins', async () => {
      const proposed = await propose();

      const results = await Promise.allSettled([
        drivers.approve({ requestId: proposed.id, decidedBy: boss }),
        drivers.reject({ requestId: proposed.id, decidedBy: boss, reason: 'Không đạt.' }),
      ]);

      // ★ ONE, NEVER TWO AND NEVER ZERO. `lockPending` serialises the pair, so
      // the loser reads a row that is no longer pending and is refused.
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const [row] = await sql<{ status: string; decided_by: string }>(
        `SELECT status, decided_by FROM driver_account_requests WHERE id = $1`,
        [proposed.id],
      );
      expect(['approved', 'rejected']).toContain(row?.status);
      expect(row?.decided_by).toBe(boss);
    });

    it('refuses a second decision on an already-decided request', async () => {
      const proposed = await propose();
      await drivers.approve({ requestId: proposed.id, decidedBy: boss });

      await expect(
        drivers.reject({ requestId: proposed.id, decidedBy: boss, reason: 'Đổi ý.' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('lets a rejected address be proposed again', async () => {
      const first = await propose();
      await drivers.reject({ requestId: first.id, decidedBy: boss, reason: 'Thiếu giấy tờ.' });

      const second = await propose();
      expect(second.status).toBe('pending');
      expect(second.id).not.toBe(first.id);
    });
  });

  // ========================================================== history ==

  describe('the request keeps its history', () => {
    it('★ a decided request is still there, with who decided it and when', async () => {
      const proposed = await propose();
      await drivers.reject({ requestId: proposed.id, decidedBy: boss, reason: 'Chưa đạt.' });

      const [mine] = await drivers.listMine(head);

      expect(mine?.id).toBe(proposed.id);
      expect(mine?.status).toBe('rejected');
      expect(mine?.requester.id).toBe(head);
      expect(mine?.decider?.id).toBe(boss);
      expect(mine?.decidedAt).toBeInstanceOf(Date);
      expect(mine?.decisionReason).toBe('Chưa đạt.');
    });

    it('the pending queue holds only what is still waiting', async () => {
      const decided = await propose('one@hoanglonglti.com');
      await drivers.reject({ requestId: decided.id, decidedBy: boss, reason: 'Không.' });
      const waiting = await propose('two@hoanglonglti.com');

      const pending = await drivers.listPending();

      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe(waiting.id);
    });
  });
});
