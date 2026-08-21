import axios, { AxiosHeaders, type AxiosInstance } from 'axios';
import { beforeAll, describe, expect, it } from 'vitest';
import { toApiError } from '@/utils/errors';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './client';

/**
 * The WRITE half of the approval workflow, against a REAL backend and a REAL
 * PostgreSQL.
 *
 * The two integration specs beside this one cover reads. Everything that
 * changes state — raising an invitation, approving it into an account,
 * deciding a membership request — was covered only by `mutations.spec.ts`,
 * which mocks the transport. A mock cannot answer the questions that matter
 * here, and two of them are the whole point of the feature:
 *
 *   does the generated temporary password ACTUALLY sign the new person in, and
 *   is it really unreadable afterwards (§13)?
 *
 * A stub returns whatever string the author typed, so it agrees either way.
 *
 * Nothing is mocked. Requires a running backend (API_BASE_URL, default
 * http://localhost:3000) and a bootstrapped SuperAdmin.
 */

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const BOSS_EMAIL = process.env.BOSS_EMAIL ?? 'boss@hoanglongti.com';
const BOSS_PASSWORD = process.env.BOSS_PASSWORD ?? 'correct horse battery staple';

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

describe('approval write paths (§9, §10, §13)', () => {
  const unique = Date.now();

  let boss: Client;
  let departmentA: string;
  let departmentB: string;

  let headOfA: Client;
  let headOfB: Client;
  /** An ordinary member of A, and the subject of the transfer requests below. */
  let memberOfA: Client;
  let memberOfAId: string;

  /** Provisions an account, clears its temporary credential, returns a client. */
  const provision = async (email: string, departmentId: string, displayName: string) => {
    const temporary = 'temp pass 1';
    const chosen = 'a properly long passphrase';

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
    const health = await axios.get(`${BASE_URL}/health`, { validateStatus: () => true });
    if (health.status !== 200) {
      throw new Error(`No backend at ${BASE_URL} (health ${health.status}).`);
    }

    boss = makeClient();
    if ((await login(boss, BOSS_EMAIL, BOSS_PASSWORD)).status !== 200) {
      throw new Error(`Could not sign in as ${BOSS_EMAIL}. Bootstrap a SuperAdmin first.`);
    }

    const a = await boss.post('/departments', { slug: `wr-a-${unique}`, name: `Write A ${unique}` });
    const b = await boss.post('/departments', { slug: `wr-b-${unique}`, name: `Write B ${unique}` });
    expect([a.status, b.status]).toEqual([201, 201]);
    departmentA = a.data.id;
    departmentB = b.data.id;

    const head = await provision(`wr-head-a-${unique}@hoanglongti.com`, departmentA, 'Head of A');
    const other = await provision(`wr-head-b-${unique}@hoanglongti.com`, departmentB, 'Head of B');
    const member = await provision(`wr-mem-a-${unique}@hoanglongti.com`, departmentA, 'Member of A');

    headOfA = head.client;
    headOfB = other.client;
    memberOfA = member.client;
    memberOfAId = member.userId;

    expect(
      (await boss.post(`/departments/${departmentA}/head`, { userId: head.userId })).status,
    ).toBe(201);
    expect(
      (await boss.post(`/departments/${departmentB}/head`, { userId: other.userId })).status,
    ).toBe(201);
  });

  // ------------------------------------------- raising an invitation (§9) --

  describe('POST /departments/:departmentId/account-invitations (§9)', () => {
    it('a HEAD invites into their OWN department — 201, pending, nobody decided yet', async () => {
      const response = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `invitee-ok-${unique}@hoanglongti.com`,
      });

      expect(response.status).toBe(201);
      expect(response.data).toMatchObject({
        id: expect.any(String),
        departmentId: departmentA,
        email: `invitee-ok-${unique}@hoanglongti.com`,
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
      });
    });

    it('★ EMAIL ONLY — no password reaches the server, and none comes back', async () => {
      const response = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `invitee-bare-${unique}@hoanglongti.com`,
      });

      expect(response.status).toBe(201);
      // The secret is generated at approval and exists nowhere before it (§13).
      expect(JSON.stringify(response.data)).not.toMatch(/password/i);
    });

    it('the HEAD of B is REFUSED department A — scope is the route (§15)', async () => {
      const response = await headOfB.post(`/departments/${departmentA}/account-invitations`, {
        email: `invitee-cross-${unique}@hoanglongti.com`,
      });

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('an ordinary MEMBER cannot invite at all', async () => {
      const response = await memberOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `invitee-member-${unique}@hoanglongti.com`,
      });

      expect(response.status).toBe(403);
    });

    // ------------------------------------------- company email policy (§9) --

    it('★ REFUSES AN EMAIL OUTSIDE THE COMPANY DOMAIN — 422, at the server', async () => {
      // The form checks this too, but the form is not the enforcement. Anything
      // that can reach the API can skip the form.
      const response = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `outsider-${unique}@gmail.com`,
      });

      expect(response.status).toBe(422);
      expect(toApiError(response.status, response.data).code).toBe('VALIDATION_FAILED');
    });

    it('refuses an address with no domain at all', async () => {
      const response = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `hlt${unique}`,
      });

      expect(response.status).toBe(422);
    });
  });

  // ------------------------------------------ deciding an invitation (§13) --

  describe('POST /account-invitations/:id/approve (§13)', () => {
    /** Raised fresh per test: an invitation can be decided exactly once. */
    const raise = async (localPart: string) => {
      const created = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `${localPart}-${unique}@hoanglongti.com`,
      });
      expect(created.status).toBe(201);
      return { id: created.data.id as string, email: created.data.email as string };
    };

    it('★ the HEAD who raised it may NOT approve it — proposes, never decides', async () => {
      const invitation = await raise('dec-head');

      const response = await headOfA.post(`/account-invitations/${invitation.id}/approve`, {});

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('GLOBAL approves — 201, because it CREATED an account', async () => {
      const invitation = await raise('dec-ok');

      const response = await boss.post(`/account-invitations/${invitation.id}/approve`, {
        displayName: 'Approved Joiner',
      });

      expect(response.status).toBe(201);
      expect(response.data.invitation).toMatchObject({
        id: invitation.id,
        status: 'approved',
        decidedBy: expect.any(String),
      });
      // Derived by the server from the local part — never parsed by the client.
      expect(response.data.username).toBe(`dec-ok-${unique}`);
      expect(typeof response.data.temporaryPassword).toBe('string');
    });

    it('a body-less approve is legal — the approver names nothing', async () => {
      const invitation = await raise('dec-bare');

      const response = await boss.post(`/account-invitations/${invitation.id}/approve`, {});

      expect(response.status).toBe(201);
      expect(response.data.invitation.status).toBe('approved');
    });

    it('★ THE TEMPORARY PASSWORD REALLY WORKS, and lands in the right department', async () => {
      const invitation = await raise('dec-live');

      const approved = await boss.post(`/account-invitations/${invitation.id}/approve`, {
        displayName: 'Live Joiner',
      });
      expect(approved.status).toBe(201);

      // ★ The claim a mock cannot make. This is the credential the approver
      // reads off the screen and hands over, so it has to sign somebody in.
      const joiner = makeClient();
      expect((await login(joiner, invitation.email, approved.data.temporaryPassword)).status).toBe(
        200,
      );

      // …and it is temporary, so it is refused everything until it is replaced.
      const authorization = await joiner.get('/authorization/me');
      expect(authorization.status).toBe(403);
      expect(toApiError(authorization.status, authorization.data).code).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );

      const chosen = 'yet another long passphrase';
      expect(
        (
          await joiner.post('/auth/password', {
            currentPassword: approved.data.temporaryPassword,
            newPassword: chosen,
          })
        ).status,
      ).toBe(204);

      const settled = makeClient();
      expect((await login(settled, invitation.email, chosen)).status).toBe(200);
      const me = await settled.get('/authorization/me');
      expect(me.status).toBe(200);
      expect(me.data.role).toBe('MEMBER');
      expect(me.data.departmentIds).toEqual([departmentA]);
    });

    it('★ AND IS NEVER READABLE AGAIN — not from the row, not from the queue', async () => {
      const invitation = await raise('dec-once');

      const approved = await boss.post(`/account-invitations/${invitation.id}/approve`, {});
      expect(approved.status).toBe(201);
      const secret = approved.data.temporaryPassword as string;

      // The department queue is where the FE renders these rows.
      const listed = await boss.get(`/departments/${departmentA}/account-invitations`, {
        params: { limit: 200 },
      });
      expect(listed.status).toBe(200);
      expect(JSON.stringify(listed.data)).not.toContain(secret);

      // And re-approving is a conflict, so there is no second copy that way.
      const again = await boss.post(`/account-invitations/${invitation.id}/approve`, {});
      expect(again.status).toBe(409);
      expect(toApiError(again.status, again.data).code).toBe('CONFLICT');
    });

    it('rejecting closes it — 200, because nothing was created', async () => {
      const invitation = await raise('dec-no');

      const response = await boss.post(`/account-invitations/${invitation.id}/reject`, {});

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({ id: invitation.id, status: 'rejected' });
    });

    it('a rejected invitation cannot then be approved — 409', async () => {
      const invitation = await raise('dec-flip');

      expect((await boss.post(`/account-invitations/${invitation.id}/reject`, {})).status).toBe(200);

      const response = await boss.post(`/account-invitations/${invitation.id}/approve`, {});
      expect(response.status).toBe(409);
    });

    it('★ THE REJECTION `reason` IS NOT STORED — the client sends one, the API drops it', async () => {
      // `rejectAccountInvitation(id, reason)` posts `{ reason }`, and the screen
      // collects it in a textarea. The endpoint reads no body at all, and the
      // `reason` column belongs to whoever RAISED the invitation. So the request
      // succeeds and the text is silently discarded — recorded here because that
      // is what the API does, not because it is what the UI should promise.
      const invitation = await raise('dec-reason');

      const response = await boss.post(`/account-invitations/${invitation.id}/reject`, {
        reason: 'not joining after all',
      });

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('rejected');
      expect(response.data.reason).toBeNull();
    });
  });

  // ------------------------------- deciding a membership request (§10) --

  describe('membership requests, raised and decided (§10)', () => {
    const raiseTransfer = async () => {
      const created = await headOfA.post(`/departments/${departmentA}/membership-requests`, {
        userId: memberOfAId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: departmentB,
        reason: 'needed on the other team',
      });
      expect(created.status).toBe(201);
      return created.data.id as string;
    };

    it('a HEAD raises a transfer out of their own unit — 201, pending', async () => {
      const created = await headOfA.post(`/departments/${departmentA}/membership-requests`, {
        userId: memberOfAId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: departmentB,
      });

      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        departmentId: departmentA,
        targetUserId: memberOfAId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: departmentB,
        status: 'pending',
      });

      // Clean up: a pending request would block the ones raised below.
      expect((await boss.post(`/membership-requests/${created.data.id}/reject`)).status).toBe(200);
    });

    it('a transfer that names no destination is 409, NOT 422', async () => {
      // `targetDepartmentId` is optional in the schema on purpose — an
      // offboarding must not carry one — so "a transfer needs a destination" is
      // a business rule the service checks, and business rules answer CONFLICT.
      // Worth pinning: a client that branches on 422 to highlight a form field
      // would never highlight this one.
      const response = await headOfA.post(`/departments/${departmentA}/membership-requests`, {
        userId: memberOfAId,
        action: 'TRANSFER_MEMBER',
      });

      expect(response.status).toBe(409);
      expect(toApiError(response.status, response.data).code).toBe('CONFLICT');
    });

    it('★ the HEAD who raised it may NOT decide it', async () => {
      const requestId = await raiseTransfer();

      const response = await headOfA.post(`/membership-requests/${requestId}/approve`);
      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');

      expect((await boss.post(`/membership-requests/${requestId}/reject`)).status).toBe(200);
    });

    it('GLOBAL rejects — 200, and the `reason` body is dropped here too', async () => {
      const requestId = await raiseTransfer();

      const response = await boss.post(`/membership-requests/${requestId}/reject`, {
        reason: 'declined',
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({ id: requestId, status: 'rejected' });
      // The stored reason is the REQUESTER's, unchanged by the decision.
      expect(response.data.reason).toBe('needed on the other team');
    });

    it('★ GLOBAL approves, and the person ACTUALLY MOVES', async () => {
      const requestId = await raiseTransfer();

      const response = await boss.post(`/membership-requests/${requestId}/approve`);
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({ id: requestId, status: 'approved' });

      // The claim worth making over real HTTP: the decision changed the world,
      // not just the row. The moved member reads their own new department.
      const me = await memberOfA.get('/authorization/me');
      expect(me.status).toBe(200);
      expect(me.data.departmentIds).toEqual([departmentB]);
    });

    it('deciding it a second time is 409, not a silent no-op', async () => {
      // Provisioned HERE, into B, rather than reusing the member the transfer
      // test moves into B. A test that passes only because an earlier one ran
      // reports the wrong thing the day somebody runs it on its own.
      const leaver = await provision(
        `wr-leaver-b-${unique}@hoanglongti.com`,
        departmentB,
        'Leaver of B',
      );

      const created = await headOfB.post(`/departments/${departmentB}/membership-requests`, {
        userId: leaver.userId,
        action: 'REMOVE_MEMBER',
      });
      expect(created.status).toBe(201);

      expect((await boss.post(`/membership-requests/${created.data.id}/reject`)).status).toBe(200);

      const again = await boss.post(`/membership-requests/${created.data.id}/reject`);
      expect(again.status).toBe(409);
      expect(toApiError(again.status, again.data).code).toBe('CONFLICT');
    });
  });

  // ------------------- the proposer is never the decider (§9, §10, §13) --

  describe('★ every proposal has somebody who can decide it (§9, §10)', () => {
    /**
     * The invariant, end to end.
     *
     * Deciding is GLOBAL-only and both services refuse `requestedBy ===
     * decidedBy`, and `uq_single_active_superadmin` allows exactly one active
     * global administrator. So a proposal raised BY that administrator would
     * have no actor left in the deployment who could approve or reject it — it
     * would sit pending forever, and the duplicate check would then refuse the
     * address to everybody else too.
     *
     * The route therefore refuses them, and these ask the real server whether
     * it does.
     */
    it('a SUPERADMIN cannot raise an account invitation — 403, not a stuck row', async () => {
      const response = await boss.post(`/departments/${departmentA}/account-invitations`, {
        email: `ceo-raised-${unique}@hoanglongti.com`,
      });

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
      // The refusal names the way out, because the caller is not
      // under-privileged — they are the wrong actor for this route.
      expect(response.data.error.message).toMatch(/direct route/i);
    });

    it('a SUPERADMIN cannot raise a membership request either — same reason', async () => {
      const response = await boss.post(`/departments/${departmentA}/membership-requests`, {
        userId: memberOfAId,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: departmentB,
      });

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('★ and the refusal costs them nothing — POST /users still creates outright', async () => {
      // This is what makes the two refusals above correct rather than merely
      // safe: the SUPERADMIN never needed the proposal route. They create the
      // account directly, with no proposal and nothing left to decide.
      const email = `ceo-direct-${unique}@hoanglongti.com`;
      const created = await boss.post('/users', {
        displayName: 'Hired Directly',
        email,
        initialPassword: 'temp pass 1',
        departmentId: departmentA,
      });

      expect(created.status).toBe(201);
      expect(created.data.id).toEqual(expect.any(String));

      // And no invitation was involved, so nothing is waiting on anybody.
      const queue = await boss.get('/account-invitations', { params: { limit: 200 } });
      expect(queue.status).toBe(200);
      expect(queue.data.items.some((row: { email: string }) => row.email === email)).toBe(false);
    });

    it('a HEAD raises it instead, and the SUPERADMIN can then decide — the loop closes', async () => {
      const raised = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
        email: `loop-closes-${unique}@hoanglongti.com`,
      });
      expect(raised.status).toBe(201);

      // Different actors, which is the whole invariant.
      expect(raised.data.requestedBy).not.toBeNull();

      const decided = await boss.post(`/account-invitations/${raised.data.id}/reject`, {});
      expect(decided.status).toBe(200);
      expect(decided.data.status).toBe('rejected');
      expect(decided.data.decidedBy).not.toBe(raised.data.requestedBy);
    });
  });

  // ------------------------------------------------ cursor pagination (§8) --

  describe('cursor pagination on a real list (§8)', () => {
    // Two rows minimum, seeded here: "there is a next page" and "the next page
    // is not the first one again" are both claims about a list with something
    // in it. The tests above happen to leave enough behind, but depending on
    // that makes this block's result a function of what ran before it.
    beforeAll(async () => {
      for (const localPart of ['page-one', 'page-two']) {
        const created = await headOfA.post(`/departments/${departmentA}/account-invitations`, {
          email: `${localPart}-${unique}@hoanglongti.com`,
        });
        expect(created.status).toBe(201);
      }
    });

    it('★ KEYSET, NOT OFFSET — a page carries an opaque cursor and no total', async () => {
      const response = await boss.get(`/departments/${departmentA}/account-invitations`, {
        params: { limit: 1 },
      });

      expect(response.status).toBe(200);
      expect(response.data.items).toHaveLength(1);
      expect(response.data.hasMore).toBe(true);
      expect(typeof response.data.nextCursor).toBe('string');

      // There is deliberately no count to render "page 7 of 41" from.
      expect(response.data).not.toHaveProperty('total');
      expect(response.data).not.toHaveProperty('totalPages');
      expect(response.data).not.toHaveProperty('totalItems');
    });

    it('the cursor advances — the second page is not the first again', async () => {
      const first = await boss.get(`/departments/${departmentA}/account-invitations`, {
        params: { limit: 1 },
      });
      expect(first.status).toBe(200);

      const second = await boss.get(`/departments/${departmentA}/account-invitations`, {
        params: { limit: 1, cursor: first.data.nextCursor },
      });

      expect(second.status).toBe(200);
      expect(second.data.items).toHaveLength(1);
      expect(second.data.items[0].id).not.toBe(first.data.items[0].id);
    });

    it('a malformed cursor is 422 — not a silent restart at page one', async () => {
      const response = await boss.get(`/departments/${departmentA}/account-invitations`, {
        params: { limit: 1, cursor: 'not-a-real-cursor' },
      });

      expect(response.status).toBe(422);
      expect(toApiError(response.status, response.data).code).toBe('VALIDATION_FAILED');
    });

    it('a limit above the maximum is refused rather than quietly clamped', async () => {
      const response = await boss.get(`/departments/${departmentA}/account-invitations`, {
        params: { limit: 5000 },
      });

      expect(response.status).toBe(422);
    });
  });
});
