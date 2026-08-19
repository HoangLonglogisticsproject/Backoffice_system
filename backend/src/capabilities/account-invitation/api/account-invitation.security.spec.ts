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
import { AccountInvitationService } from '../application/account-invitation.service';
import { AccountInvitationController } from './account-invitation.controller';

/**
 * Onboarding over HTTP.
 *
 * Inviting is scoped to the unit on the route; deciding needs `user.write`,
 * because approving an invitation CREATES AN ACCOUNT. A head can therefore start
 * the process and never finish it, which is the entire policy.
 *
 * The other thing asserted here is where the generated password may appear: in
 * the approve response, and in no other response this API produces.
 */
describe('account-invitation HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const CREATED = '44444444-4444-4444-4444-444444444444';
  const INVITATION_ID = '55555555-5555-5555-5555-555555555555';
  const TEMPORARY = 'a-generated-temporary-secret';

  let app: INestApplication;
  let invitations: {
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

  const storedInvitation = {
    id: INVITATION_ID,
    departmentId: A,
    email: 'newcomer@example.com',
    status: 'pending',
    requestedBy: ACTOR,
    requestedAt: new Date('2026-01-01'),
    decidedBy: null,
    decidedAt: null,
    reason: null,
    createdUserId: null,
  };

  beforeEach(async () => {
    context = asContext();
    invitations = {
      create: jest.fn().mockResolvedValue(storedInvitation),
      approve: jest.fn().mockResolvedValue({
        invitation: { ...storedInvitation, status: 'approved', createdUserId: CREATED },
        username: 'newcomer',
        temporaryPassword: TEMPORARY,
      }),
      reject: jest.fn().mockResolvedValue({ ...storedInvitation, status: 'rejected' }),
      listForDepartment: jest.fn().mockResolvedValue([storedInvitation]),
      listPending: jest.fn().mockResolvedValue([storedInvitation]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AccountInvitationController],
      providers: [
        Reflector,
        PermissionGuard,
        HeadOfRouteDepartmentGuard,
        AuthGuard,
        CsrfGuard,
        { provide: AccountInvitationService, useValue: invitations },
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

  const inviteBody = { email: 'newcomer@example.com' };

  // ------------------------------------------------------------ anonymous --

  describe('without authentication', () => {
    it.each([
      ['post', `/departments/${A}/account-invitations`],
      ['get', `/departments/${A}/account-invitations`],
      ['get', '/account-invitations'],
      ['post', `/account-invitations/${INVITATION_ID}/approve`],
      ['post', `/account-invitations/${INVITATION_ID}/reject`],
    ] as const)('refuses %s %s with 401', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(invitations.create).not.toHaveBeenCalled();
      expect(invitations.approve).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------- HEAD --

  describe('a department head', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('invites into the department it leads', async () => {
      await authed('post', `/departments/${A}/account-invitations`)
        .send(inviteBody)
        .expect(201);

      expect(invitations.create).toHaveBeenCalledWith({
        departmentId: A,
        requestedBy: ACTOR,
        email: 'newcomer@example.com',
        reason: undefined,
      });
    });

    it('cannot invite into another department — IDOR', async () => {
      await authed('post', `/departments/${B}/account-invitations`)
        .send(inviteBody)
        .expect(403);
      expect(invitations.create).not.toHaveBeenCalled();
    });

    it('cannot read another department’s invitations', async () => {
      await authed('get', `/departments/${A}/account-invitations`).expect(200);
      await authed('get', `/departments/${B}/account-invitations`).expect(403);

      expect(invitations.listForDepartment).toHaveBeenCalledTimes(1);
      expect(invitations.listForDepartment).toHaveBeenCalledWith(A);
    });

    it('cannot see the global decision queue', async () => {
      await authed('get', '/account-invitations').expect(403);
      expect(invitations.listPending).not.toHaveBeenCalled();
    });

    it('cannot approve or reject — approving would create an account', async () => {
      await authed('post', `/account-invitations/${INVITATION_ID}/approve`).expect(403);
      await authed('post', `/account-invitations/${INVITATION_ID}/reject`).expect(403);

      expect(invitations.approve).not.toHaveBeenCalled();
      expect(invitations.reject).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------- MEMBER --

  describe('a plain member', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [A] });
    });

    it('cannot invite, read or decide', async () => {
      await authed('post', `/departments/${A}/account-invitations`).send(inviteBody).expect(403);
      await authed('get', `/departments/${A}/account-invitations`).expect(403);
      await authed('get', '/account-invitations').expect(403);
      await authed('post', `/account-invitations/${INVITATION_ID}/approve`).expect(403);

      expect(invitations.create).not.toHaveBeenCalled();
      expect(invitations.approve).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- SUPERADMIN --

  describe('a SuperAdmin', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('reads every queue', async () => {
      const queue = await authed('get', '/account-invitations');
      const scoped = await authed('get', `/departments/${B}/account-invitations`);

      expect([queue.status, scoped.status]).toEqual([200, 200]);
      expect(invitations.listPending).toHaveBeenCalled();
      // B is a department this caller neither leads nor belongs to.
      expect(invitations.listForDepartment).toHaveBeenCalledWith(B);
    });

    it('approves, and receives the temporary password exactly here', async () => {
      const response = await authed(
        'post',
        `/account-invitations/${INVITATION_ID}/approve`,
      ).expect(201);

      expect(response.body.temporaryPassword).toBe(TEMPORARY);
      expect(response.body.username).toBe('newcomer');
      expect(response.body.invitation.createdUserId).toBe(CREATED);
    });

    it('rejects', async () => {
      const response = await authed(
        'post',
        `/account-invitations/${INVITATION_ID}/reject`,
      ).expect(200);

      expect(response.body.status).toBe('rejected');
      expect(response.body.createdUserId).toBeNull();
    });
  });

  // ------------------------------------------------- the temporary secret --

  describe('the generated password appears in exactly one response', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('is absent from both list endpoints', async () => {
      const scoped = await authed('get', `/departments/${A}/account-invitations`).expect(200);
      const queue = await authed('get', '/account-invitations').expect(200);

      for (const body of [scoped.body, queue.body]) {
        const serialised = JSON.stringify(body).toLowerCase();
        expect(serialised).not.toContain('password');
        expect(serialised).not.toContain('secret');
        expect(serialised).not.toContain(TEMPORARY.toLowerCase());
      }
    });

    it('is absent from the reject response', async () => {
      const response = await authed(
        'post',
        `/account-invitations/${INVITATION_ID}/reject`,
      ).expect(200);

      expect(JSON.stringify(response.body)).not.toContain(TEMPORARY);
    });

    it('cannot be fetched again by approving twice', async () => {
      const { ConflictError } = jest.requireActual<
        typeof import('../../../common/errors/domain.error')
      >('../../../common/errors/domain.error');
      invitations.approve.mockRejectedValue(
        new ConflictError('That invitation is not awaiting a decision.'),
      );

      const response = await authed(
        'post',
        `/account-invitations/${INVITATION_ID}/approve`,
      ).expect(409);

      expect(JSON.stringify(response.body)).not.toContain(TEMPORARY);
    });
  });

  // -------------------------------------------------------------- spoofing --

  describe('a client that lies in the request body', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('cannot override the route scope from the body', async () => {
      await authed('post', `/departments/${A}/account-invitations`)
        .send({ ...inviteBody, departmentId: B, scope: 'GLOBAL' })
        .expect(201);

      expect(invitations.create.mock.calls[0][0].departmentId).toBe(A);
    });

    it('cannot grant the invitee a role or a permission', async () => {
      await authed('post', `/departments/${A}/account-invitations`)
        .send({ ...inviteBody, role: 'SUPERADMIN', permissions: ['role.assign'] })
        .expect(201);

      expect(invitations.create).toHaveBeenCalledWith({
        departmentId: A,
        requestedBy: ACTOR,
        email: 'newcomer@example.com',
        reason: undefined,
      });
    });

    it('cannot choose the invitee’s password', async () => {
      await authed('post', `/departments/${A}/account-invitations`)
        .send({ ...inviteBody, initialPassword: 'chosen by the head', temporaryPassword: 'x' })
        .expect(201);

      const passed = JSON.stringify(invitations.create.mock.calls[0][0]);
      expect(passed).not.toContain('chosen by the head');
    });

    it('cannot name the requester', async () => {
      await authed('post', `/departments/${A}/account-invitations`)
        .send({ ...inviteBody, requestedBy: '99999999-9999-9999-9999-999999999999' })
        .expect(201);

      expect(invitations.create.mock.calls[0][0].requestedBy).toBe(ACTOR);
    });

    it('cannot swap the address at decision time — approve takes no email', async () => {
      context = asContext({ global: true });

      await authed('post', `/account-invitations/${INVITATION_ID}/approve`)
        .send({ email: 'attacker@example.com', departmentId: B })
        .expect(201);

      expect(invitations.approve).toHaveBeenCalledWith({
        invitationId: INVITATION_ID,
        decidedBy: ACTOR,
        displayName: undefined,
      });
    });
  });

  // ---------------------------------------------------- lifecycle contract --

  describe('lifecycle conflicts reach the client as 409', () => {
    const conflict = (message: string) => {
      const { ConflictError } = jest.requireActual<
        typeof import('../../../common/errors/domain.error')
      >('../../../common/errors/domain.error');
      return new ConflictError(message);
    };

    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('maps a duplicate pending invitation to 409', async () => {
      invitations.create.mockRejectedValue(
        conflict('That email already has an invitation awaiting a decision.'),
      );

      const response = await authed('post', `/departments/${A}/account-invitations`)
        .send(inviteBody);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps an address that already has an account to 409', async () => {
      invitations.create.mockRejectedValue(conflict('That email already has an account.'));

      const response = await authed('post', `/departments/${A}/account-invitations`)
        .send(inviteBody);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps a domain outside the allowlist to 422', async () => {
      const { ValidationError } = jest.requireActual<
        typeof import('../../../common/errors/domain.error')
      >('../../../common/errors/domain.error');
      invitations.create.mockRejectedValue(
        new ValidationError('That email domain is not permitted for this deployment.'),
      );

      const response = await authed('post', `/departments/${A}/account-invitations`)
        .send(inviteBody);

      // 422 rather than 409: the address is refusable on its own terms, so the
      // client can correct the field and resend rather than reload and retry.
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      // The allowlist itself is never echoed back — that would hand out the
      // deployment's shape for free.
      expect(JSON.stringify(response.body)).not.toContain('example.com');
    });

    it('rejects a malformed address before the service is reached', async () => {
      await authed('post', `/departments/${A}/account-invitations`)
        .send({ email: 'no' })
        .expect(422);

      expect(invitations.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------ temporary credential --

  describe('a caller whose temporary credential is unchanged', () => {
    beforeEach(() => {
      context = asContext({ global: true, headOf: [A], memberOf: [A], mustChangeSecret: true });
    });

    it('is refused every route here', async () => {
      await authed('post', `/departments/${A}/account-invitations`).send(inviteBody).expect(403);
      await authed('get', `/departments/${A}/account-invitations`).expect(403);
      await authed('get', '/account-invitations').expect(403);
      await authed('post', `/account-invitations/${INVITATION_ID}/approve`).expect(403);

      expect(invitations.create).not.toHaveBeenCalled();
      expect(invitations.approve).not.toHaveBeenCalled();
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

      await withoutHeader(`/departments/${A}/account-invitations`).send(inviteBody).expect(403);
      await withoutHeader(`/account-invitations/${INVITATION_ID}/approve`).expect(403);
      await withoutHeader(`/account-invitations/${INVITATION_ID}/reject`).expect(403);

      expect(invitations.create).not.toHaveBeenCalled();
      expect(invitations.approve).not.toHaveBeenCalled();
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
      ['get', '/departments/not-a-uuid/account-invitations'],
      ['post', '/departments/not-a-uuid/account-invitations'],
      ['post', '/account-invitations/not-a-uuid/approve'],
      ['post', '/account-invitations/not-a-uuid/reject'],
    ] as const)(
      'answers 422 for %s %s, without reaching the service',
      async (method, path) => {
        await authed(method, path).expect(422);
        expect(invitations.approve).not.toHaveBeenCalled();
      },
    );
  });
});
