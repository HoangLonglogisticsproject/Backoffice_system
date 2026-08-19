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
import { AccountProvisioningService } from '../../../core/users/application/account-provisioning.service';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import { AccountInvitationRepository } from '../persistence/account-invitation.repository';
import { AccountInvitationService } from './account-invitation.service';

/**
 * Onboarding against a REAL PostgreSQL.
 *
 * The claims that need a real server:
 *
 *   NOTHING BEFORE APPROVAL   a pending invitation creates no person, no
 *                             credential, no membership
 *   EVERYTHING AT APPROVAL    all four land in one commit, or none do
 *   ONE ACCOUNT PER EMAIL     under two heads inviting, two administrators
 *                             approving, and a direct account creation racing
 *                             the approval
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;
const SCHEMA = 'invitation_itest';

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

describeIntegration('Account invitation against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let invitations: AccountInvitationService;
  let departments: DepartmentService;
  let memberships: MembershipService;
  let authorization: AuthorizationService;
  let provisioning: AccountProvisioningService;
  let allowedDomains: string[];

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
      '0007_account_invitations.sql',
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

    allowedDomains = [];
    const config = {
      get allowedEmailDomains() {
        return allowedDomains;
      },
    } as unknown as AppConfig;

    const users = new UserRepository(database);
    const identities = new IdentityRepository(database);
    const departmentRepository = new DepartmentRepository(database);
    const membershipRepository = new MembershipRepository(database);
    const assignments = new AuthorizationRepository(database);

    departments = new DepartmentService(database, departmentRepository, membershipRepository);
    memberships = new MembershipService(database, departmentRepository, membershipRepository);
    authorization = new AuthorizationService(
      database,
      assignments,
      departmentRepository,
      membershipRepository,
      new SessionService(new SessionRepository(database)),
    );
    provisioning = new AccountProvisioningService(
      database,
      fakeHasher,
      users,
      identities,
      memberships,
      config,
    );
    invitations = new AccountInvitationService(
      database,
      new AccountInvitationRepository(database),
      provisioning,
      identities,
      departmentRepository,
      assignments,
      config,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    allowedDomains = [];
    await pool.query(
      `TRUNCATE account_invitations, membership_change_requests, role_assignments,
                department_memberships, departments, sessions, identities, users CASCADE`,
    );
  });

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

    const headA = await provisioning.provision({
      displayName: 'Head A',
      email: 'head.a@example.com',
      departmentId: a.id,
      initialPassword: 'a valid passphrase',
    });
    await authorization.assignDepartmentHead({
      userId: headA.user.id,
      departmentId: a.id,
      grantedBy: admin.user.id,
    });

    const headB = await provisioning.provision({
      displayName: 'Head B',
      email: 'head.b@example.com',
      departmentId: b.id,
      initialPassword: 'a valid passphrase',
    });
    await authorization.assignDepartmentHead({
      userId: headB.user.id,
      departmentId: b.id,
      grantedBy: admin.user.id,
    });

    return { a, b, adminId: admin.user.id, headAId: headA.user.id, headBId: headB.user.id };
  };

  const countRows = async (table: string, where = '', params: unknown[] = []): Promise<number> => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM ${table} ${where}`,
      params,
    );
    return Number(rows[0]!.count);
  };

  // ------------------------------------------------------------------ create --

  describe('inviting', () => {
    it('creates NOTHING but the invitation', async () => {
      const { a, headAId } = await scenario();
      const usersBefore = await countRows('users');

      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      expect(invitation.status).toBe('pending');
      expect(invitation.createdUserId).toBeNull();
      expect(invitation.departmentId).toBe(a.id);
      expect(await countRows('users')).toBe(usersBefore);
      expect(
        await countRows('identities', 'WHERE subject = $1', ['newcomer@example.com']),
      ).toBe(0);
    });

    it('normalises the address', async () => {
      const { a, headAId } = await scenario();

      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: '  NewComer@Example.COM ',
      });

      expect(invitation.email).toBe('newcomer@example.com');
    });

    it('refuses an address that already has an account', async () => {
      const { a, headAId } = await scenario();

      await expect(
        invitations.create({
          departmentId: a.id,
          requestedBy: headAId,
          email: 'admin@example.com',
        }),
      ).rejects.toThrow(/already has an account/);
    });

    it('refuses an address whose account is disabled — the email stays theirs', async () => {
      const { a, headAId, adminId } = await scenario();
      const person = await provisioning.provision({
        displayName: 'Person',
        email: 'gone@example.com',
        departmentId: a.id,
        initialPassword: 'a valid passphrase',
      });
      void adminId;
      await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [person.user.id]);

      await expect(
        invitations.create({
          departmentId: a.id,
          requestedBy: headAId,
          email: 'gone@example.com',
        }),
      ).rejects.toThrow(/already has an account/);
    });

    it('refuses an address outside the configured domains', async () => {
      const { a, headAId } = await scenario();
      allowedDomains = ['company.example'];

      await expect(
        invitations.create({
          departmentId: a.id,
          requestedBy: headAId,
          email: 'someone@elsewhere.example',
        }),
      ).rejects.toThrow(/domain is not permitted/);
    });

    it('refuses a second pending invitation for the same email, from ANY department', async () => {
      const { a, b, headAId, headBId } = await scenario();
      await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      await expect(
        invitations.create({
          departmentId: b.id,
          requestedBy: headBId,
          email: 'newcomer@example.com',
        }),
      ).rejects.toThrow(/awaiting a decision/);
    });

    it('lets exactly one of two concurrent invitations for the same email through', async () => {
      const { a, b, headAId, headBId } = await scenario();

      const results = await Promise.allSettled([
        invitations.create({
          departmentId: a.id,
          requestedBy: headAId,
          email: 'newcomer@example.com',
        }),
        invitations.create({
          departmentId: b.id,
          requestedBy: headBId,
          email: 'newcomer@example.com',
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await countRows('account_invitations')).toBe(1);
    });
  });

  // ----------------------------------------------------------------- approve --

  describe('approving', () => {
    it('creates person, credential and membership in the inviting head’s department', async () => {
      const { a, adminId, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      const approved = await invitations.approve({
        invitationId: invitation.id,
        decidedBy: adminId,
        displayName: 'New Comer',
      });

      expect(approved.invitation.status).toBe('approved');
      expect(approved.invitation.createdUserId).not.toBeNull();
      expect(approved.username).toBe('newcomer');

      const userId = approved.invitation.createdUserId!;
      expect((await memberships.findActive(userId))?.departmentId).toBe(a.id);

      const { rows } = await pool.query<{ must_change_secret: boolean; secret_hash: string }>(
        'SELECT must_change_secret, secret_hash FROM identities WHERE user_id = $1',
        [userId],
      );
      expect(rows[0]!.must_change_secret).toBe(true);
      // The plaintext is nowhere in storage.
      expect(rows[0]!.secret_hash).not.toContain(approved.temporaryPassword);
    });

    it('returns a temporary password, and no column anywhere holds it', async () => {
      const { a, adminId, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      const approved = await invitations.approve({
        invitationId: invitation.id,
        decidedBy: adminId,
      });

      expect(approved.temporaryPassword).toEqual(expect.any(String));

      const stored = await pool.query('SELECT * FROM account_invitations WHERE id = $1', [
        invitation.id,
      ]);
      expect(JSON.stringify(stored.rows[0])).not.toContain(approved.temporaryPassword);
    });

    it('refuses a self-decision', async () => {
      const { a, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      await expect(
        invitations.approve({ invitationId: invitation.id, decidedBy: headAId }),
      ).rejects.toThrow(/cannot decide your own/);
    });

    it('refuses when the department was archived in the meantime', async () => {
      const { b, adminId, headBId } = await scenario();
      const invitation = await invitations.create({
        departmentId: b.id,
        requestedBy: headBId,
        email: 'newcomer@example.com',
      });

      // Empty the department first: archiving refuses while anyone is in it.
      const headMembership = await memberships.findActive(headBId);
      const a = await departments.create({ slug: 'holding', name: 'Holding' });
      const headAssignment = await pool.query<{ id: string }>(
        `SELECT id FROM role_assignments WHERE user_id = $1 AND status = 'active'
           AND role_key = 'DEPARTMENT_HEAD'`,
        [headBId],
      );
      await authorization.revokeAssignment({
        assignmentId: headAssignment.rows[0]!.id,
        revokedBy: adminId,
      });
      void headMembership;
      await memberships.transfer({ userId: headBId, toDepartmentId: a.id });
      await departments.archive(b.id);

      await expect(
        invitations.approve({ invitationId: invitation.id, decidedBy: adminId }),
      ).rejects.toThrow(/archived|no longer leads/);

      expect(await countRows('identities', 'WHERE subject = $1', ['newcomer@example.com'])).toBe(0);
    });

    it('refuses when the requester no longer leads the department', async () => {
      const { a, adminId, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });
      const headAssignment = await pool.query<{ id: string }>(
        `SELECT id FROM role_assignments WHERE user_id = $1 AND status = 'active'
           AND role_key = 'DEPARTMENT_HEAD'`,
        [headAId],
      );
      await authorization.revokeAssignment({
        assignmentId: headAssignment.rows[0]!.id,
        revokedBy: adminId,
      });

      await expect(
        invitations.approve({ invitationId: invitation.id, decidedBy: adminId }),
      ).rejects.toThrow(/no longer leads/);
    });

    it('refuses — and creates nothing — when the address was provisioned meanwhile', async () => {
      const { a, adminId, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      // A global administrator creates the same account directly.
      await provisioning.provision({
        displayName: 'Direct',
        email: 'newcomer@example.com',
        departmentId: a.id,
        initialPassword: 'a valid passphrase',
      });

      await expect(
        invitations.approve({ invitationId: invitation.id, decidedBy: adminId }),
      ).rejects.toThrow(/already has an account/);

      expect(await countRows('identities', 'WHERE subject = $1', ['newcomer@example.com'])).toBe(1);

      // The invitation is still pending, so it can be rejected explicitly.
      const stored = await pool.query<{ status: string }>(
        'SELECT status FROM account_invitations WHERE id = $1',
        [invitation.id],
      );
      expect(stored.rows[0]!.status).toBe('pending');
    });

    it('lets exactly one of two concurrent approvals create the account', async () => {
      const { a, adminId, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      const results = await Promise.allSettled([
        invitations.approve({ invitationId: invitation.id, decidedBy: adminId }),
        invitations.approve({ invitationId: invitation.id, decidedBy: adminId }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await countRows('identities', 'WHERE subject = $1', ['newcomer@example.com'])).toBe(1);
      expect(await countRows('users', "WHERE display_name = 'newcomer@example.com'")).toBeLessThanOrEqual(1);
    });

    it('approving twice in sequence is a conflict', async () => {
      const { a, adminId, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });
      await invitations.approve({ invitationId: invitation.id, decidedBy: adminId });

      await expect(
        invitations.approve({ invitationId: invitation.id, decidedBy: adminId }),
      ).rejects.toThrow(/not awaiting a decision/);
    });
  });

  // ------------------------------------------------------------------ reject --

  describe('rejecting', () => {
    it('creates nothing, and frees the address to be invited again', async () => {
      const { a, adminId, headAId } = await scenario();
      const invitation = await invitations.create({
        departmentId: a.id,
        requestedBy: headAId,
        email: 'newcomer@example.com',
      });

      const rejected = await invitations.reject({
        invitationId: invitation.id,
        decidedBy: adminId,
      });

      expect(rejected.status).toBe('rejected');
      expect(rejected.createdUserId).toBeNull();
      expect(await countRows('identities', 'WHERE subject = $1', ['newcomer@example.com'])).toBe(0);

      await expect(
        invitations.create({
          departmentId: a.id,
          requestedBy: headAId,
          email: 'newcomer@example.com',
        }),
      ).resolves.toMatchObject({ status: 'pending' });
    });
  });

  // -------------------------------------------------------------- DB CHECKs --

  describe('database constraints', () => {
    it('refuses approved with no account, and pending with one', async () => {
      const { a, adminId, headAId } = await scenario();

      await expect(
        pool.query(
          `INSERT INTO account_invitations
             (department_id, email, status, requested_by, decided_by, decided_at)
           VALUES ($1, 'x@example.com', 'approved', $2, $3, now())`,
          [a.id, headAId, adminId],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        pool.query(
          `INSERT INTO account_invitations
             (department_id, email, requested_by, created_user_id)
           VALUES ($1, 'y@example.com', $2, $3)`,
          [a.id, headAId, adminId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a self-approval at the database level too', async () => {
      const { a, headAId } = await scenario();

      await expect(
        pool.query(
          `INSERT INTO account_invitations
             (department_id, email, status, requested_by, decided_by, decided_at, created_user_id)
           VALUES ($1, 'z@example.com', 'approved', $2, $2, now(), $2)`,
          [a.id, headAId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
