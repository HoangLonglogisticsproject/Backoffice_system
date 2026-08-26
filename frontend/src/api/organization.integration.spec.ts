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
      expect(response.data.items[0]).toMatchObject({
        id: expect.any(String),
        userId: expect.any(String),
        departmentId: departmentA,
        status: 'active',
        createdAt: expect.any(String),
      });
      // A membership is still not a person: the name lives under `user`, never
      // flattened onto the membership itself.
      expect(response.data.items[0]).not.toHaveProperty('displayName');
    });

    it('★ each member arrives NAMED, over real HTTP (ADR-0001)', async () => {
      const response = await headOfA.get(`/departments/${departmentA}/members`);

      expect(response.status).toBe(200);
      for (const item of response.data.items) {
        // The scalar id is untouched, and the projection belongs to it.
        expect(item.user.id).toBe(item.userId);
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
      const someUserId = (await headOfA.get(`/departments/${departmentA}/members`)).data.items[0]
        .userId;

      const direct = await boss.get(`/users/${someUserId}`);
      expect([403, 404]).toContain(direct.status);
    });

    it('SUPERADMIN reads any department members', async () => {
      const response = await boss.get(`/departments/${departmentB}/members`);

      expect(response.status).toBe(200);
      expect(response.data.items.every((m: { departmentId: string }) => m.departmentId === departmentB))
        .toBe(true);
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
