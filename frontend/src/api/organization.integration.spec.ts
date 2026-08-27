import axios, { AxiosHeaders, type AxiosInstance } from 'axios';
import { beforeAll, describe, expect, it } from 'vitest';
import { toApiError } from '@/utils/errors';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './client';
import {
  BASE_URL,
  fixturePassword,
  requireBossCredentials,
  type BossCredentials,
} from '@/test/integration-credentials';

/**
 * The bootstrap credential, read in `beforeAll` — which is also where a
 * missing variable is reported, by name, before any request is made.
 */
let credentials: BossCredentials;

/**
 * Fixture passwords, generated per run.
 *
 * These belong to accounts this file provisions seconds earlier in a
 * disposable database, so they authenticate nothing that outlives the run —
 * but written as literals they were indistinguishable from a real credential
 * to anything grepping this repository. One constant each, kept DISTINCT:
 * two values that differ today must go on differing.
 */
const TEMPORARY_A = fixturePassword('temporary-a');
const TEMPORARY_B = fixturePassword('temporary-b');
const CHOSEN_A = fixturePassword('chosen-a');

/**
 * The two read paths, against a REAL backend and a REAL PostgreSQL.
 *
 * Authorization is the whole subject here, and it is the thing a mock is worst
 * at: a stub agrees with whatever the author believed. So the fixture builds
 * genuine actors — a global administrator, a department head, an ordinary
 * member, a head of a DIFFERENT department — and asks the server what each of
 * them may see.
 *
 * Nothing is mocked. Requires a running backend (API_BASE_URL, default
 * http://localhost:3000) and a bootstrapped SuperAdmin.
 */


type Client = AxiosInstance & { cookie: string | null };

function makeClient(): Client {
  const client = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  }) as Client;

  client.cookie = null;

  client.interceptors.request.use((config) => {
    const method = (config.method ?? 'get').toLowerCase();
    config.headers = config.headers ?? new AxiosHeaders();
    if (!['get', 'head', 'options'].includes(method)) {
      config.headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    }
    if (client.cookie) config.headers.set('Cookie', client.cookie);
    return config;
  });

  client.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    if (Array.isArray(setCookie)) {
      const session = setCookie.find((c) => c.startsWith('bo_session='));
      if (session) {
        const value = session.split(';')[0];
        client.cookie = value.endsWith('=') ? null : value;
      }
    }
    return response;
  });

  return client;
}

const login = (client: Client, email: string, password: string) =>
  client.post('/auth/login', { subject: email, password });

describe('organization read paths (§5, §6)', () => {
  const unique = Date.now();

  let boss: Client;
  /** Department A: has a head and an ordinary member. */
  let departmentA: string;
  /** Department B: exists only so "somebody else's unit" is a real place. */
  let departmentB: string;

  /** Signed-in, password already chosen, so no temporary-credential gate. */
  let headOfA: Client;
  let memberOfA: Client;
  let headOfB: Client;

  /** Provisions an account, clears its temporary credential, returns a client. */
  const provision = async (email: string, departmentId: string, displayName: string) => {
    const temporary = TEMPORARY_A;
    const chosen = CHOSEN_A;

    const created = await boss.post('/users', {
      displayName,
      email,
      initialPassword: temporary,
      departmentId,
    });
    expect(created.status).toBe(201);

    const setup = makeClient();
    expect((await login(setup, email, temporary)).status).toBe(200);
    // Until this happens every endpoint answers PASSWORD_CHANGE_REQUIRED (§12),
    // which would mask the authorization answers these tests are about.
    expect(
      (await setup.post('/auth/password', { currentPassword: temporary, newPassword: chosen }))
        .status,
    ).toBe(204);

    const client = makeClient();
    expect((await login(client, email, chosen)).status).toBe(200);
    return { client, userId: created.data.id as string };
  };

  beforeAll(async () => {
    credentials = requireBossCredentials();

    const health = await axios.get(`${BASE_URL}/health`, { validateStatus: () => true });
    if (health.status !== 200) {
      throw new Error(`No backend at ${BASE_URL} (health ${health.status}).`);
    }

    boss = makeClient();
    if ((await login(boss, credentials.email, credentials.password)).status !== 200) {
      throw new Error(`Could not sign in as ${credentials.email}. Bootstrap a SuperAdmin first.`);
    }

    const a = await boss.post('/departments', { slug: `org-a-${unique}`, name: `Org A ${unique}` });
    const b = await boss.post('/departments', { slug: `org-b-${unique}`, name: `Org B ${unique}` });
    expect([a.status, b.status]).toEqual([201, 201]);
    departmentA = a.data.id;
    departmentB = b.data.id;

    const head = await provision(`head-a-${unique}@hoanglonglti.com`, departmentA, 'Head of A');
    const member = await provision(`member-a-${unique}@hoanglonglti.com`, departmentA, 'Member of A');
    const otherHead = await provision(`head-b-${unique}@hoanglonglti.com`, departmentB, 'Head of B');

    headOfA = head.client;
    memberOfA = member.client;
    headOfB = otherHead.client;

    // Appointing a head requires an active membership in that same department —
    // the database enforces it (§15b), which is why each was provisioned into
    // the department they will lead.
    expect((await boss.post(`/departments/${departmentA}/head`, { userId: head.userId })).status)
      .toBe(201);
    expect(
      (await boss.post(`/departments/${departmentB}/head`, { userId: otherHead.userId })).status,
    ).toBe(201);
  });

  // ------------------------------------------- GET /departments/:id (§5) --

  describe('GET /departments/:departmentId', () => {
    it('SUPERADMIN reads any department, in the documented shape', async () => {
      const response = await boss.get(`/departments/${departmentA}`);

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        id: departmentA,
        slug: `org-a-${unique}`,
        name: `Org A ${unique}`,
        status: 'active',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('HEAD reads their OWN department', async () => {
      const response = await headOfA.get(`/departments/${departmentA}`);

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(departmentA);
    });

    it('MEMBER reads their own department too — `unit.read` is a member right (§5)', async () => {
      const response = await memberOfA.get(`/departments/${departmentA}`);

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(departmentA);
    });

    it('HEAD of B is REFUSED department A — 403, not 404', async () => {
      const response = await headOfB.get(`/departments/${departmentA}`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('an unknown but well-formed id is 404 for a caller who may look', async () => {
      const response = await boss.get('/departments/00000000-0000-4000-8000-000000000000');

      expect(response.status).toBe(404);
      expect(toApiError(response.status, response.data).code).toBe('NOT_FOUND');
    });

    it('a malformed id is 422, not 500', async () => {
      const response = await boss.get('/departments/not-a-uuid');

      expect(response.status).toBe(422);
      expect(toApiError(response.status, response.data).code).toBe('VALIDATION_FAILED');
    });

    it('no session is 401 — the read never reaches authorization', async () => {
      const response = await makeClient().get(`/departments/${departmentA}`);

      expect(response.status).toBe(401);
      expect(toApiError(response.status, response.data).code).toBe('UNAUTHORIZED');
    });
  });

  // ----------------------------------- GET /departments/:id/members (§6) --

  describe('GET /departments/:departmentId/members', () => {
    it('HEAD reads the members of their OWN department', async () => {
      const response = await headOfA.get(`/departments/${departmentA}/members`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.items)).toBe(true);
      expect(response.data).toHaveProperty('hasMore');
      expect(response.data).toHaveProperty('nextCursor');
      // The head and the member provisioned into A.
      expect(response.data.items.length).toBeGreaterThanOrEqual(2);
      // ★ THE ROSTER PROJECTION, over real HTTP. `id` is the MEMBERSHIP's; the
      // person is `user.id`; the unit is `department`. The two statuses are
      // separate fields and neither is named `status`, because one field would
      // have to pick a meaning and lie about the other.
      expect(response.data.items[0]).toMatchObject({
        id: expect.any(String),
        user: { id: expect.any(String), displayName: expect.any(String) },
        department: { id: departmentA, name: expect.any(String) },
        // Derived from `role_assignments`, never stored: MEMBER is the absence
        // of an active DEPARTMENT_HEAD assignment.
        role: expect.stringMatching(/^(DEPARTMENT_HEAD|MEMBER)$/),
        membershipStatus: 'active',
        accountStatus: 'active',
        joinedAt: expect.any(String),
        endedAt: null,
      });
      // A membership is still not a person: the name lives under `user`, never
      // flattened onto the membership itself.
      expect(response.data.items[0]).not.toHaveProperty('displayName');
      // ⚠ AND THE TWO STATUSES ARE NOT COLLAPSED BACK INTO ONE. A bare `status`
      // here would be exactly the merge this projection exists to prevent.
      expect(response.data.items[0]).not.toHaveProperty('status');
    });

    it('★ each member arrives NAMED, over real HTTP (ADR-0001)', async () => {
      const response = await headOfA.get(`/departments/${departmentA}/members`);

      expect(response.status).toBe(200);
      for (const item of response.data.items) {
        // ★ THE MEMBERSHIP'S id IS NOT THE PERSON'S. Three tables in this query
        // carry `id`; if one overwrote another the row would name the wrong
        // thing, and over real HTTP that is the only place it would show.
        expect(typeof item.user.id).toBe('string');
        expect(item.user.id).not.toBe(item.id);
        expect(typeof item.user.displayName).toBe('string');
        expect(item.user.displayName.length).toBeGreaterThan(0);
        // displayName ONLY. An email is not a display name.
        expect(Object.keys(item.user).sort()).toEqual(['displayName', 'id']);
      }
      // The head provisioned into A is named, so the join really read `users`.
      const names = response.data.items.map((m: { user: { displayName: string } }) => m.user.displayName);
      expect(names).toContain('Head of A');
    });

    it('★ there is no way to turn an arbitrary user id into a name', async () => {
      // ADR-0001 rejected a bulk/arbitrary lookup: a bare user id belongs to no
      // department, so the permission model has no answer for it. The absence
      // of the route IS the security property.
      // ⚠ READ FROM `user.id`. This used to read a scalar `userId` that the
      // roster projection no longer carries — so it probed `/users/undefined`
      // and passed without ever testing the property it names.
      const someUserId = (await headOfA.get(`/departments/${departmentA}/members`)).data.items[0]
        .user.id;

      const direct = await boss.get(`/users/${someUserId}`);
      expect([403, 404]).toContain(direct.status);
    });

    it('SUPERADMIN reads any department members', async () => {
      const response = await boss.get(`/departments/${departmentB}/members`);

      expect(response.status).toBe(200);
      expect(
        response.data.items.every(
          (m: { department: { id: string } }) => m.department.id === departmentB,
        ),
      ).toBe(true);
    });

    it('★ an ordinary MEMBER is REFUSED, even for their OWN department (§6)', async () => {
      // The settled default, and the one most likely to be mistaken for a bug.
      const response = await memberOfA.get(`/departments/${departmentA}/members`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('HEAD of B is REFUSED the members of A', async () => {
      const response = await headOfB.get(`/departments/${departmentA}/members`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('403 leaves the session intact — logging in again would not help', async () => {
      expect((await memberOfA.get(`/departments/${departmentA}/members`)).status).toBe(403);

      // ★ The distinction the whole error model rests on: refused, not signed
      // out. An interceptor that redirected on 403 would eject this user from a
      // perfectly good session.
      const authorization = await memberOfA.get('/authorization/me');
      expect(authorization.status).toBe(200);
      expect(authorization.data.role).toBe('MEMBER');
      expect(authorization.data.departmentIds).toEqual([departmentA]);
    });

    it('an unknown department is 404 for a caller who may look', async () => {
      const response = await boss.get(
        '/departments/00000000-0000-4000-8000-000000000000/members',
      );

      expect(response.status).toBe(404);
      expect(toApiError(response.status, response.data).code).toBe('NOT_FOUND');
    });

    it('no session is 401', async () => {
      const response = await makeClient().get(`/departments/${departmentA}/members`);

      expect(response.status).toBe(401);
      expect(toApiError(response.status, response.data).code).toBe('UNAUTHORIZED');
    });
  });

  // ------------------------------------------- temporary credential (§12) --

  describe('a temporary credential is refused BOTH reads (§12)', () => {
    it('answers PASSWORD_CHANGE_REQUIRED, not FORBIDDEN', async () => {
      // Provisioning is unfinished, so this is a different refusal from "not
      // allowed" — and it routes to a different screen. Asserting the CODE is
      // what keeps those two 403s apart.
      const email = `fresh-${unique}@hoanglonglti.com`;
      const created = await boss.post('/users', {
        displayName: 'Fresh Joiner',
        email,
        initialPassword: TEMPORARY_B,
        departmentId: departmentA,
      });
      expect(created.status).toBe(201);

      const joiner = makeClient();
      expect((await login(joiner, email, TEMPORARY_B)).status).toBe(200);

      for (const path of [`/departments/${departmentA}`, `/departments/${departmentA}/members`]) {
        const response = await joiner.get(path);
        expect(response.status).toBe(403);
        expect(toApiError(response.status, response.data).code).toBe('PASSWORD_CHANGE_REQUIRED');
      }
    });
  });

  // --------------------- GET /users/:userId/memberships (employee detail) --

  /**
   * ★ HISTORICAL MEMBERSHIP MUST NEVER GRANT CURRENT AUTHORIZATION.
   *
   * The unit specs prove this against a mocked `findActiveMembershipOf`, which
   * can only ever agree with whatever the author believed. THESE rows are real:
   * the ended membership in A and the active one in B are written by the real
   * transfer path (`POST /departments/:id/members`, which ends the old
   * membership and opens a new one in one transaction), stored in PostgreSQL,
   * and read back through the real guard over real HTTP.
   *
   * That is the difference that matters. If somebody ever changes the guard from
   * "the target's ACTIVE membership" to "any membership the target has ever
   * held", every mocked test would keep passing — the mock returns one
   * membership either way. Only a target with GENUINE history can tell the two
   * implementations apart, and that is exactly what this fixture builds.
   */
  describe('GET /users/:userId/memberships — history never authorizes', () => {
    /** Provisioned into A, then transferred away: A is ENDED, B is ACTIVE. */
    let movedAway: string;
    /** Provisioned into A, transferred to B, then back: A ended, B ended, A ACTIVE. */
    let returned: string;
    /**
     * Provisioned into A and then OFFBOARDED: one membership, in A, ENDED — and
     * no active membership at all.
     *
     * ★ THIS IS THE TARGET THAT SEPARATES THE IMPLEMENTATIONS. For somebody who
     * merely moved, the newest membership happens to be the active one, so a
     * guard that read "the newest membership" and one that read "the ACTIVE
     * membership" would agree and a test could not tell them apart. Here the
     * newest membership IS the ended one, so the two answers differ: `active`
     * says nobody, `newest` says the head of A.
     */
    let offboarded: string;

    /** The periods the SUPERADMIN can see, oldest first — the full truth. */
    const historyOf = async (userId: string) => {
      const response = await boss.get(`/users/${userId}/memberships`);
      expect(response.status).toBe(200);
      return response.data.memberships as Array<{
        department: { id: string };
        membershipStatus: 'active' | 'ended';
      }>;
    };

    beforeAll(async () => {
      const moved = await provision(
        `moved-away-${unique}@hoanglonglti.com`,
        departmentA,
        'Moved Away',
      );
      movedAway = moved.userId;
      // The REAL transfer: ends the membership in A, opens one in B.
      expect(
        (await boss.post(`/departments/${departmentB}/members`, { userId: movedAway })).status,
      ).toBe(201);

      const back = await provision(
        `returned-${unique}@hoanglonglti.com`,
        departmentA,
        'Returned Later',
      );
      returned = back.userId;
      expect(
        (await boss.post(`/departments/${departmentB}/members`, { userId: returned })).status,
      ).toBe(201);
      expect(
        (await boss.post(`/departments/${departmentA}/members`, { userId: returned })).status,
      ).toBe(201);

      const left = await provision(
        `offboarded-${unique}@hoanglonglti.com`,
        departmentA,
        'Left The Company',
      );
      offboarded = left.userId;
      // The REAL offboarding path: revokes roles, disables the account, cuts
      // sessions and ENDS the active membership, in one transaction.
      expect(
        (await boss.patch(`/users/${offboarded}/status`, { status: 'disabled' })).status,
      ).toBe(200);
    });

    /**
     * ⚠ THE FIXTURE IS ASSERTED BEFORE THE SECURITY QUESTION IS ASKED. A 403 is
     * also what a target with no history at all would produce, so without this
     * the test could pass while proving nothing.
     */
    it('really did persist an ENDED membership in A and an ACTIVE one in B', async () => {
      const periods = await historyOf(movedAway);

      const inA = periods.filter((p) => p.department.id === departmentA);
      const inB = periods.filter((p) => p.department.id === departmentB);

      expect(inA).toHaveLength(1);
      expect(inA[0]!.membershipStatus).toBe('ended');
      expect(inB).toHaveLength(1);
      expect(inB[0]!.membershipStatus).toBe('active');
    });

    it('the caller really is head of A, and really is not head of B', async () => {
      // Reading A's roster is the head's own right; reading B's is not.
      expect((await headOfA.get(`/departments/${departmentA}/members`)).status).toBe(200);
      expect((await headOfA.get(`/departments/${departmentB}/members`)).status).toBe(403);
    });

    /**
     * ★ THE INVARIANT. The head of A shares a department with this person ONLY
     * in the past. That must not be a key to anything.
     */
    it('refuses a department head when the shared department is only historical', async () => {
      const response = await headOfA.get(`/users/${movedAway}/memberships`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('refuses a head of B for somebody whose only tie to B is in the future of A', async () => {
      // The mirror image: `returned` is ACTIVE in A and ENDED in B, so B's head
      // is the one holding nothing but history now.
      const response = await headOfB.get(`/users/${returned}/memberships`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('really did leave the offboarded person with an ENDED membership in A and no active one', async () => {
      const periods = await historyOf(offboarded);

      expect(periods).toHaveLength(1);
      expect(periods[0]!.department.id).toBe(departmentA);
      expect(periods[0]!.membershipStatus).toBe('ended');
      expect(periods.some((p) => p.membershipStatus === 'active')).toBe(false);
    });

    /**
     * ★ THE CASE A MOCK CANNOT STAGE. This person's ONLY membership is in the
     * caller's own department — and it is over. "The department they were last
     * in" and "the department they are in" give different answers here, and only
     * the second may authorize anybody.
     */
    it('refuses the head of A for somebody whose only membership in A has ended', async () => {
      const response = await headOfA.get(`/users/${offboarded}/memberships`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('still shows the offboarded person to a SUPERADMIN — disabled is not deleted', async () => {
      const response = await boss.get(`/users/${offboarded}/memberships`);

      expect(response.status).toBe(200);
      expect(response.data.accountStatus).toBe('disabled');
      expect(response.data.memberships).toHaveLength(1);
    });

    it('refuses an ordinary member outright', async () => {
      const response = await memberOfA.get(`/users/${movedAway}/memberships`);

      expect(response.status).toBe(403);
    });

    it('refuses an unauthenticated caller', async () => {
      const response = await makeClient().get(`/users/${movedAway}/memberships`);

      expect(response.status).toBe(401);
    });

    /**
     * The positive counterpart, on a target whose history spans BOTH units.
     * Access is granted by the ACTIVE membership in A — and the periods in B are
     * filtered out by the server, so a scoped history cannot even name a unit
     * this caller has no authority over.
     */
    it('allows the head of A once the membership in A is the current one', async () => {
      const response = await headOfA.get(`/users/${returned}/memberships`);

      expect(response.status).toBe(200);
      expect(response.data.user.id).toBe(returned);
      expect(response.data.accountStatus).toBe('active');

      const periods = response.data.memberships as Array<{
        department: { id: string };
        membershipStatus: 'active' | 'ended';
      }>;
      // Both A periods — the ended one and the current one — and NOTHING from B.
      expect(periods.every((p) => p.department.id === departmentA)).toBe(true);
      expect(periods.some((p) => p.membershipStatus === 'active')).toBe(true);
      expect(periods.some((p) => p.membershipStatus === 'ended')).toBe(true);
      expect(periods.some((p) => p.department.id === departmentB)).toBe(false);
    });

    it('shows a SUPERADMIN every period, across both units', async () => {
      const periods = await historyOf(returned);

      expect(periods.filter((p) => p.department.id === departmentA)).toHaveLength(2);
      expect(periods.filter((p) => p.department.id === departmentB)).toHaveLength(1);
      // One person, three employment periods — never three employees.
      const response = await boss.get(`/users/${returned}/memberships`);
      expect(response.data.user.id).toBe(returned);
    });
  });

  // ------------------------------------------------ scope comes from URL --

  describe('scope is the route parameter, never the body (§15)', () => {
    it('a body naming another department changes nothing', async () => {
      // The value is stripped: a read is scoped by its URL, and a caller cannot
      // widen it by asking nicely.
      const response = await headOfA.request({
        method: 'get',
        url: `/departments/${departmentA}`,
        data: { departmentId: departmentB, sourceDepartmentId: departmentB },
      });

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(departmentA);
    });
  });
});
