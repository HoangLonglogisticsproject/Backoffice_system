import { Pool } from 'pg';
import type { AppConfig } from '@config/app.config';
import { ConflictError, NotFoundError, ValidationError } from '@common/errors/domain.error';
import {
  TEST_URL,
  applyAllMigrations,
  assertLooksLikeATestDatabase,
  describeIntegration,
  fakeHasher,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { IdentityRepository } from '@core/identity/persistence/identity.repository';
import { SessionRepository } from '@core/identity/persistence/session.repository';
import { SessionService } from '@core/identity/application/session.service';
import { AuthenticationService } from '@core/identity/application/authentication.service';
import { LoginThrottleService } from '@core/identity/application/login-throttle.service';
import { AuthorizationRepository } from '@core/authorization/persistence/authorization.repository';
import { AccountLifecycleService } from '@core/users/application/account-lifecycle.service';
import { DepartmentRepository } from '@core/organization/persistence/department.repository';
import { MembershipRepository } from '@core/organization/persistence/membership.repository';
import { DepartmentService } from '@core/organization/application/department.service';
import { MembershipService } from '@core/organization/application/membership.service';
import { AccountProvisioningService } from '@core/users/application/account-provisioning.service';
import { UserRepository } from '@core/users/persistence/user.repository';
import { DriverAccountRepository } from '../../src/capabilities/driver-account/persistence/driver-account.repository';
import { DriverAccountRequestRepository } from '../../src/capabilities/driver-account/persistence/driver-account-request.repository';
import { DriverAccountRepository } from '../../src/capabilities/driver-account/persistence/driver-account.repository';
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

const SCHEMA = 'driver_account_itest';

describeIntegration('Driver accounts against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let drivers: DriverAccountService;
  let provisioning: AccountProvisioningService;
  let departments: DepartmentService;
  let lifecycle: AccountLifecycleService;
  let sessions: SessionService;
  let authentication: AuthenticationService;

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

    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);

    const database = poolAsDatabase(pool);

    const config = {
      get allowedEmailDomains() {
        return [] as string[];
      },
    } as unknown as AppConfig;

    const users = new UserRepository(database);
    const identities = new IdentityRepository(database);
    const sessionRepository = new SessionRepository(database);
    sessions = new SessionService(sessionRepository);
    authentication = new AuthenticationService(
      database,
      identities,
      sessions,
      new LoginThrottleService(),
      fakeHasher,
    );
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
    lifecycle = new AccountLifecycleService(
      database,
      users,
      new AuthorizationRepository(database),
      sessionRepository,
      membershipRepository,
    );
    drivers = new DriverAccountService(
      database,
      new DriverAccountRequestRepository(database),
      new DriverAccountRepository(database),
      provisioning,
      identities,
      config,
      new DriverAccountRepository(database),
      lifecycle,
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

  const assignmentsOf = (userId: string) =>
    sql(`SELECT id FROM trip_driver_assignments WHERE driver_user_id = $1`, [userId]);

  const accountOf = (userId: string) =>
    sql<{ account_type: string; status: string }>(
      `SELECT account_type, status FROM users WHERE id = $1`,
      [userId],
    );

  const newDriver = (email: string, displayName = 'Tài Xế A') =>
    drivers.createDirectly({ displayName, email, initialPassword: 'Tam-2026!' });

  /**
   * A trip with this driver on it, written straight to the tables. The
   * assignment flow's own rules are proven elsewhere; here the row only has to
   * EXIST so the account lifecycle can be shown to leave it alone.
   */
  const assigned = async (driverId: string) => {
    const [trip] = await sql<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ('2026-09-10', $1) RETURNING id`,
      [boss],
    );
    const [assignment] = await sql<{ id: string }>(
      `INSERT INTO trip_driver_assignments (trip_id, driver_user_id, assigned_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [trip!.id, driverId, boss],
    );
    return assignment!.id;
  };

  const assignmentRow = async (id: string) =>
    (
      await sql<{ state: string; ended_at: Date | null; driver_user_id: string }>(
        `SELECT state, ended_at, driver_user_id FROM trip_driver_assignments WHERE id = $1`,
        [id],
      )
    )[0];

  // ================================================== driver management ==

  /**
   * ★ ACCOUNT ADMINISTRATION, AND NOTHING ELSE. These cases pin the two
   * decisions the feature rests on: a driver can be disabled and re-enabled,
   * and neither direction touches a trip assignment. The assignment is a
   * dispatch fact; the account is an identity fact; the lifecycle here reads
   * one table and writes one column.
   */
  describe('★ driver management', () => {
    it('lists every driver account — disabled ones included — and never an employee', async () => {
      const a = await newDriver('taixea@hoanglonglti.com', 'Tài Xế A');
      const b = await newDriver('taixeb@hoanglonglti.com', 'Tài Xế B');
      await drivers.setStatus({ userId: b.userId, status: 'disabled', actingUserId: boss });

      const list = await drivers.list();

      expect(list.map((d) => [d.id, d.status])).toEqual([
        [a.userId, 'active'],
        [b.userId, 'disabled'],
      ]);
      // The boss and the head are employees; neither is here.
      expect(list.some((d) => d.id === boss || d.id === head)).toBe(false);
      // The projection: six fields, the sign-in name derived, no secret anywhere.
      expect(list[0]).toEqual({
        id: a.userId,
        displayName: 'Tài Xế A',
        username: 'taixea',
        accountType: 'driver',
        status: 'active',
        createdAt: expect.any(Date),
      });
    });

    it('reads one driver by id, and answers "not found" for an employee or an unknown id', async () => {
      const a = await newDriver('taixea@hoanglonglti.com');

      expect((await drivers.get(a.userId)).username).toBe('taixea');
      await expect(drivers.get(boss)).rejects.toThrow(NotFoundError);
      await expect(drivers.get('00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundError);
    });

    it('★ disable: the driver cannot sign in and their sessions are gone; enable: they can again', async () => {
      const a = await newDriver('taixea@hoanglonglti.com');
      const before = await sessions.issue(a.userId);

      await drivers.setStatus({ userId: a.userId, status: 'disabled', actingUserId: boss });

      expect((await accountOf(a.userId))[0]?.status).toBe('disabled');
      expect(await sessions.resolve(before.token)).toBeNull();
      await expect(authentication.login('taixea@hoanglonglti.com', 'Tam-2026!')).rejects.toThrow();

      await drivers.setStatus({ userId: a.userId, status: 'active', actingUserId: boss });

      expect((await accountOf(a.userId))[0]?.status).toBe('active');
      // The old session stays revoked — re-enabling issues nothing.
      expect(await sessions.resolve(before.token)).toBeNull();
      const login = await authentication.login('taixea@hoanglonglti.com', 'Tam-2026!');
      expect(login.user.id).toBe(a.userId);
    });

    it('★ disable and re-enable leave an ACTIVE assignment exactly as it was', async () => {
      const a = await newDriver('taixea@hoanglonglti.com');
      const assignment = await assigned(a.userId);

      await drivers.setStatus({ userId: a.userId, status: 'disabled', actingUserId: boss });
      expect(await assignmentRow(assignment)).toEqual({ state: 'active', ended_at: null, driver_user_id: a.userId });

      await drivers.setStatus({ userId: a.userId, status: 'active', actingUserId: boss });
      expect(await assignmentRow(assignment)).toEqual({ state: 'active', ended_at: null, driver_user_id: a.userId });
      // The same single row: nothing was ended, replaced or created.
      expect(await assignmentsOf(a.userId)).toHaveLength(1);
    });

    it('re-enabling a driver who was never assigned creates no assignment', async () => {
      const a = await newDriver('taixea@hoanglonglti.com');
      await drivers.setStatus({ userId: a.userId, status: 'disabled', actingUserId: boss });

      await drivers.setStatus({ userId: a.userId, status: 'active', actingUserId: boss });

      expect(await assignmentsOf(a.userId)).toHaveLength(0);
      expect(await membershipsOf(a.userId)).toHaveLength(0);
    });

    it('★ refuses an employee through the driver door, in both directions', async () => {
      await expect(
        drivers.setStatus({ userId: head, status: 'disabled', actingUserId: boss }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        drivers.setStatus({ userId: head, status: 'active', actingUserId: boss }),
      ).rejects.toThrow(NotFoundError);
      expect((await accountOf(head))[0]?.status).toBe('active');
    });

    it('★ the core lifecycle refuses to re-enable an employee even when asked directly', async () => {
      await lifecycle.disable({ userId: head, actingUserId: boss });

      await expect(lifecycle.enable({ userId: head, actingUserId: boss })).rejects.toThrow(ConflictError);
      expect((await accountOf(head))[0]?.status).toBe('disabled');
    });

    it('refuses a no-op transition with a sentence', async () => {
      const a = await newDriver('taixea@hoanglonglti.com');

      await expect(
        drivers.setStatus({ userId: a.userId, status: 'active', actingUserId: boss }),
      ).rejects.toThrow(ConflictError);
      await drivers.setStatus({ userId: a.userId, status: 'disabled', actingUserId: boss });
      await expect(
        drivers.setStatus({ userId: a.userId, status: 'disabled', actingUserId: boss }),
      ).rejects.toThrow(ConflictError);
    });

    it('★ two simultaneous enables: exactly one wins', async () => {
      const a = await newDriver('taixea@hoanglonglti.com');
      await drivers.setStatus({ userId: a.userId, status: 'disabled', actingUserId: boss });

      const outcomes = await Promise.allSettled([
        drivers.setStatus({ userId: a.userId, status: 'active', actingUserId: boss }),
        drivers.setStatus({ userId: a.userId, status: 'active', actingUserId: boss }),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
      expect((await accountOf(a.userId))[0]?.status).toBe('active');
    });

    it('a second driver on the same address is refused the way any duplicate identity is', async () => {
      await newDriver('taixea@hoanglonglti.com');

      await expect(newDriver('taixea@hoanglonglti.com', 'Người Khác')).rejects.toThrow(ConflictError);
      expect(await drivers.list()).toHaveLength(1);
    });
  });

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

      // ★ AND NO TRIP EITHER. Creating an account is the IDENTITY layer;
      // putting somebody on a trip is a separate act by a different person at a
      // different time. An account that arrived already crewed would be this
      // module quietly deciding dispatch.
      expect(await assignmentsOf(created.userId)).toHaveLength(0);
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

  // ==================================== the invariant the pairing rests on ==

  /**
   * ★ TWO COMBINATIONS THE BUSINESS DOES NOT HAVE.
   *
   * Making `departmentId` optional is what let a driver be created at all, and
   * the same change opened two shapes nothing else would catch: an employee
   * with no unit, and a driver with one. No constraint refuses either — `users`
   * has never required a membership — so an employee provisioned without a
   * department would just hold no permissions and read as an authorization bug,
   * and a driver with one would appear in an org chart as staff of a department
   * that never hired them.
   */
  describe('★ account type and department are one decision', () => {
    it('refuses an employee with no department', async () => {
      await expect(
        provisioning.provision({
          displayName: 'Nhân Viên',
          email: 'khong.phong.ban@hoanglonglti.com',
          // accountType omitted — the default is `employee`, and that is the
          // case every existing caller takes.
          initialPassword: 'Tam-2026!',
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      const identities = await sql(`SELECT id FROM identities WHERE subject = $1`, [
        'khong.phong.ban@hoanglonglti.com',
      ]);
      expect(identities).toHaveLength(0);
    });

    it('refuses a driver WITH a department', async () => {
      await expect(
        provisioning.provision({
          displayName: 'Tài Xế',
          email: 'taixe.co.phong@hoanglonglti.com',
          accountType: 'driver',
          departmentId: department,
          initialPassword: 'Tam-2026!',
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      const identities = await sql(`SELECT id FROM identities WHERE subject = $1`, [
        'taixe.co.phong@hoanglonglti.com',
      ]);
      expect(identities).toHaveLength(0);
    });

    it('accepts an employee WITH a department, and enrolls them', async () => {
      const account = await provisioning.provision({
        displayName: 'Nhân Viên',
        email: 'nhanvien.hople@hoanglonglti.com',
        departmentId: department,
        initialPassword: 'Tam-2026!',
      });

      const [row] = await accountOf(account.user.id);
      expect(row?.account_type).toBe('employee');
      expect(await membershipsOf(account.user.id)).toHaveLength(1);
    });

    it('accepts a driver with NO department, and enrolls them nowhere', async () => {
      const account = await provisioning.provision({
        displayName: 'Tài Xế',
        email: 'taixe.hople@hoanglonglti.com',
        accountType: 'driver',
        initialPassword: 'Tam-2026!',
      });

      const [row] = await accountOf(account.user.id);
      expect(row?.account_type).toBe('driver');
      expect(await membershipsOf(account.user.id)).toHaveLength(0);
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

  // ========================================================== the roster ==

  /**
   * ★ THE LIST THAT MAKES A DRIVER ACCOUNT VISIBLE AT ALL.
   *
   * Before it, a driver appeared on no screen: `GET /memberships` reads
   * MEMBERSHIPS and a driver has none, and the assignment dropdown answers "who
   * may I put on this trip", which is live accounts only. Somebody who had just
   * created an account had no way to confirm it existed.
   *
   * These cases are here rather than in a unit test because every claim is about
   * SQL — which rows the statement selects, what order it returns them in, and
   * whether the keyset walks them all exactly once.
   */
  describe('★ listing driver accounts', () => {
    const makeDriver = (name: string, email: string) =>
      drivers.createDirectly({ displayName: name, email, initialPassword: 'Tam-2026!' });

    const page = (over: Partial<{ limit: number; cursor: string }> = {}) =>
      drivers.listAccounts({}, { limit: 50, cursor: undefined, ...over });

    it('★ shows a driver created directly — the account with no request behind it', async () => {
      // The path that was hardest to see: no request row was ever written, so
      // the pending queue never mentioned it either.
      const created = await makeDriver('Tài Xế A', 'taixea@hoanglonglti.com');

      const listed = await page();

      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]?.user).toEqual({ id: created.userId, displayName: 'Tài Xế A' });
      expect(listed.items[0]?.accountStatus).toBe('active');
    });

    it('★ shows an APPROVED driver too, once the request is gone from the queue', async () => {
      const proposed = await propose();
      const { driver } = await drivers.approve({ requestId: proposed.id, decidedBy: boss });

      expect(await drivers.listPending()).toHaveLength(0);
      expect((await page()).items.map((row) => row.user.id)).toEqual([driver.userId]);
    });

    it('★ lists NO employee — not the boss, not the head, not anybody with a unit', async () => {
      await makeDriver('Tài Xế A', 'taixea@hoanglonglti.com');

      const listed = await page();
      const ids = listed.items.map((row) => row.user.id);

      expect(ids).not.toContain(boss);
      expect(ids).not.toContain(head);
    });

    it('carries the username the creation response handed back', async () => {
      // The only column that separates two drivers with the same display name,
      // and the one somebody checks against what they were just shown.
      const created = await makeDriver('Tài Xế A', 'taixea@hoanglonglti.com');

      expect((await page()).items[0]?.username).toBe(created.username);
    });

    it('newest first, so the account somebody just made is at the top', async () => {
      await makeDriver('Tài Xế A', 'a@hoanglonglti.com');
      await makeDriver('Tài Xế B', 'b@hoanglonglti.com');
      const last = await makeDriver('Tài Xế C', 'c@hoanglonglti.com');

      expect((await page()).items[0]?.user.id).toBe(last.userId);
    });

    it('★ filters on the ACCOUNT status, in SQL', async () => {
      const stays = await makeDriver('Tài Xế A', 'a@hoanglonglti.com');
      const goes = await makeDriver('Tài Xế B', 'b@hoanglonglti.com');
      await sql(`UPDATE users SET status = 'disabled' WHERE id = $1`, [goes.userId]);

      const active = await drivers.listAccounts(
        { accountStatus: 'active' },
        { limit: 50, cursor: undefined },
      );
      const disabled = await drivers.listAccounts(
        { accountStatus: 'disabled' },
        { limit: 50, cursor: undefined },
      );

      expect(active.items.map((row) => row.user.id)).toEqual([stays.userId]);
      expect(disabled.items.map((row) => row.user.id)).toEqual([goes.userId]);
      // And no filter means both — there is no server-side default hiding one.
      expect((await page()).items).toHaveLength(2);
    });

    it('★ walks every account exactly once, with no overlap and nothing missing', async () => {
      // Five accounts, provisioned back to back: several share a `created_at` to
      // the millisecond, which is exactly where a keyset without its tiebreaker
      // loses rows and returns others twice.
      for (let index = 0; index < 5; index += 1) {
        await makeDriver(`Tài Xế ${index}`, `driver${index}@hoanglonglti.com`);
      }

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const walked = await page({ limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...walked.items.map((row) => row.user.id));
        cursor = walked.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('answers an empty deployment with an empty page, not a cursor to nowhere', async () => {
      const listed = await page();

      expect(listed.items).toEqual([]);
      expect(listed.hasMore).toBe(false);
      expect(listed.nextCursor).toBeNull();
    });
  });
});
