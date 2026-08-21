import axios, { AxiosHeaders, type AxiosInstance } from 'axios';
import { beforeAll, describe, expect, it } from 'vitest';
import { toApiError } from '../http/apiError';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../http/client';

/**
 * The integration contract, against a REAL backend and a REAL PostgreSQL.
 *
 * Nothing is mocked. Every assertion below is the actual wire behaviour, which
 * is the only thing that settles questions like "is the field called subject"
 * or "does a 403 mean the session ended" — a mock would happily agree with a
 * wrong belief.
 *
 * Requires, and deliberately fails rather than skips if absent:
 *
 *   API_BASE_URL   a running backend (default http://localhost:3000)
 *   BOSS_EMAIL / BOSS_PASSWORD   a bootstrapped SuperAdmin
 *
 * Cookies are handled by hand. Node's axios has no cookie jar, and doing it
 * explicitly is the point: these tests are ABOUT the cookie, so the mechanics
 * should be visible rather than delegated to a library.
 */

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const BOSS_EMAIL = process.env.BOSS_EMAIL ?? 'boss@hoanglongti.com';
const BOSS_PASSWORD = process.env.BOSS_PASSWORD ?? 'correct horse battery staple';

/** A client that mirrors the app's real transport rules, plus a cookie jar. */
function makeClient(): AxiosInstance & { cookie: string | null } {
  const client = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
    // Never throw on status: these tests assert on codes, including 4xx.
    validateStatus: () => true,
  }) as AxiosInstance & { cookie: string | null };

  client.cookie = null;

  client.interceptors.request.use((config) => {
    const method = (config.method ?? 'get').toLowerCase();
    if (!['get', 'head', 'options'].includes(method)) {
      config.headers = config.headers ?? new AxiosHeaders();
      config.headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    }
    if (client.cookie) config.headers.set('Cookie', client.cookie);
    return config;
  });

  client.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    if (Array.isArray(setCookie) && setCookie.length > 0) {
      const session = setCookie.find((c) => c.startsWith('bo_session='));
      if (session) {
        const value = session.split(';')[0];
        // An expiry in the past is the server clearing it (logout, password change).
        client.cookie = value.endsWith('=') ? null : value;
      }
    }
    return response;
  });

  return client;
}

const login = async (client: ReturnType<typeof makeClient>, email: string, password: string) =>
  client.post('/auth/login', { subject: email, password });

describe('frontend ↔ backend integration', () => {
  let boss: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    boss = makeClient();

    const health = await axios.get(`${BASE_URL}/health`, { validateStatus: () => true });
    if (health.status !== 200) {
      throw new Error(
        `No backend at ${BASE_URL} (health ${health.status}). Start it before running integration specs.`,
      );
    }

    const response = await login(boss, BOSS_EMAIL, BOSS_PASSWORD);
    if (response.status !== 200) {
      throw new Error(
        `Could not sign in as ${BOSS_EMAIL} (${response.status}). Bootstrap a SuperAdmin first.`,
      );
    }
  });

  // --------------------------------------------------------------- login --

  describe('login (§1)', () => {
    it('accepts `subject` and sets an HttpOnly session cookie', async () => {
      const client = makeClient();
      const response = await login(client, BOSS_EMAIL, BOSS_PASSWORD);

      expect(response.status).toBe(200);

      const cookie = (response.headers['set-cookie'] as string[]).find((c) =>
        c.startsWith('bo_session='),
      );
      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
    });

    it('REFUSES `email` as the field name — 422 (§1)', async () => {
      const client = makeClient();
      const response = await client.post('/auth/login', {
        email: BOSS_EMAIL,
        password: BOSS_PASSWORD,
      });

      expect(response.status).toBe(422);
      expect(toApiError(response.status, response.data).code).toBe('VALIDATION_FAILED');
    });

    it('never returns a token in the body (§1)', async () => {
      const client = makeClient();
      const response = await login(client, BOSS_EMAIL, BOSS_PASSWORD);

      expect(response.data).toHaveProperty('user');
      expect(response.data).toHaveProperty('expiresAt');
      expect(JSON.stringify(response.data)).not.toMatch(/token/i);
    });

    it('answers 401 for a wrong password, saying nothing about the account', async () => {
      const client = makeClient();
      const response = await login(client, BOSS_EMAIL, 'definitely the wrong one');

      expect(response.status).toBe(401);
      expect(toApiError(response.status, response.data).code).toBe('UNAUTHORIZED');
    });
  });

  // ---------------------------------------------------------------- CSRF --

  describe('CSRF (§2)', () => {
    it('refuses a mutation without the header — 403', async () => {
      const bare = axios.create({ baseURL: BASE_URL, validateStatus: () => true });
      const response = await bare.post('/auth/login', {
        subject: BOSS_EMAIL,
        password: BOSS_PASSWORD,
      });

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('allows a GET without it — reads are not mutations', async () => {
      const response = await boss.get('/authorization/me');
      expect(response.status).toBe(200);
    });
  });

  // ------------------------------------------------------------- session --

  describe('session states (§3, §3b)', () => {
    it('READY: /authorization/me returns role, departmentIds and permissions', async () => {
      const response = await boss.get('/authorization/me');

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        userId: expect.any(String),
        username: expect.any(String),
        role: 'SUPERADMIN',
        departmentIds: expect.any(Array),
        permissions: expect.any(Array),
      });
      // SUPERADMIN sits above departments (§3).
      expect(response.data.departmentIds).toEqual([]);
    });

    it('ANONYMOUS: /authorization/me is 401 without a cookie — not 200 with empty permissions', async () => {
      const anonymous = makeClient();
      const response = await anonymous.get('/authorization/me');

      expect(response.status).toBe(401);
      expect(toApiError(response.status, response.data).code).toBe('UNAUTHORIZED');
    });

    it('/auth/me returns identity only', async () => {
      const response = await boss.get('/auth/me');

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({ id: expect.any(String), status: 'active' });
      expect(response.data).not.toHaveProperty('permissions');
      expect(response.data).not.toHaveProperty('role');
    });
  });

  // -------------------------------------- temporary credential end-to-end --

  describe('PASSWORD_CHANGE_REQUIRED, end to end (§12)', () => {
    // A freshly provisioned account holds a temporary credential. This is the
    // state that breaks naive interceptors, so it is exercised for real:
    // provision, sign in, get 403, change the password, sign in again.
    const unique = Date.now();
    const email = `joiner${unique}@hoanglongti.com`;
    const temporaryPassword = 'temp pass 1';
    const chosenPassword = 'a properly long passphrase';

    let departmentId: string;

    beforeAll(async () => {
      const department = await boss.post('/departments', {
        slug: `probe-${unique}`,
        name: `Probe ${unique}`,
      });
      expect(department.status).toBe(201);
      departmentId = department.data.id;

      const created = await boss.post('/users', {
        displayName: 'New Joiner',
        email,
        initialPassword: temporaryPassword,
        departmentId,
      });
      expect(created.status).toBe(201);
      // The server derives the username; the client must never parse it (§0).
      expect(created.data.username).toBe(`joiner${unique}`);
    });

    it('signs in, then is refused by /authorization/me with a LIVE session', async () => {
      const joiner = makeClient();

      expect((await login(joiner, email, temporaryPassword)).status).toBe(200);

      const authorization = await joiner.get('/authorization/me');
      expect(authorization.status).toBe(403);
      expect(toApiError(authorization.status, authorization.data).code).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );

      // ★ The session is NOT over — this is what separates it from a 401 and
      // why treating the two alike locks the user out permanently.
      const identity = await joiner.get('/auth/me');
      expect(identity.status).toBe(200);
      expect(identity.data.displayName).toBe('New Joiner');
    });

    it('is refused from ordinary endpoints too, with the same code', async () => {
      const joiner = makeClient();
      await login(joiner, email, temporaryPassword);

      const departments = await joiner.get('/departments');
      expect(departments.status).toBe(403);
      expect(toApiError(departments.status, departments.data).code).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    });

    it('changing the password clears the state and kills every session (§1)', async () => {
      const joiner = makeClient();
      await login(joiner, email, temporaryPassword);

      const changed = await joiner.post('/auth/password', {
        currentPassword: temporaryPassword,
        newPassword: chosenPassword,
      });
      expect(changed.status).toBe(204);

      // The session that made the change is gone with the rest.
      const afterChange = await joiner.get('/authorization/me');
      expect(afterChange.status).toBe(401);

      // Signing in again with the NEW password now reaches a real session.
      const fresh = makeClient();
      expect((await login(fresh, email, chosenPassword)).status).toBe(200);

      const authorization = await fresh.get('/authorization/me');
      expect(authorization.status).toBe(200);
      expect(authorization.data.role).toBe('MEMBER');
      expect(authorization.data.departmentIds).toEqual([departmentId]);
    });

    it('the old temporary password no longer works', async () => {
      const stale = makeClient();
      const response = await login(stale, email, temporaryPassword);
      expect(response.status).toBe(401);
    });
  });

  // ------------------------------------------------------ 403 FORBIDDEN --

  describe('403 FORBIDDEN is not a session problem (§11)', () => {
    it('a MEMBER is refused a global route, with a session that still works', async () => {
      const unique = Date.now();
      const email = `member${unique}@hoanglongti.com`;

      const department = await boss.post('/departments', {
        slug: `plain-${unique}`,
        name: `Plain ${unique}`,
      });
      const created = await boss.post('/users', {
        displayName: 'Plain Member',
        email,
        initialPassword: 'temp pass 2',
        departmentId: department.data.id,
      });
      expect(created.status).toBe(201);

      const member = makeClient();
      await login(member, email, 'temp pass 2');
      await member.post('/auth/password', {
        currentPassword: 'temp pass 2',
        newPassword: 'another long passphrase',
      });

      const active = makeClient();
      await login(active, email, 'another long passphrase');

      // GLOBAL-only route (§5).
      const forbidden = await active.get('/departments');
      expect(forbidden.status).toBe(403);
      expect(toApiError(forbidden.status, forbidden.data).code).toBe('FORBIDDEN');

      // ★ Still signed in. Logging in again would not help, which is exactly
      // why this must not redirect to login.
      const stillFine = await active.get('/authorization/me');
      expect(stillFine.status).toBe(200);
      expect(stillFine.data.role).toBe('MEMBER');
    });
  });

  // ------------------------------------------------------------ conflict --

  describe('409 CONFLICT (§11)', () => {
    it('reports a duplicate slug as a conflict, not a validation error', async () => {
      const unique = Date.now();
      const body = { slug: `dup-${unique}`, name: 'Duplicate probe' };

      expect((await boss.post('/departments', body)).status).toBe(201);

      const second = await boss.post('/departments', body);
      expect(second.status).toBe(409);
      expect(toApiError(second.status, second.data).code).toBe('CONFLICT');
    });
  });

  // ------------------------------------------------------- error shapes --

  describe('both error shapes reach the client (§11)', () => {
    it('business errors carry { error: { code, message } }', async () => {
      const response = await boss.get('/departments/00000000-0000-4000-8000-000000000000');

      expect(response.status).toBe(404);
      expect(toApiError(response.status, response.data).code).toBe('NOT_FOUND');
    });

    it('framework errors carry a STRING `error`, and must not crash the parser', async () => {
      const response = await boss.get('/definitely-not-a-route');

      expect(response.status).toBe(404);
      expect(typeof response.data.error).toBe('string');

      const normalised = toApiError(response.status, response.data);
      expect(normalised.code).toBeUndefined();
      expect(normalised.message).toContain('Cannot GET');
    });

    it('a malformed identifier is 422, not 500', async () => {
      const response = await boss.get('/departments/not-a-uuid');

      expect(response.status).toBe(422);
      expect(toApiError(response.status, response.data).code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------- logout --

  describe('logout (§1)', () => {
    it('revokes server-side: the captured cookie stops working', async () => {
      const client = makeClient();
      await login(client, BOSS_EMAIL, BOSS_PASSWORD);
      const captured = client.cookie;

      expect((await client.post('/auth/logout')).status).toBe(204);

      // Replay the exact cookie the server issued.
      const replay = makeClient();
      replay.cookie = captured;
      expect((await replay.get('/authorization/me')).status).toBe(401);
    });
  });
});
