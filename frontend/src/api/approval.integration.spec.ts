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
 * The five approval / head read paths, against a REAL backend and a REAL
 * PostgreSQL. Nothing is mocked.
 *
 * These endpoints exist BECAUSE of an authorization split — a head proposes, a
 * global administrator decides — so the split is what the tests are about. Real
 * actors are provisioned for it: a global administrator, the head of A, an
 * ordinary member of A, and the head of a different department B.
 *
 * Requires a running backend (API_BASE_URL, default http://localhost:3000) and
 * a bootstrapped SuperAdmin.
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

const codeOf = (response: { status: number; data: unknown }) =>
  toApiError(response.status, response.data).code;

describe('approval + department head read paths (§9, §10, §15b)', () => {
  const unique = Date.now();

  let boss: Client;
  let departmentA: string;
  let departmentB: string;
  /** A department deliberately left WITHOUT a head, for the 404 case. */
  let departmentHeadless: string;

  let headOfA: Client;
  let memberOfA: Client;
  let headOfB: Client;
  /** Signed in, password never changed — still on a temporary credential. */
  let temporaryCredential: Client;

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
    if (health.status !== 200) throw new Error(`No backend at ${BASE_URL} (health ${health.status}).`);

    boss = makeClient();
    if ((await login(boss, credentials.email, credentials.password)).status !== 200) {
      throw new Error(`Could not sign in as ${credentials.email}. Bootstrap a SuperAdmin first.`);
    }

    const make = async (slug: string) => {
      const response = await boss.post('/departments', { slug, name: slug });
      expect(response.status).toBe(201);
      return response.data.id as string;
    };

    departmentA = await make(`apr-a-${unique}`);
    departmentB = await make(`apr-b-${unique}`);
    departmentHeadless = await make(`apr-none-${unique}`);

    const a = await provision(`apr-head-a-${unique}@hoanglongti.com`, departmentA, 'Head of A');
    const m = await provision(`apr-member-a-${unique}@hoanglongti.com`, departmentA, 'Member of A');
    const b = await provision(`apr-head-b-${unique}@hoanglongti.com`, departmentB, 'Head of B');

    headOfA = a.client;
    memberOfA = m.client;
    headOfB = b.client;

    expect((await boss.post(`/departments/${departmentA}/head`, { userId: a.userId })).status)
      .toBe(201);
    expect((await boss.post(`/departments/${departmentB}/head`, { userId: b.userId })).status)
      .toBe(201);

    // Provisioned and signed in, but never changed the password.
    const freshEmail = `apr-fresh-${unique}@hoanglongti.com`;
    expect(
      (
        await boss.post('/users', {
          displayName: 'Fresh Joiner',
          email: freshEmail,
          initialPassword: TEMPORARY_B,
          departmentId: departmentA,
        })
      ).status,
    ).toBe(201);
    temporaryCredential = makeClient();
    expect((await login(temporaryCredential, freshEmail, TEMPORARY_B)).status).toBe(200);
  });

  // ------------------------------- GET /departments/:id/membership-requests --

  describe('GET /departments/:departmentId/membership-requests (§10)', () => {
    it('HEAD reads their OWN department queue', async () => {
      const response = await headOfA.get(`/departments/${departmentA}/membership-requests`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.items)).toBe(true);
      expect(response.data).toHaveProperty('hasMore');
      expect(response.data).toHaveProperty('nextCursor');
    });

    it('GLOBAL reads any department queue', async () => {
      const response = await boss.get(`/departments/${departmentA}/membership-requests`);
      expect(response.status).toBe(200);
    });

    it('HEAD of B is REFUSED department A — 403 FORBIDDEN', async () => {
      const response = await headOfB.get(`/departments/${departmentA}/membership-requests`);

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('an ordinary MEMBER is refused their own department queue', async () => {
      const response = await memberOfA.get(`/departments/${departmentA}/membership-requests`);

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('anonymous is 401', async () => {
      const response = await makeClient().get(`/departments/${departmentA}/membership-requests`);

      expect(response.status).toBe(401);
      expect(codeOf(response)).toBe('UNAUTHORIZED');
    });

    it('a temporary credential is PASSWORD_CHANGE_REQUIRED, not FORBIDDEN', async () => {
      const response = await temporaryCredential.get(
        `/departments/${departmentA}/membership-requests`,
      );

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('a malformed department id is 422', async () => {
      const response = await boss.get('/departments/not-a-uuid/membership-requests');

      expect(response.status).toBe(422);
      expect(codeOf(response)).toBe('VALIDATION_FAILED');
    });
  });

  // ------------------------------------------- GET /membership-requests --

  describe('GET /membership-requests — the global queue (§10)', () => {
    it('GLOBAL reads it, and gets an array', async () => {
      const response = await boss.get('/membership-requests');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.items)).toBe(true);
      expect(response.data).toHaveProperty('hasMore');
      expect(response.data).toHaveProperty('nextCursor');
    });

    it('★ HEAD is REFUSED — a head proposes and never decides', async () => {
      const response = await headOfA.get('/membership-requests');

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('MEMBER is refused', async () => {
      const response = await memberOfA.get('/membership-requests');

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('anonymous is 401', async () => {
      const response = await makeClient().get('/membership-requests');

      expect(response.status).toBe(401);
      expect(codeOf(response)).toBe('UNAUTHORIZED');
    });

    it('403 leaves the head`s session intact', async () => {
      expect((await headOfA.get('/membership-requests')).status).toBe(403);

      // Refused, not signed out. Logging in again would change nothing.
      const authorization = await headOfA.get('/authorization/me');
      expect(authorization.status).toBe(200);
      expect(authorization.data.role).toBe('DEPARTMENT_HEAD');
    });
  });

  // ----------------------------- GET /departments/:id/account-invitations --

  describe('GET /departments/:departmentId/account-invitations (§9)', () => {
    it('HEAD reads their OWN department invitations', async () => {
      const response = await headOfA.get(`/departments/${departmentA}/account-invitations`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.items)).toBe(true);
      expect(response.data).toHaveProperty('hasMore');
      expect(response.data).toHaveProperty('nextCursor');
    });

    it('GLOBAL reads any department invitations', async () => {
      const response = await boss.get(`/departments/${departmentA}/account-invitations`);
      expect(response.status).toBe(200);
    });

    it('HEAD of B is REFUSED department A', async () => {
      const response = await headOfB.get(`/departments/${departmentA}/account-invitations`);

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('anonymous is 401', async () => {
      const response = await makeClient().get(`/departments/${departmentA}/account-invitations`);

      expect(response.status).toBe(401);
    });

    it('a temporary credential is PASSWORD_CHANGE_REQUIRED', async () => {
      const response = await temporaryCredential.get(
        `/departments/${departmentA}/account-invitations`,
      );

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('PASSWORD_CHANGE_REQUIRED');
    });
  });

  // ------------------------------------------ GET /account-invitations --

  describe('GET /account-invitations — the global queue (§9)', () => {
    it('GLOBAL reads it', async () => {
      const response = await boss.get('/account-invitations');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.items)).toBe(true);
      expect(response.data).toHaveProperty('hasMore');
      expect(response.data).toHaveProperty('nextCursor');
    });

    it('HEAD is REFUSED', async () => {
      const response = await headOfA.get('/account-invitations');

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('MEMBER is refused', async () => {
      const response = await memberOfA.get('/account-invitations');

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('anonymous is 401', async () => {
      const response = await makeClient().get('/account-invitations');
      expect(response.status).toBe(401);
    });

    it('carries no password field, for a real pending invitation (§13)', async () => {
      // Raise one through the head so the list is not empty.
      const invited = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `apr-invitee-${unique}@hoanglongti.com`,
      });
      expect(invited.status).toBe(201);

      const response = await boss.get('/account-invitations');
      expect(response.status).toBe(200);
      expect(response.data.items.length).toBeGreaterThan(0);

      const row = response.data.items.find(
        (i: { email: string }) => i.email === `apr-invitee-${unique}@hoanglongti.com`,
      );
      expect(row).toMatchObject({
        departmentId: departmentA,
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        createdUserId: null,
      });
      expect(JSON.stringify(response.data)).not.toMatch(/password/i);
    });
  });

  // ------------------------------------- GET /departments/:id/head (§15b) --

  describe('GET /departments/:departmentId/head (§15b)', () => {
    it('GLOBAL reads it, in the documented shape', async () => {
      const response = await boss.get(`/departments/${departmentA}/head`);

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        assignmentId: expect.any(String),
        departmentId: departmentA,
        userId: expect.any(String),
        membershipId: expect.any(String),
        grantedAt: expect.any(String),
      });
    });

    it('★ HEAD is REFUSED — even for the department they lead', async () => {
      // The whole route family is GLOBAL-only, read included. A head cannot
      // see their own appointment through it, which is unusual enough that a
      // 403 here reads like a scope bug until you check the contract.
      const response = await headOfA.get(`/departments/${departmentA}/head`);

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('MEMBER is refused', async () => {
      const response = await memberOfA.get(`/departments/${departmentA}/head`);

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });

    it('a department with NO head is 404, not an empty body', async () => {
      const response = await boss.get(`/departments/${departmentHeadless}/head`);

      expect(response.status).toBe(404);
      expect(codeOf(response)).toBe('NOT_FOUND');
    });

    it('an unknown department is ALSO 404 — indistinguishable by shape', async () => {
      const response = await boss.get(
        '/departments/00000000-0000-4000-8000-000000000000/head',
      );

      expect(response.status).toBe(404);
      expect(codeOf(response)).toBe('NOT_FOUND');
    });

    it('a malformed id is 422, not 500', async () => {
      const response = await boss.get('/departments/not-a-uuid/head');

      expect(response.status).toBe(422);
      expect(codeOf(response)).toBe('VALIDATION_FAILED');
    });

    it('anonymous is 401', async () => {
      const response = await makeClient().get(`/departments/${departmentA}/head`);

      expect(response.status).toBe(401);
      expect(codeOf(response)).toBe('UNAUTHORIZED');
    });

    it('a temporary credential is PASSWORD_CHANGE_REQUIRED', async () => {
      const response = await temporaryCredential.get(`/departments/${departmentA}/head`);

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('PASSWORD_CHANGE_REQUIRED');
    });
  });

  // ------------------------------------------------- the two 403s differ --

  describe('the two 403s are told apart by CODE, not status', () => {
    it('same status, different code, different destination', async () => {
      const refused = await memberOfA.get('/account-invitations');
      const unfinished = await temporaryCredential.get('/account-invitations');

      expect(refused.status).toBe(403);
      expect(unfinished.status).toBe(403);

      // Identical status. Only the code separates "you may not" — which stays
      // on the page — from "finish provisioning" — which routes to the change
      // password screen. Branching on status alone would send both to the
      // same place, and one of them would be wrong.
      expect(codeOf(refused)).toBe('FORBIDDEN');
      expect(codeOf(unfinished)).toBe('PASSWORD_CHANGE_REQUIRED');
      expect(codeOf(refused)).not.toBe(codeOf(unfinished));
    });
  });
});
