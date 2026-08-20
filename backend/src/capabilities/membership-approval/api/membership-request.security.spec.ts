import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import {
  HeadOfRouteDepartmentGuard,
  PermissionGuard,
} from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { MembershipRequestService } from '../application/membership-request.service';
import { MembershipRequestController } from './membership-request.controller';

/**
 * The approval workflow over HTTP.
 *
 * Two different guards protect the two halves, and that asymmetry IS the policy:
 * raising a request needs to be the head of the unit on the route, deciding one
 * needs global authority. A head therefore cannot decide anything — including
 * their own request — and no body can change that.
 *
 * The service is doubled: what the database does under approval is proven for
 * real in `application/membership-request.integration.spec.ts`. This file asks
 * only what an attacker can see and reach.
 */
describe('membership-request HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const TARGET = '44444444-4444-4444-4444-444444444444';
  const REQUEST_ID = '55555555-5555-5555-5555-555555555555';

  let app: INestApplication;
  let requests: {
    create: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    listForDepartment: jest.Mock;
    listPending: jest.Mock;
  };
  let context: AuthorizationContext;

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  const storedRequest = {
    id: REQUEST_ID,
    departmentId: A,
    targetDepartmentId: B,
    targetUserId: TARGET,
    action: 'TRANSFER_MEMBER',
    status: 'pending',
    requestedBy: ACTOR,
    requestedAt: new Date('2026-01-01'),
    decidedBy: null,
    decidedAt: null,
    reason: null,
  };

  beforeEach(async () => {
    context = asContext();
    requests = {
      create: jest.fn().mockResolvedValue(storedRequest),
      approve: jest.fn().mockResolvedValue({ ...storedRequest, status: 'approved' }),
      reject: jest.fn().mockResolvedValue({ ...storedRequest, status: 'rejected' }),
      listForDepartment: jest.fn().mockResolvedValue([storedRequest]),
      listPending: jest.fn().mockResolvedValue([storedRequest]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [MembershipRequestController],
      providers: [
        Reflector,
        PermissionGuard,
        HeadOfRouteDepartmentGuard,
        AuthGuard,
        CsrfGuard,
        { provide: MembershipRequestService, useValue: requests },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ id: ACTOR, displayName: 'Actor', status: 'active' }),
          },
        },
        {
          provide: AuthorizationService,
          useValue: { loadContext: jest.fn().mockImplementation(async () => context) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const authed = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  const transferBody = { userId: TARGET, action: 'TRANSFER_MEMBER', targetDepartmentId: B };

  // ------------------------------------------------------------ anonymous --

  describe('without authentication', () => {
    it.each([
      ['post', `/departments/${A}/membership-requests`],
      ['get', `/departments/${A}/membership-requests`],
      ['get', '/membership-requests'],
      ['post', `/membership-requests/${REQUEST_ID}/approve`],
      ['post', `/membership-requests/${REQUEST_ID}/reject`],
    ] as const)('refuses %s %s with 401', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(requests.create).not.toHaveBeenCalled();
      expect(requests.approve).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------- HEAD --

  describe('a department head', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('raises a transfer request for the department it leads', async () => {
      await authed('post', `/departments/${A}/membership-requests`)
        .send(transferBody)
        .expect(201);

      expect(requests.create).toHaveBeenCalledWith({
        routeDepartmentId: A,
        requestedBy: ACTOR,
        targetUserId: TARGET,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: B,
        reason: undefined,
      });
    });

    it('is refused the SAME route for a department it does not lead — IDOR', async () => {
      await authed('post', `/departments/${B}/membership-requests`)
        .send({ ...transferBody, targetDepartmentId: A })
        .expect(403);

      expect(requests.create).not.toHaveBeenCalled();
    });

    it('cannot read another department’s requests', async () => {
      await authed('get', `/departments/${A}/membership-requests`).expect(200);
      await authed('get', `/departments/${B}/membership-requests`).expect(403);

      expect(requests.listForDepartment).toHaveBeenCalledTimes(1);
      expect(requests.listForDepartment).toHaveBeenCalledWith(A, { limit: 50 });
    });

    it('cannot see the global decision queue', async () => {
      await authed('get', '/membership-requests').expect(403);
      expect(requests.listPending).not.toHaveBeenCalled();
    });

    it('cannot approve or reject anything — not even its own request', async () => {
      await authed('post', `/membership-requests/${REQUEST_ID}/approve`).expect(403);
      await authed('post', `/membership-requests/${REQUEST_ID}/reject`).expect(403);

      expect(requests.approve).not.toHaveBeenCalled();
      expect(requests.reject).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------- MEMBER --

  describe('a plain member', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [A] });
    });

    it('cannot raise a request, even in its own department', async () => {
      await authed('post', `/departments/${A}/membership-requests`)
        .send(transferBody)
        .expect(403);
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('cannot read requests, anywhere', async () => {
      const scoped = await authed('get', `/departments/${A}/membership-requests`);
      const queue = await authed('get', '/membership-requests');

      expect([scoped.status, queue.status]).toEqual([403, 403]);
      expect(requests.listForDepartment).not.toHaveBeenCalled();
      expect(requests.listPending).not.toHaveBeenCalled();
    });

    it('cannot decide', async () => {
      const response = await authed('post', `/membership-requests/${REQUEST_ID}/approve`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(requests.approve).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- SUPERADMIN --

  describe('a SuperAdmin', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('reads every queue, including departments it has no membership in', async () => {
      const queue = await authed('get', '/membership-requests');
      const scoped = await authed('get', `/departments/${B}/membership-requests`);

      expect([queue.status, scoped.status]).toEqual([200, 200]);
      expect(requests.listPending).toHaveBeenCalled();
      // B is a department this caller has no membership of — GLOBAL is not
      // scoped, so no membership is consulted.
      expect(requests.listForDepartment).toHaveBeenCalledWith(B, { limit: 50 });
    });

    it('approves and rejects', async () => {
      await authed('post', `/membership-requests/${REQUEST_ID}/approve`).expect(200);
      await authed('post', `/membership-requests/${REQUEST_ID}/reject`).expect(200);

      expect(requests.approve).toHaveBeenCalledWith({ requestId: REQUEST_ID, decidedBy: ACTOR });
      expect(requests.reject).toHaveBeenCalledWith({ requestId: REQUEST_ID, decidedBy: ACTOR });
    });

    it('is never forced through the approval workflow — the direct path exists', async () => {
      // A global caller may raise a request (the guard allows it), but nothing
      // requires it: `POST /departments/:id/members` and
      // `PATCH /users/:id/status` are their direct paths, guarded by
      // `unit.member.write` and `user.write` respectively. Those are asserted in
      // the organization and users security specs; what matters here is that
      // this capability does not gate them.
      const response = await authed('post', `/departments/${A}/membership-requests`)
        .send(transferBody);

      expect(response.status).toBe(201);
      expect(requests.create).toHaveBeenCalledWith(
        expect.objectContaining({ requestedBy: ACTOR, routeDepartmentId: A }),
      );
    });
  });

  // -------------------------------------------------------------- spoofing --

  describe('a client that lies in the request body', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('cannot grant itself authority through the body', async () => {
      await authed('post', `/departments/${A}/membership-requests`)
        .send({ ...transferBody, role: 'SUPERADMIN', global: true, permissions: ['role.assign'] })
        .expect(201);

      // The extra fields are stripped by the schema and never reach the service.
      expect(requests.create).toHaveBeenCalledWith({
        routeDepartmentId: A,
        requestedBy: ACTOR,
        targetUserId: TARGET,
        action: 'TRANSFER_MEMBER',
        targetDepartmentId: B,
        reason: undefined,
      });
    });

    it('cannot widen its scope by naming another department in the body', async () => {
      await authed('post', `/departments/${A}/membership-requests`)
        .send({ ...transferBody, departmentId: B, sourceDepartmentId: B, scope: 'GLOBAL' })
        .expect(201);

      // The route decided the scope; the body's `departmentId` was ignored.
      expect(requests.create.mock.calls[0][0].routeDepartmentId).toBe(A);
      expect(requests.create.mock.calls[0][0]).not.toHaveProperty('departmentId');
      expect(requests.create.mock.calls[0][0]).not.toHaveProperty('sourceDepartmentId');
    });

    it('cannot name the requester — the session decides who is acting', async () => {
      const someoneElse = '99999999-9999-9999-9999-999999999999';
      await authed('post', `/departments/${A}/membership-requests`)
        .send({ ...transferBody, requestedBy: someoneElse })
        .expect(201);

      expect(requests.create.mock.calls[0][0].requestedBy).toBe(ACTOR);
    });

    it('rejects an unknown action rather than guessing', async () => {
      await authed('post', `/departments/${A}/membership-requests`)
        .send({ ...transferBody, action: 'ADD_MEMBER' })
        .expect(422);

      expect(requests.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------- lifecycle contract --

  describe('lifecycle conflicts reach the client as 409', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    const conflict = (message: string) => {
      const { ConflictError } = jest.requireActual<
        typeof import('../../../common/errors/domain.error')
      >('../../../common/errors/domain.error');
      return new ConflictError(message);
    };

    it('maps a duplicate pending request to 409', async () => {
      requests.create.mockRejectedValue(conflict('An identical request is already awaiting a decision.'));
      context = asContext({ headOf: [A], memberOf: [A] });

      const response = await authed('post', `/departments/${A}/membership-requests`)
        .send(transferBody);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps a second approval to 409', async () => {
      requests.approve.mockRejectedValue(conflict('That request is not awaiting a decision.'));

      const response = await authed('post', `/membership-requests/${REQUEST_ID}/approve`);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps a second rejection to 409', async () => {
      requests.reject.mockRejectedValue(conflict('That request is not awaiting a decision.'));

      const response = await authed('post', `/membership-requests/${REQUEST_ID}/reject`);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps a self-decision to 409, deterministically', async () => {
      requests.approve.mockRejectedValue(conflict('You cannot decide your own request.'));

      const response = await authed('post', `/membership-requests/${REQUEST_ID}/approve`);

      // 409 rather than 403: the caller HAS the permission to decide, and it is
      // this particular request they may not decide. The database CHECK says
      // the same thing independently.
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps a request gone stale to 409', async () => {
      requests.approve.mockRejectedValue(
        conflict('That user has moved department since this request was raised.'),
      );

      const response = await authed('post', `/membership-requests/${REQUEST_ID}/approve`);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  // ------------------------------------------------ temporary credential --

  describe('a caller whose temporary credential is unchanged', () => {
    beforeEach(() => {
      context = asContext({ global: true, headOf: [A], memberOf: [A], mustChangeSecret: true });
    });

    it('is refused every route here, despite holding global authority', async () => {
      await authed('post', `/departments/${A}/membership-requests`).send(transferBody).expect(403);
      await authed('get', `/departments/${A}/membership-requests`).expect(403);
      await authed('get', '/membership-requests').expect(403);
      await authed('post', `/membership-requests/${REQUEST_ID}/approve`).expect(403);

      expect(requests.create).not.toHaveBeenCalled();
      expect(requests.approve).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ CSRF --

  describe('CSRF', () => {
    beforeEach(() => {
      context = asContext({ global: true, headOf: [A], memberOf: [A] });
    });

    it('refuses every mutation without the header', async () => {
      const withoutHeader = (path: string) =>
        request(app.getHttpServer()).post(path).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

      await withoutHeader(`/departments/${A}/membership-requests`).send(transferBody).expect(403);
      await withoutHeader(`/membership-requests/${REQUEST_ID}/approve`).expect(403);
      await withoutHeader(`/membership-requests/${REQUEST_ID}/reject`).expect(403);

      expect(requests.create).not.toHaveBeenCalled();
      expect(requests.approve).not.toHaveBeenCalled();
    });

    it('allows a GET without it — reads are not state changes', async () => {
      const response = await request(app.getHttpServer())
        .get('/membership-requests')
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

      expect(response.status).toBe(200);
      expect(requests.listPending).toHaveBeenCalled();
    });
  });
  // ------------------------------------------------- malformed identifier --

  /**
   * A route parameter that is not a UUID used to reach PostgreSQL, which
   * rejected the cast (SQLSTATE 22P02) as an error the filter does not map —
   * so the caller got a bare 500. Guards do not catch it: they compare the
   * value as a string and an authorized caller passes them.
   *
   * 422 with the same shape a malformed BODY already produces, and the service
   * must not be reached at all.
   */
  describe('malformed identifier in the path', () => {
    // A caller the guards ADMIT: they compare the parameter as a string, so a
    // scoped caller is refused 403 before the pipe runs and never saw the 500.
    // Only a caller authorized for the route reached PostgreSQL with it.
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it.each([
      ['get', '/departments/not-a-uuid/membership-requests'],
      ['post', '/departments/not-a-uuid/membership-requests'],
      ['post', '/membership-requests/not-a-uuid/approve'],
      ['post', '/membership-requests/not-a-uuid/reject'],
    ] as const)(
      'answers 422 for %s %s, without reaching the service',
      async (method, path) => {
        await authed(method, path).expect(422);
        expect(requests.approve).not.toHaveBeenCalled();
      },
    );
  });
});
