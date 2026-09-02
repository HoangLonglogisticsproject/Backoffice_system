import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { PasswordHasher } from '@core/identity/domain/password-hasher.port';
import type { Database, DatabaseQuery } from '@common/types/database.port';
import {
  TEST_URL,
  assertLooksLikeATestDatabase,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import type { AppConfig } from '@config/app.config';
import { IdentityRepository } from '@core/identity/persistence/identity.repository';
import { SessionRepository } from '@core/identity/persistence/session.repository';
import { SessionService } from '@core/identity/application/session.service';
import { AuthorizationRepository } from '@core/authorization/persistence/authorization.repository';
import { AuthorizationService } from '@core/authorization/application/authorization.service';
import { DepartmentRepository } from '@core/organization/persistence/department.repository';
import { MembershipRepository } from '@core/organization/persistence/membership.repository';
import { DepartmentService } from '@core/organization/application/department.service';
import { MembershipService } from '@core/organization/application/membership.service';
import { UserRepository } from '@core/users/persistence/user.repository';
import { AccountLifecycleService } from '@core/users/application/account-lifecycle.service';
import { AccountProvisioningService } from '@core/users/application/account-provisioning.service';

/**
 * Account lifecycle against a REAL PostgreSQL.
 *
 * Every claim here is about ATOMICITY or a DATABASE INVARIANT, and none of them
 * can be shown with a fake: that provisioning leaves no half-account, that
 * disabling lands five writes together, and above all that neither of the two
 * forbidden states is reachable —
 *
 *   active user with no department
 *   disabled user still holding one
 */

/** Its own schema: the migration-runner suite drops `public` between cases. */
const SCHEMA = 'lifecycle_itest';


/**
 * Fast, deterministic, and — importantly — it does NOT embed the plaintext.
 *
 * A double like `hashed:${plain}` would make "the secret is not stored in the
 * clear" pass for the wrong reason and fail for the right one. Real hashing is
 * proven in the scrypt adapter's own spec; this only has to behave like a
 * digest.
 */
const digest = (plain: string): string =>
  createHash('sha256').update(plain, 'utf8').digest('hex');

const fakeHasher: PasswordHasher = {
  hash: async (plain: string) => digest(plain),
  verify: async (plain: string, hash: string) => hash === digest(plain),
  fakeVerify: async () => undefined,
};

describeIntegration('Account lifecycle against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let database: Database;
  let provisioning: AccountProvisioningService;
  let lifecycle: AccountLifecycleService;
  let authorization: AuthorizationService;
  let departments: DepartmentService;
  let memberships: MembershipService;
  let sessions: SessionService;
  let allowedDomains: string[];

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    pool = await openTestSchema(TEST_URL as string, SCHEMA);

    const migrations = join(__dirname, '..', '..', 'migrations');
    for (const file of [
      '0001_identity.sql',
      '0002_users_updated_at.sql',
      '0003_organization.sql',
      '0004_authorization.sql',
      '0005_identity_credential_state.sql',
      '0008_role_assignment_membership_fk_index.sql',
      // 0018 adds `users.account_type`, which provisioning now writes on every
      // insert — so every spec that creates a user needs it.
      '0018_driver_account.sql',
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

    allowedDomains = [];
    const config = {
      get allowedEmailDomains() {
        return allowedDomains;
      },
    } as unknown as AppConfig;

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
    lifecycle = new AccountLifecycleService(
      database,
      users,
      assignments,
      sessionRepository,
      membershipRepository,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    allowedDomains = [];
    await pool.query(
      'TRUNCATE role_assignments, department_memberships, departments, sessions, identities, users CASCADE',
    );
  });

  /** The two states the whole model exists to prevent, asked of the database. */
  const forbiddenStates = async (): Promise<{ activeNoDept: number; disabledWithDept: number }> => {
    const active = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM users u
        WHERE u.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM role_assignments ra
                           WHERE ra.user_id = u.id AND ra.role_key = 'SUPERADMIN'
                             AND ra.status = 'active')
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

  // ------------------------------------------------------------ provisioning --

  describe('POST /users provisioning', () => {
    it('creates user, credential and membership atomically', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });

      const account = await provisioning.provision({
        displayName: 'A Person',
        email: 'a.person@example.com',
        departmentId: dept.id,
        initialPassword: 'a valid passphrase',
      });

      expect(account.username).toBe('a.person');

      const membership = await memberships.findActive(account.user.id);
      expect(membership?.departmentId).toBe(dept.id);

      const { rows } = await pool.query<{ must_change_secret: boolean; subject: string }>(
        'SELECT must_change_secret, subject FROM identities WHERE user_id = $1',
        [account.user.id],
      );
      expect(rows[0]!.must_change_secret).toBe(true);
      expect(rows[0]!.subject).toBe('a.person@example.com');

      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });

    it('normalises the email, so casing cannot create a second account', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      await provisioning.provision({
        displayName: 'A',
        email: '  A.Person@Example.COM ',
        departmentId: dept.id,
        initialPassword: 'a valid passphrase',
      });

      await expect(
        provisioning.provision({
          displayName: 'B',
          email: 'a.person@example.com',
          departmentId: dept.id,
          initialPassword: 'a valid passphrase',
        }),
      ).rejects.toThrow(/already registered/);
    });

    it('leaves NOTHING behind when the department does not exist', async () => {
      await expect(
        provisioning.provision({
          displayName: 'A',
          email: 'a@example.com',
          departmentId: '00000000-0000-0000-0000-000000000000',
          initialPassword: 'a valid passphrase',
        }),
      ).rejects.toThrow();

      const users = await pool.query<{ count: string }>('SELECT count(*) AS count FROM users');
      const identities = await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM identities',
      );
      expect(Number(users.rows[0]!.count)).toBe(0);
      expect(Number(identities.rows[0]!.count)).toBe(0);
    });

    it('refuses an email outside the configured domains, and creates nothing', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      allowedDomains = ['company.example'];

      await expect(
        provisioning.provision({
          displayName: 'A',
          email: 'someone@elsewhere.example',
          departmentId: dept.id,
          initialPassword: 'a valid passphrase',
        }),
      ).rejects.toThrow(/domain is not permitted/);

      const { rows } = await pool.query<{ count: string }>('SELECT count(*) AS count FROM users');
      expect(Number(rows[0]!.count)).toBe(0);
    });

    it('accepts a configured domain', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      allowedDomains = ['company.example'];

      const account = await provisioning.provision({
        displayName: 'A',
        email: 'someone@company.example',
        departmentId: dept.id,
        initialPassword: 'a valid passphrase',
      });
      expect(account.user.status).toBe('active');
    });

    /**
     * The company policy itself, on the deployment's real domain — the two
     * above prove the allowlist is a mechanism, these prove which value it is
     * pointed at. `hoanglonglti.com` is the schema default, so this is what a
     * deployment that configures nothing at all gets.
     *
     * ★ FRONTEND CONSTRUCTION IS NOT A CONTROL. The form appends the domain, so
     * the UI path cannot produce anything else — and none of that reaches here.
     * These call the service directly, which is the shape of an attacker who
     * skips the form and posts to `/users`.
     */
    describe('the company email policy', () => {
      beforeEach(() => {
        allowedDomains = ['hoanglonglti.com'];
      });

      it('stores and returns the FULL canonical address, not the local part', async () => {
        const dept = await departments.create({ slug: 'a', name: 'A' });

        const account = await provisioning.provision({
          displayName: 'Uyen',
          email: 'uyen@hoanglonglti.com',
          departmentId: dept.id,
          initialPassword: 'a valid passphrase',
        });

        // `username` is the DERIVED display value; the stored subject is whole.
        expect(account.username).toBe('uyen');
        const { rows } = await pool.query<{ subject: string }>(
          'SELECT subject FROM identities WHERE user_id = $1',
          [account.user.id],
        );
        expect(rows[0]!.subject).toBe('uyen@hoanglonglti.com');
      });

      it.each([
        ['an outside domain', 'uyen@gmail.com', /domain is not permitted/],
        ['another outside domain', 'nuna@yahoo.com', /domain is not permitted/],
        // What the form would have built if it had no validation at all, and
        // what a direct caller can simply type.
        ['a bare local part with no domain', 'hlt58', /not a valid address/],
        ['nothing before the @', '@hoanglonglti.com', /not a valid address/],
        ['nothing after the @', 'uyen@', /not a valid address/],
      ])('refuses %s, and creates nothing', async (_label, email, message) => {
        const dept = await departments.create({ slug: 'a', name: 'A' });

        await expect(
          provisioning.provision({
            displayName: 'A',
            email,
            departmentId: dept.id,
            initialPassword: 'a valid passphrase',
          }),
        ).rejects.toThrow(message);

        const { rows } = await pool.query<{ count: string }>('SELECT count(*) AS count FROM users');
        expect(Number(rows[0]!.count)).toBe(0);
      });
    });

    it('generates a temporary password when none is supplied, and returns it once', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });

      const account = await provisioning.provision({
        displayName: 'A',
        email: 'a@example.com',
        departmentId: dept.id,
      });

      expect(account.temporaryPassword).toEqual(expect.any(String));
      expect(account.temporaryPassword!.length).toBeGreaterThanOrEqual(12);

      // The plaintext exists nowhere in the database.
      const { rows } = await pool.query<{ secret_hash: string }>(
        'SELECT secret_hash FROM identities WHERE user_id = $1',
        [account.user.id],
      );
      expect(rows[0]!.secret_hash).not.toContain(account.temporaryPassword!);
    });

    it('does NOT return a password the caller supplied', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });

      const account = await provisioning.provision({
        displayName: 'A',
        email: 'a@example.com',
        departmentId: dept.id,
        initialPassword: 'a valid passphrase',
      });

      expect(account.temporaryPassword).toBeUndefined();
    });

    /**
     * The onboarding credential is dictated by an administrator, so it is held
     * to the TEMPORARY floor and not to the passphrase rule an employee chooses
     * for themselves. What makes that safe is the row asserted at the end: the
     * account cannot use the deployment until the credential is replaced.
     */
    it('accepts a short administrator-chosen credential, and marks it temporary', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });

      const account = await provisioning.provision({
        displayName: 'A',
        email: 'a@example.com',
        departmentId: dept.id,
        initialPassword: '12345678',
      });

      const { rows } = await pool.query<{ must_change_secret: boolean }>(
        'SELECT must_change_secret FROM identities WHERE user_id = $1',
        [account.user.id],
      );
      expect(rows[0]!.must_change_secret).toBe(true);
    });

    it('still refuses a credential below the temporary floor, and creates nothing', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });

      await expect(
        provisioning.provision({
          displayName: 'A',
          email: 'a@example.com',
          departmentId: dept.id,
          initialPassword: 'short',
        }),
      ).rejects.toThrow(/at least 8/);

      const users = await pool.query<{ count: string }>('SELECT count(*) AS count FROM users');
      const identities = await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM identities',
      );
      const memberships = await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM department_memberships',
      );
      expect(Number(users.rows[0]!.count)).toBe(0);
      expect(Number(identities.rows[0]!.count)).toBe(0);
      expect(Number(memberships.rows[0]!.count)).toBe(0);
    });

    it('serialises two concurrent provisionings of the same email', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });

      const results = await Promise.allSettled([
        provisioning.provision({
          displayName: 'A',
          email: 'same@example.com',
          departmentId: dept.id,
          initialPassword: 'a valid passphrase',
        }),
        provisioning.provision({
          displayName: 'B',
          email: 'same@example.com',
          departmentId: dept.id,
          initialPassword: 'a valid passphrase',
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM identities WHERE subject = 'same@example.com'",
      );
      expect(Number(rows[0]!.count)).toBe(1);
      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });
  });

  // ---------------------------------------------------------------- disable --

  describe('disable', () => {
    const provisionInto = async (email: string, departmentId: string) =>
      provisioning.provision({
        displayName: email,
        email,
        departmentId,
        initialPassword: 'a valid passphrase',
      });

    it('lands all five writes together', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      // A real administrator, not a bare row: a SuperAdmin is the one active
      // account the model allows to hold no department.
      const adminAccount = await provisionInto('admin@example.com', dept.id);
      const adminId = adminAccount.user.id;
      await authorization.bootstrapSuperAdmin(adminId);
      const account = await provisionInto('person@example.com', dept.id);
      await authorization.assignDepartmentHead({
        userId: account.user.id,
        departmentId: dept.id,
        grantedBy: adminId,
      });
      await sessions.issue(account.user.id);

      await lifecycle.disable({ userId: account.user.id, actingUserId: adminId });

      const user = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
        account.user.id,
      ]);
      expect(user.rows[0]!.status).toBe('disabled');

      const live = await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [account.user.id],
      );
      expect(Number(live.rows[0]!.count)).toBe(0);

      const roles = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM role_assignments WHERE user_id = $1 AND status = 'active'",
        [account.user.id],
      );
      expect(Number(roles.rows[0]!.count)).toBe(0);

      expect(await memberships.findActive(account.user.id)).toBeNull();
      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });

    it('retains the person row, the credential and the membership history', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      const account = await provisionInto('person@example.com', dept.id);

      await lifecycle.disable({ userId: account.user.id, actingUserId: account.user.id });

      const user = await pool.query('SELECT * FROM users WHERE id = $1', [account.user.id]);
      const identity = await pool.query('SELECT * FROM identities WHERE user_id = $1', [
        account.user.id,
      ]);
      const history = await pool.query('SELECT * FROM department_memberships WHERE user_id = $1', [
        account.user.id,
      ]);

      expect(user.rowCount).toBe(1);
      expect(identity.rowCount).toBe(1);
      expect(history.rowCount).toBe(1);
      expect(history.rows[0]!['status']).toBe('ended');
      expect(history.rows[0]!['ended_at']).toBeInstanceOf(Date);
    });

    /**
     * DISABLING A DEPARTMENT HEAD, through the DIRECT path this feature uses.
     *
     * The approval flow already covers offboarding a head; this pins the same
     * outcome for the entry point Employee Detail calls, because both converge
     * on this one service. Invariant #6 is what makes the ORDER load-bearing: an
     * active head assignment is held to an active membership by a composite FK,
     * so the role has to be revoked before the membership can be ended.
     */
    it('offboards a DEPARTMENT_HEAD, revoking the role before ending the membership', async () => {
      const dept = await departments.create({ slug: 'sales', name: 'Sales' });
      const head = await provisionInto('head@example.com', dept.id);
      const admin = await provisionInto('admin@example.com', dept.id);
      await authorization.bootstrapSuperAdmin(admin.user.id);
      await authorization.assignDepartmentHead({
        userId: head.user.id,
        departmentId: dept.id,
        grantedBy: admin.user.id,
      });

      await lifecycle.disable({ userId: head.user.id, actingUserId: admin.user.id });

      // The account is closed...
      const user = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
        head.user.id,
      ]);
      expect(user.rows[0]!.status).toBe('disabled');

      // ...the headship is revoked rather than deleted, keeping its provenance...
      const roles = await pool.query<{ status: string; revoked_at: Date | null }>(
        'SELECT status, revoked_at FROM role_assignments WHERE user_id = $1',
        [head.user.id],
      );
      expect(roles.rowCount).toBe(1);
      expect(roles.rows[0]!.status).toBe('revoked');
      expect(roles.rows[0]!.revoked_at).toBeInstanceOf(Date);

      // ...the membership is ended rather than removed...
      expect(await memberships.findActive(head.user.id)).toBeNull();
      const history = await pool.query('SELECT * FROM department_memberships WHERE user_id = $1', [
        head.user.id,
      ]);
      expect(history.rowCount).toBe(1);
      expect(history.rows[0]!['status']).toBe('ended');

      // ...and the person and their credential are untouched. ONE identity, one
      // user row - no duplicate was created to represent the departure.
      const identity = await pool.query('SELECT * FROM identities WHERE user_id = $1', [
        head.user.id,
      ]);
      expect(identity.rowCount).toBe(1);
      const users = await pool.query('SELECT * FROM users WHERE id = $1', [head.user.id]);
      expect(users.rowCount).toBe(1);

      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });

    it('refuses to disable the only SuperAdmin, changing nothing', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      const account = await provisionInto('admin@example.com', dept.id);
      await authorization.bootstrapSuperAdmin(account.user.id);

      await expect(
        lifecycle.disable({ userId: account.user.id, actingUserId: account.user.id }),
      ).rejects.toThrow(/no SuperAdmin/);

      const user = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
        account.user.id,
      ]);
      expect(user.rows[0]!.status).toBe('active');
      expect(await memberships.findActive(account.user.id)).not.toBeNull();
    });

    it('reports an already disabled account as a conflict', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      const account = await provisionInto('person@example.com', dept.id);
      await lifecycle.disable({ userId: account.user.id, actingUserId: account.user.id });

      await expect(
        lifecycle.disable({ userId: account.user.id, actingUserId: account.user.id }),
      ).rejects.toThrow(/already disabled/);
    });

    it('lets exactly one of two concurrent disables win', async () => {
      const dept = await departments.create({ slug: 'a', name: 'A' });
      const account = await provisionInto('person@example.com', dept.id);

      const results = await Promise.allSettled([
        lifecycle.disable({ userId: account.user.id, actingUserId: account.user.id }),
        lifecycle.disable({ userId: account.user.id, actingUserId: account.user.id }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await forbiddenStates()).toEqual({ activeNoDept: 0, disabledWithDept: 0 });
    });
  });
});
