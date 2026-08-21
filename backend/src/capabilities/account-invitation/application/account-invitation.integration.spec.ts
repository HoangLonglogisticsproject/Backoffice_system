import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
import { decodeCursor } from '../../../common/pagination/cursor';

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

    // READ, not listed. This spec wants the schema a deployment actually runs —
    // it exercises the real repository, and `findPendingByEmail` calls
    // `canonical_identity()`, which only exists from 0010. A hand-kept list
    // silently tests a stale schema the day somebody adds a migration and
    // forgets this file; it already did, between 0008 and 0010.
    const migrations = join(__dirname, '..', '..', '..', '..', 'migrations');
    const files = (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
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

    /**
     * The company policy on the deployment's real domain — the schema default,
     * so this is what a deployment that configures nothing gets.
     *
     * The head's form appends `@hoanglongti.com` and cannot produce anything
     * else. None of that reaches here: these call the service directly, which
     * is the shape of a head who skips the form and posts to the endpoint.
     */
    describe('the company email policy', () => {
      it('accepts the company domain, and stores the full address', async () => {
        const { a, headAId } = await scenario();
        allowedDomains = ['hoanglongti.com'];

        const invitation = await invitations.create({
          departmentId: a.id,
          requestedBy: headAId,
          email: 'nuna@hoanglongti.com',
        });

        expect(invitation.email).toBe('nuna@hoanglongti.com');
      });

      it.each([
        ['an outside domain', 'nuna@gmail.com', /domain is not permitted/],
        ['a bare local part', 'hlt58', /not a valid address/],
        ['nothing before the @', '@hoanglongti.com', /not a valid address/],
      ])('refuses %s', async (_label, email, message) => {
        const { a, headAId } = await scenario();
        allowedDomains = ['hoanglongti.com'];

        await expect(
          invitations.create({ departmentId: a.id, requestedBy: headAId, email }),
        ).rejects.toThrow(message);
      });
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

  // ------------------------------------------------- cursor precision --

  describe('cursor precision on the invitation lists', () => {
    /**
     * One statement per row, so every `requested_at` comes from its own
     * transaction and carries MICROSECONDS — the precision a cursor built from
     * a JavaScript `Date` would round away, serving the page-boundary row
     * twice.
     */
    const seedInvitations = async (count: number): Promise<string> => {
      const { rows: dept } = await pool.query<{ id: string }>(
        "INSERT INTO departments (slug, name) VALUES ('prec', 'Precision') RETURNING id",
      );
      const departmentId = dept[0]!.id;

      for (let n = 0; n < count; n++) {
        await pool.query(
          `WITH u AS (INSERT INTO users (display_name) VALUES ($2) RETURNING id)
           INSERT INTO account_invitations (department_id, email, requested_by, status)
           SELECT $1, $3, id, 'pending' FROM u`,
          [departmentId, `Asker ${n}`, `person${n}@hoanglong.test`],
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
        ids.push(...page.items.map((i) => i.id));
        if (!page.hasMore) break;
        cursor = page.nextCursor as string;
      }
      return { sizes, ids };
    };

    it('a department list of 25 pages as 10 + 10 + 5, with nothing repeated', async () => {
      const departmentId = await seedInvitations(25);

      const { sizes, ids } = await walk((cursor) =>
        invitations.listForDepartment(departmentId, { limit: 10, cursor }),
      );

      expect(sizes).toEqual([10, 10, 5]);
      expect(ids).toHaveLength(25);
      expect(new Set(ids).size).toBe(25);
    });

    it('the global pending queue pages the same way, ascending', async () => {
      await seedInvitations(25);

      const { sizes, ids } = await walk((cursor) =>
        invitations.listPending({ limit: 10, cursor }),
      );

      expect(sizes).toEqual([10, 10, 5]);
      expect(new Set(ids).size).toBe(25);
    });

    it('the cursor names the row exactly, not a rounded instant', async () => {
      const departmentId = await seedInvitations(3);

      const page = await invitations.listForDepartment(departmentId, { limit: 2 });
      const { t, i } = decodeCursor(page.nextCursor as string);

      const { rows } = await pool.query<{ exact: boolean }>(
        'SELECT requested_at = $2::timestamptz AS exact FROM account_invitations WHERE id = $1',
        [i, t],
      );
      expect(rows[0]!.exact).toBe(true);
    });

    it('refuses a malformed cursor rather than silently restarting', async () => {
      const departmentId = await seedInvitations(3);

      await expect(
        invitations.listForDepartment(departmentId, { limit: 2, cursor: '!!!' }),
      ).rejects.toThrow(/Malformed cursor/);
    });
  });

  // ------------------------------------------------ identity projection --

  describe('identity projection on the invitation lists (ADR-0001)', () => {
    const seedNamedInvitation = async (
      requester: string,
    ): Promise<{ departmentId: string; requesterId: string }> => {
      const { rows: dept } = await pool.query<{ id: string }>(
        "INSERT INTO departments (slug, name) VALUES ('proj', 'Projection') RETURNING id",
      );
      const { rows: r } = await pool.query<{ id: string }>(
        'INSERT INTO users (display_name) VALUES ($1) RETURNING id',
        [requester],
      );
      await pool.query(
        `INSERT INTO account_invitations (department_id, email, requested_by, status)
         VALUES ($1, 'invited@hoanglong.test', $2, 'pending')`,
        [dept[0]!.id, r[0]!.id],
      );
      return { departmentId: dept[0]!.id, requesterId: r[0]!.id };
    };

    it('names whoever asked, alongside the scalar id', async () => {
      const { departmentId, requesterId } = await seedNamedInvitation('Asking Person');

      const page = await invitations.listForDepartment(departmentId, { limit: 10 });

      expect(page.items[0]!.requestedBy).toBe(requesterId);
      expect(page.items[0]!.requestedByUser).toEqual({
        id: requesterId,
        displayName: 'Asking Person',
      });
    });

    it('projects the same way on the global queue', async () => {
      const { requesterId } = await seedNamedInvitation('Queue Asker');

      const page = await invitations.listPending({ limit: 10 });

      expect(page.items[0]!.requestedByUser).toEqual({
        id: requesterId,
        displayName: 'Queue Asker',
      });
    });

    it('never offers the invited email as a display name', async () => {
      const { departmentId } = await seedNamedInvitation('Real Name');

      const page = await invitations.listForDepartment(departmentId, { limit: 10 });

      // `email` is the invitation's own field and stays. It is NOT a person's
      // name and must never be substituted for one.
      expect(page.items[0]!.email).toBe('invited@hoanglong.test');
      expect(page.items[0]!.requestedByUser.displayName).toBe('Real Name');
    });

    it('adds no rows, and projects nothing for the undecided fields', async () => {
      const { departmentId } = await seedNamedInvitation('Solo Asker');

      const page = await invitations.listForDepartment(departmentId, { limit: 10 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.decidedBy).toBeNull();
      expect(page.items[0]).not.toHaveProperty('decidedByUser');
      expect(page.items[0]).not.toHaveProperty('createdUser');
    });

    it('still pages correctly with the join attached', async () => {
      const { rows: dept } = await pool.query<{ id: string }>(
        "INSERT INTO departments (slug, name) VALUES ('pagejoin', 'Page Join') RETURNING id",
      );
      for (let n = 0; n < 25; n++) {
        await pool.query(
          `WITH u AS (INSERT INTO users (display_name) VALUES ($2) RETURNING id)
           INSERT INTO account_invitations (department_id, email, requested_by, status)
           SELECT $1, $3, id, 'pending' FROM u`,
          [dept[0]!.id, `Paged ${n}`, `paged${n}@hoanglong.test`],
        );
      }

      const sizes: number[] = [];
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await invitations.listForDepartment(dept[0]!.id, { limit: 10, cursor });
        sizes.push(page.items.length);
        ids.push(...page.items.map((i) => i.id));
        for (const row of page.items) expect(row.requestedByUser.id).toBe(row.requestedBy);
        if (!page.hasMore) break;
        cursor = page.nextCursor as string;
      }

      expect(sizes).toEqual([10, 10, 5]);
      expect(new Set(ids).size).toBe(25);
    });
  });

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
