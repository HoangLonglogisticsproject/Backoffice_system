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
const CHOSEN_A = fixturePassword('chosen-a');

/**
 * One person, one identity — over real HTTP, against a real backend and a real
 * PostgreSQL.
 *
 * BUSINESS RULE: `uyen@hoanglongti.com` and `Uyen@hoanglongti.com` are the SAME
 * account and must not exist side by side. `uyen@hoanglongti.com` and
 * `phuonguyen@hoanglongti.com` are two different people, and both are valid —
 * the rule folds case and whitespace, never the local part.
 *
 * The form is not what enforces this. `toCompanyEmail` deliberately does not
 * normalise (see `utils/validation/companyEmail.ts`), so what the client sends
 * is whatever case the user typed, and the server is what decides that two
 * spellings are one person. These specs send the variants directly.
 *
 * The DATABASE-level half of this invariant — that plain SQL cannot create the
 * duplicate either — is proven in
 * `backend/migrations/canonical-identity.integration.spec.ts`, because it needs
 * a connection rather than an HTTP client.
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

describe('canonical email identity (§1, §4, §9)', () => {
  const unique = Date.now();

  let boss: Client;
  /** A head, because only a head may raise an invitation. */
  let headOfA: Client;
  let departmentA: string;

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

    const department = await boss.post('/departments', {
      slug: `canon-${unique}`,
      name: `Canon ${unique}`,
    });
    expect(department.status).toBe(201);
    departmentA = department.data.id;

    const temporary = TEMPORARY_A;
    const chosen = CHOSEN_A;
    const headEmail = `canon-head-${unique}@hoanglongti.com`;

    const created = await boss.post('/users', {
      displayName: 'Head of Canon',
      email: headEmail,
      initialPassword: temporary,
      departmentId: departmentA,
    });
    expect(created.status).toBe(201);

    const setup = makeClient();
    expect((await login(setup, headEmail, temporary)).status).toBe(200);
    expect(
      (await setup.post('/auth/password', { currentPassword: temporary, newPassword: chosen }))
        .status,
    ).toBe(204);

    headOfA = makeClient();
    expect((await login(headOfA, headEmail, chosen)).status).toBe(200);

    expect(
      (await boss.post(`/departments/${departmentA}/head`, { userId: created.data.id })).status,
    ).toBe(201);
  });

  // ------------------------------------------------- POST /users (§4) --

  describe('creating an account directly', () => {
    const local = `uyen-${unique}`;

    it('accepts the address the first time', async () => {
      const response = await boss.post('/users', {
        displayName: 'Uyen',
        email: `${local}@hoanglongti.com`,
        initialPassword: TEMPORARY_A,
        departmentId: departmentA,
      });

      expect(response.status).toBe(201);
    });

    it.each([
      [`${local.charAt(0).toUpperCase()}${local.slice(1)}@hoanglongti.com`, 'capitalised'],
      [`${local.toUpperCase()}@HOANGLONGTI.COM`, 'all upper case'],
      [`${local}@HoangLongTI.com`, 'a mixed-case domain'],
      [`  ${local}@hoanglongti.com  `, 'surrounding whitespace'],
    ])('★ REFUSES %s — %s — as the same person', async (variant) => {
      const response = await boss.post('/users', {
        displayName: 'Uyen again',
        email: variant,
        initialPassword: TEMPORARY_A,
        departmentId: departmentA,
      });

      expect(response.status).toBe(409);
      expect(toApiError(response.status, response.data).code).toBe('CONFLICT');
    });

    it('★ still accepts a DIFFERENT colleague whose address merely looks similar', async () => {
      // The rule folds case and whitespace and nothing else. `phuonguyen` is not
      // `uyen`, and a rule that confused them would refuse a real hire.
      const response = await boss.post('/users', {
        displayName: 'Phuong Uyen',
        email: `phuong${local}@hoanglongti.com`,
        initialPassword: TEMPORARY_A,
        departmentId: departmentA,
      });

      expect(response.status).toBe(201);
    });

    it('signs in with ANY spelling of the address — the server canonicalises', async () => {
      const client = makeClient();
      const response = await login(client, `${local.toUpperCase()}@HOANGLONGTI.COM`, TEMPORARY_A);

      expect(response.status).toBe(200);
      expect(response.data.user.displayName).toBe('Uyen');
    });
  });

  // --------------------------------------- pending invitations (§9) --

  describe('raising an invitation', () => {
    const local = `joiner-${unique}`;

    it('accepts the address the first time', async () => {
      const response = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `${local}@hoanglongti.com`,
      });

      expect(response.status).toBe(201);
      // Stored canonical, so the dashboard never shows two spellings of one person.
      expect(response.data.email).toBe(`${local}@hoanglongti.com`);
    });

    it.each([
      [`${local.charAt(0).toUpperCase()}${local.slice(1)}@hoanglongti.com`, 'capitalised'],
      [`${local.toUpperCase()}@HOANGLONGTI.COM`, 'all upper case'],
      [`  ${local}@HoangLongTI.com  `, 'whitespace and mixed case'],
    ])('★ REFUSES a second pending invitation as %s — %s', async (variant) => {
      const response = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: variant,
      });

      expect(response.status).toBe(409);
      expect(toApiError(response.status, response.data).code).toBe('CONFLICT');
    });

    it('still accepts a different address', async () => {
      const response = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `nuna-${unique}@hoanglongti.com`,
      });

      expect(response.status).toBe(201);
    });

    it('★ the history carries one row per person, not one per spelling', async () => {
      // ★ DEPARTMENT-SCOPED, and that is the correction that matters here.
      //
      // This read used to go to `/account-invitations`, the GLOBAL pending
      // queue. Two things were wrong with it: the queue holds only PENDING rows
      // — so it could not see a decided invitation and would have missed a
      // second spelling that had been approved — and it is shared with every
      // other spec in this suite, which makes a `limit: 200` window a race
      // against how much history the run before it left behind.
      //
      // `/departments/:id/account-invitations` is the department's whole
      // history, pending or not, and this department was created by this file's
      // own fixture. Nothing else writes to it, at any point in any order.
      // GLOBAL may read any department's list (§9), so `boss` is entitled to it.
      const history = await boss.get(`/departments/${departmentA}/account-invitations`, {
        params: { limit: 200 },
      });
      expect(history.status).toBe(200);

      const spellings = (history.data.items as { email: string }[])
        .map((row) => row.email)
        .filter((email) => email.toLowerCase().includes(local));

      expect(spellings).toEqual([`${local}@hoanglongti.com`]);
    });
  });
});
