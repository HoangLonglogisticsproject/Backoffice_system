import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../identity/api/session.cookie';
import { SessionService } from '../../identity/application/session.service';
import { AuthorizationService } from '../application/authorization.service';
import { AuthorizationContext } from '../domain/authorization.context';
import { DepartmentHeadController } from './department-head.controller';
import { PermissionGuard } from './permission.guard';

/**
 * Appointing and removing a department head.
 *
 * The rule these routes exist to hold is that leadership is granted FROM
 * OUTSIDE the unit: `role.assign` is global-only, so a head cannot appoint a
 * successor, promote an ally, or hand their own authority to anybody. The
 * assertions below check the service was never reached on a refusal, because a
 * 403 raised after the grant already happened would be indistinguishable from
 * one raised before it.
 */
describe('department head HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const TARGET = '44444444-4444-4444-4444-444444444444';
  const ASSIGNMENT = '55555555-5555-5555-5555-555555555555';
  const MEMBERSHIP = '66666666-6666-6666-6666-666666666666';

  let app: INestApplication;
  let authorization: {
    loadContext: jest.Mock;
    assignDepartmentHead: jest.Mock;
    revokeHeadOfDepartment: jest.Mock;
    findActiveHeadOfDepartment: jest.Mock;
    findActiveHeadOfDepartmentWithUser: jest.Mock;
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

  const assignment = {
    id: ASSIGNMENT,
    userId: TARGET,
    roleKey: 'DEPARTMENT_HEAD',
    scopeType: 'DEPARTMENT',
    scopeId: A,
    membershipId: MEMBERSHIP,
    status: 'active',
    grantedVia: 'api',
    grantedBy: ACTOR,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    revokedVia: null,
    revokedBy: null,
    revokedAt: null,
  };

  const errors = () =>
    jest.requireActual<typeof import('../../../common/errors/domain.error')>(
      '../../../common/errors/domain.error',
    );

  beforeEach(async () => {
    context = asContext();
    authorization = {
      loadContext: jest.fn().mockImplementation(async () => context),
      assignDepartmentHead: jest.fn().mockResolvedValue(assignment),
      revokeHeadOfDepartment: jest
        .fn()
        .mockResolvedValue({ ...assignment, status: 'revoked', revokedBy: ACTOR }),
      findActiveHeadOfDepartment: jest.fn().mockResolvedValue(assignment),
      // The READ goes through the projecting variant; the two write routes do
      // not, which is the point of them being separate methods.
      findActiveHeadOfDepartmentWithUser: jest
        .fn()
        .mockResolvedValue({ ...assignment, user: { id: TARGET, displayName: 'Head Person' } }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DepartmentHeadController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: AuthorizationService, useValue: authorization },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ id: ACTOR, displayName: 'Actor', status: 'active' }),
          },
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

  const authed = (method: 'get' | 'post' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  const nothingHappened = () => {
    expect(authorization.assignDepartmentHead).not.toHaveBeenCalled();
    expect(authorization.revokeHeadOfDepartment).not.toHaveBeenCalled();
  };

  // ------------------------------------------------------------ anonymous --

  describe('without authentication', () => {
    it.each([
      ['get', `/departments/${A}/head`],
      ['post', `/departments/${A}/head`],
      ['delete', `/departments/${A}/head`],
    ] as const)('refuses %s %s with 401', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      nothingHappened();
    });
  });

  // ----------------------------------------------------------------- HEAD --

  describe('a department head', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('cannot appoint a successor in the unit it leads', async () => {
      const response = await authed('post', `/departments/${A}/head`).send({ userId: TARGET });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      nothingHappened();
    });

    it('cannot remove itself, so stepping down is not self-service', async () => {
      const response = await authed('delete', `/departments/${A}/head`);

      expect(response.status).toBe(403);
      nothingHappened();
    });

    it('cannot even read who leads its own unit', async () => {
      // `role.assign` is global-only, and this route carries the same
      // permission as the two that change it: knowing who holds authority is
      // part of administering it.
      const response = await authed('get', `/departments/${A}/head`);

      expect(response.status).toBe(403);
      expect(authorization.findActiveHeadOfDepartment).not.toHaveBeenCalled();
    });

    it('cannot reach another unit either', async () => {
      const assigned = await authed('post', `/departments/${B}/head`).send({ userId: TARGET });
      const revoked = await authed('delete', `/departments/${B}/head`);

      expect([assigned.status, revoked.status]).toEqual([403, 403]);
      nothingHappened();
    });
  });

  // --------------------------------------------------------------- MEMBER --

  describe('a plain member', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [A] });
    });

    it('cannot promote itself', async () => {
      const response = await authed('post', `/departments/${A}/head`).send({ userId: ACTOR });

      expect(response.status).toBe(403);
      nothingHappened();
    });

    it('cannot read or remove', async () => {
      const read = await authed('get', `/departments/${A}/head`);
      const removed = await authed('delete', `/departments/${A}/head`);

      expect([read.status, removed.status]).toEqual([403, 403]);
      nothingHappened();
    });
  });

  // ----------------------------------------------------------- SUPERADMIN --

  describe('a SuperAdmin', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('appoints a head, taking the unit from the route and the person from the body', async () => {
      const response = await authed('post', `/departments/${A}/head`).send({ userId: TARGET });

      expect(response.status).toBe(201);
      expect(authorization.assignDepartmentHead).toHaveBeenCalledWith({
        userId: TARGET,
        departmentId: A,
        grantedBy: ACTOR,
      });
      expect(response.body).toEqual({
        assignmentId: ASSIGNMENT,
        departmentId: A,
        userId: TARGET,
        membershipId: MEMBERSHIP,
        grantedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('removes a head', async () => {
      const response = await authed('delete', `/departments/${A}/head`);

      expect(response.status).toBe(200);
      expect(authorization.revokeHeadOfDepartment).toHaveBeenCalledWith({
        departmentId: A,
        revokedBy: ACTOR,
      });
    });

    it('reads who leads any unit, including ones it has no membership of', async () => {
      const response = await authed('get', `/departments/${B}/head`);

      expect(response.status).toBe(200);
      expect(authorization.findActiveHeadOfDepartmentWithUser).toHaveBeenCalledWith(B);
      expect(response.body.userId).toBe(TARGET);
      // The scalar id stays exactly where it was; the name is a NEW sibling.
      expect(response.body.user).toEqual({ id: TARGET, displayName: 'Head Person' });
    });

    it('gets 404, not an empty body, for a unit with no head', async () => {
      const { NotFoundError } = errors();
      authorization.findActiveHeadOfDepartmentWithUser.mockResolvedValue(null);

      const response = await authed('get', `/departments/${A}/head`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');

      authorization.revokeHeadOfDepartment.mockRejectedValue(
        new NotFoundError('That department has no active head.'),
      );
      const removed = await authed('delete', `/departments/${A}/head`);
      expect(removed.status).toBe(404);
    });
  });

  // -------------------------------------------------------------- spoofing --

  describe('a client that lies in the request body', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('cannot redirect the appointment to another unit from the body', async () => {
      await authed('post', `/departments/${A}/head`)
        .send({ userId: TARGET, departmentId: B, scopeId: B })
        .expect(201);

      expect(authorization.assignDepartmentHead).toHaveBeenCalledWith({
        userId: TARGET,
        departmentId: A,
        grantedBy: ACTOR,
      });
    });

    it('cannot name the granter — provenance comes from the session', async () => {
      await authed('post', `/departments/${A}/head`)
        .send({ userId: TARGET, grantedBy: TARGET, grantedVia: 'bootstrap' })
        .expect(201);

      const passed = authorization.assignDepartmentHead.mock.calls[0][0];
      expect(passed.grantedBy).toBe(ACTOR);
      expect(passed).not.toHaveProperty('grantedVia');
    });

    it('cannot supply the membership that entitles the appointment', async () => {
      // The membership is READ under a lock inside the transaction. Accepting
      // one from the caller would let them point at a membership of a different
      // department and defeat invariant #6 at the application layer.
      await authed('post', `/departments/${A}/head`)
        .send({ userId: TARGET, membershipId: '99999999-9999-9999-9999-999999999999' })
        .expect(201);

      expect(authorization.assignDepartmentHead.mock.calls[0][0]).not.toHaveProperty(
        'membershipId',
      );
    });

    it('cannot grant GLOBAL through this route', async () => {
      await authed('post', `/departments/${A}/head`)
        .send({ userId: TARGET, roleKey: 'SUPERADMIN', scopeType: 'GLOBAL' })
        .expect(201);

      const passed = authorization.assignDepartmentHead.mock.calls[0][0];
      expect(passed).not.toHaveProperty('roleKey');
      expect(passed).not.toHaveProperty('scopeType');
    });

    it('rejects a malformed userId before the service is reached', async () => {
      const missing = await authed('post', `/departments/${A}/head`).send({});
      const malformed = await authed('post', `/departments/${A}/head`).send({ userId: 'nope' });

      expect([missing.status, malformed.status]).toEqual([422, 422]);
      expect(authorization.assignDepartmentHead).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------- domain errors over HTTP --

  describe('the invariants surface as their own statuses', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('maps appointing a non-member to 409 — invariant #6', async () => {
      const { ConflictError } = errors();
      authorization.assignDepartmentHead.mockRejectedValue(
        new ConflictError(
          'A department head must hold an active membership of the department they lead.',
        ),
      );

      const response = await authed('post', `/departments/${A}/head`).send({ userId: TARGET });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps a unit that already has a head to 409 — invariant #2', async () => {
      const { ConflictError } = errors();
      authorization.assignDepartmentHead.mockRejectedValue(
        new ConflictError('That department already has an active head.'),
      );

      const response = await authed('post', `/departments/${A}/head`).send({ userId: TARGET });

      expect(response.status).toBe(409);
    });

    it('maps an archived unit to 409', async () => {
      const { ConflictError } = errors();
      authorization.assignDepartmentHead.mockRejectedValue(
        new ConflictError('That department is archived.'),
      );

      const response = await authed('post', `/departments/${A}/head`).send({ userId: TARGET });

      expect(response.status).toBe(409);
    });

    it('maps a concurrent second revocation to 409', async () => {
      const { ConflictError } = errors();
      authorization.revokeHeadOfDepartment.mockRejectedValue(
        new ConflictError('That assignment was already revoked.'),
      );

      const response = await authed('delete', `/departments/${A}/head`);

      expect(response.status).toBe(409);
    });
  });

  // ------------------------------------------------ temporary credential --

  describe('a caller whose temporary credential is unchanged', () => {
    beforeEach(() => {
      context = asContext({ global: true, mustChangeSecret: true });
    });

    it('is refused all three routes despite holding global authority', async () => {
      const read = await authed('get', `/departments/${A}/head`);
      const assigned = await authed('post', `/departments/${A}/head`).send({ userId: TARGET });
      const removed = await authed('delete', `/departments/${A}/head`);

      expect([read.status, assigned.status, removed.status]).toEqual([403, 403, 403]);
      expect(read.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      nothingHappened();
    });
  });

  // ------------------------------------------------------------------ CSRF --

  describe('CSRF', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('refuses both mutations without the header, DELETE included', async () => {
      const bare = (method: 'post' | 'delete') =>
        request(app.getHttpServer())
          [method](`/departments/${A}/head`)
          .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

      const assigned = await bare('post').send({ userId: TARGET });
      const removed = await bare('delete');

      expect([assigned.status, removed.status]).toEqual([403, 403]);
      nothingHappened();
    });

    it('allows the read without it', async () => {
      const response = await request(app.getHttpServer())
        .get(`/departments/${A}/head`)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

      expect(response.status).toBe(200);
      expect(authorization.findActiveHeadOfDepartmentWithUser).toHaveBeenCalledWith(A);
    });
  });
});
