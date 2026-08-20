import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../identity/api/session.cookie';
import { SessionService } from '../../identity/application/session.service';
import { OrganizationController } from '../../organization/api/organization.controller';
import { DepartmentService } from '../../organization/application/department.service';
import { MembershipService } from '../../organization/application/membership.service';
import { AuthorizationContext } from '../domain/authorization.context';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from '../application/authorization.service';
import { PermissionGuard } from './permission.guard';

/**
 * What an attacker can reach over HTTP.
 *
 * Every assertion here is about the OBSERVABLE surface: which status comes back,
 * what a body can and cannot influence, whether a service method was reached at
 * all. Nothing asserts implementation.
 *
 * The service layer is doubled on purpose — this file is about the guard chain,
 * and the database behaviour it would otherwise duplicate is proven for real in
 * `authorization.integration.spec.ts`.
 */
describe('authorization HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const USER = '33333333-3333-3333-3333-333333333333';

  /** Named fields rather than an index signature, so a typo is a compile error. */
  interface DepartmentDouble {
    list: jest.Mock;
    require: jest.Mock;
    create: jest.Mock;
    rename: jest.Mock;
    archive: jest.Mock;
  }
  interface MembershipDouble {
    listActiveMembers: jest.Mock;
    transfer: jest.Mock;
  }

  let app: INestApplication;
  let organization: DepartmentDouble & MembershipDouble;
  let context: AuthorizationContext;

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: USER,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  beforeEach(async () => {
    context = asContext();

    organization = {
      list: jest.fn().mockResolvedValue([]),
      require: jest.fn().mockResolvedValue({ id: A, slug: 'a', name: 'A' }),
      create: jest.fn().mockResolvedValue({ id: A }),
      rename: jest.fn().mockResolvedValue({ id: A }),
      archive: jest.fn().mockResolvedValue({ id: A }),
      listActiveMembers: jest.fn().mockResolvedValue([]),
      transfer: jest.fn().mockResolvedValue({ id: 'mem-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthorizationController, OrganizationController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: DepartmentService, useValue: organization },
        { provide: MembershipService, useValue: organization },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ id: USER, displayName: 'A Person', status: 'active' }),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            // Loaded per request, from the "database" — never from the client.
            loadContext: jest.fn().mockImplementation(async () => context),
            findLocalSubject: jest.fn().mockResolvedValue('hieu.truong@example.com'),
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

  const authed = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  // --------------------------------------------------------- unauthenticated --

  describe('without authentication', () => {
    it.each([
      ['get', '/departments'],
      ['get', `/departments/${A}`],
      ['post', '/departments'],
      ['patch', `/departments/${A}`],
      ['get', `/departments/${A}/members`],
      ['post', `/departments/${A}/members`],
      ['post', `/departments/${A}/archive`],
      ['get', '/authorization/me'],
    ] as const)('refuses %s %s with 401', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('X-Requested-With', 'XMLHttpRequest');

      // 401 rather than 403, because a client acts on the difference: one means
      // "log in again", the other means logging in again will not help.
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(organization.list).not.toHaveBeenCalled();
      expect(organization.transfer).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------- head scope --

  describe('a department head', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('reads its own department and the people in it', async () => {
      const unit = await authed('get', `/departments/${A}`);
      const roster = await authed('get', `/departments/${A}/members`);

      expect(unit.status).toBe(200);
      expect(roster.status).toBe(200);
      expect(organization.require).toHaveBeenCalledWith(A);
      expect(organization.listActiveMembers).toHaveBeenCalledWith(A, { limit: 50 });
    });

    it('is refused the SAME routes for another department — IDOR', async () => {
      await authed('get', `/departments/${B}`).expect(403);
      await authed('get', `/departments/${B}/members`).expect(403);
      expect(organization.listActiveMembers).not.toHaveBeenCalledWith(B, { limit: 50 });
    });

    it('cannot create, rename or archive a department', async () => {
      await authed('post', '/departments').send({ slug: 'x', name: 'X' }).expect(403);
      await authed('patch', `/departments/${A}`).send({ name: 'X' }).expect(403);
      await authed('post', `/departments/${A}/archive`).expect(403);
      expect(organization.create).not.toHaveBeenCalled();
      expect(organization.archive).not.toHaveBeenCalled();
    });

    it('cannot mutate membership even in its OWN department', async () => {
      // The head's path is a request a SuperAdmin approves — never a direct write.
      await authed('post', `/departments/${A}/members`).send({ userId: USER }).expect(403);
      expect(organization.transfer).not.toHaveBeenCalled();
    });

    it('cannot list all departments — that permission has no departmental scope', async () => {
      const response = await authed('get', '/departments');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(organization.list).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- member scope --

  describe('a plain member', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [A] });
    });

    it('reads its own department', async () => {
      const response = await authed('get', `/departments/${A}`);

      expect(response.status).toBe(200);
      expect(organization.require).toHaveBeenCalledWith(A);
    });

    it('cannot see who else is in it', async () => {
      const response = await authed('get', `/departments/${A}/members`);

      // A plain member seeing nobody — including in their own unit — is the
      // decided default, not an oversight.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(organization.listActiveMembers).not.toHaveBeenCalled();
    });

    it('cannot reach another department at all', async () => {
      const response = await authed('get', `/departments/${B}`);

      expect(response.status).toBe(403);
      // Nothing was read, so nothing about B leaked — not even that it exists.
      expect(organization.require).not.toHaveBeenCalled();
    });

    it('cannot mutate anything', async () => {
      const created = await authed('post', '/departments').send({ slug: 'x', name: 'X' });
      const transferred = await authed('post', `/departments/${A}/members`).send({ userId: USER });

      expect(created.status).toBe(403);
      expect(transferred.status).toBe(403);
      expect(organization.create).not.toHaveBeenCalled();
      expect(organization.transfer).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------- superadmin --

  describe('a SuperAdmin', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('reaches every department route, including ones it has no membership in', async () => {
      const list = await authed('get', '/departments');
      const unit = await authed('get', `/departments/${B}`);
      const roster = await authed('get', `/departments/${B}/members`);

      expect([list.status, unit.status, roster.status]).toEqual([200, 200, 200]);
      // B is a department this caller has no membership of, which is the point:
      // GLOBAL is not scoped, so membership never enters the decision.
      expect(organization.require).toHaveBeenCalledWith(B);
      expect(organization.listActiveMembers).toHaveBeenCalledWith(B, { limit: 50 });
    });

    it('creates, renames, archives and transfers directly', async () => {
      await authed('post', '/departments').send({ slug: 'x', name: 'X' }).expect(201);
      await authed('patch', `/departments/${A}`).send({ name: 'X' }).expect(200);
      await authed('post', `/departments/${A}/archive`).expect(200);
      await authed('post', `/departments/${B}/members`).send({ userId: USER }).expect(201);

      // The destination came from the ROUTE, not from the body.
      expect(organization.transfer).toHaveBeenCalledWith({
        userId: USER,
        toDepartmentId: B,
      });
    });
  });

  // ------------------------------------------------------------- spoofing --

  describe('a client that lies in the request body', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [A] });
    });

    it('cannot grant itself a role', async () => {
      const response = await authed('post', '/departments')
        .send({ slug: 'x', name: 'X', role: 'SUPERADMIN', global: true });

      expect(response.status).toBe(403);
      expect(organization.create).not.toHaveBeenCalled();

      // Nor did the claim survive into the next request: authority is reloaded
      // from the database every time, never carried over from a body.
      const me = await authed('get', '/authorization/me');
      expect(me.body.role).toBe('MEMBER');
      expect(me.body.permissions).not.toContain('role.assign');
    });

    it('cannot widen its scope by naming another department in the body', async () => {
      await authed('post', `/departments/${A}/members`)
        .send({ userId: USER, departmentId: B, scope: 'GLOBAL' })
        .expect(403);
      expect(organization.transfer).not.toHaveBeenCalled();
    });

    it('cannot act as somebody else by sending a userId for the caller', async () => {
      const other = '99999999-9999-9999-9999-999999999999';
      await authed('get', '/authorization/me').send({ userId: other }).expect(200);

      const response = await authed('get', '/authorization/me').expect(200);
      // The answer describes the SESSION's user, not the body's.
      expect(response.body.userId).toBe(USER);
    });

    it('cannot claim a permission it does not hold', async () => {
      const response = await authed('post', `/departments/${A}/members`)
        .send({ userId: USER, permissions: ['unit.member.write'] });

      expect(response.status).toBe(403);
      expect(organization.transfer).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------- temporary credential --

  describe('a caller whose temporary credential is unchanged', () => {
    beforeEach(() => {
      context = asContext({ global: true, mustChangeSecret: true });
    });

    it('is refused /authorization/me', async () => {
      const response = await authed('get', '/authorization/me');

      expect(response.status).toBe(403);
      // Refused BEFORE any authority is described: an unprovisioned caller does
      // not get to learn what they will be able to do until they finish.
      expect(response.body.role).toBeUndefined();
      expect(response.body.permissions).toBeUndefined();
    });

    it('is refused every guarded route, even holding global authority', async () => {
      const list = await authed('get', '/departments');
      const unit = await authed('get', `/departments/${A}`);
      const created = await authed('post', '/departments').send({ slug: 'x', name: 'X' });

      expect([list.status, unit.status, created.status]).toEqual([403, 403, 403]);
      expect(organization.list).not.toHaveBeenCalled();
      expect(organization.require).not.toHaveBeenCalled();
      expect(organization.create).not.toHaveBeenCalled();
    });

    /**
     * The client has to route this caller to the password screen, and it can
     * only do that if this refusal is TELLABLE APART from an ordinary one. Both
     * are 403, so the code is the only thing carrying the difference.
     */
    it('says WHY, with a code distinct from an ordinary refusal', async () => {
      const blocked = await authed('get', '/authorization/me').expect(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const guarded = await authed('get', '/departments').expect(403);
      expect(guarded.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // And the same route refuses an ordinary caller under the other code.
      context = asContext({ memberOf: [A] });
      const ordinary = await authed('get', '/departments').expect(403);
      expect(ordinary.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------- authorization/me --

  describe('GET /authorization/me', () => {
    it('derives role, departments, username and permissions server-side', async () => {
      context = asContext({ headOf: [A], memberOf: [A] });

      const response = await authed('get', '/authorization/me').expect(200);

      expect(response.body).toEqual({
        userId: USER,
        username: 'hieu.truong',
        role: 'DEPARTMENT_HEAD',
        departmentIds: [A],
        permissions: expect.arrayContaining(['unit.read', 'unit.member.read']),
      });
      expect(response.body.permissions).not.toContain('unit.member.write');
    });

    it('reports a SuperAdmin as global with no departments', async () => {
      context = asContext({ global: true });

      const response = await authed('get', '/authorization/me').expect(200);
      expect(response.body.role).toBe('SUPERADMIN');
      expect(response.body.departmentIds).toEqual([]);
    });

    it('never leaks a credential or a token', async () => {
      context = asContext({ memberOf: [A] });

      const response = await authed('get', '/authorization/me').expect(200);
      const body = JSON.stringify(response.body).toLowerCase();
      expect(body).not.toContain('password');
      expect(body).not.toContain('secret');
      expect(body).not.toContain('token');
    });
  });

  // ------------------------------------------------------------------ csrf --

  describe('CSRF', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('refuses a mutation without the header, before any permission is considered', async () => {
      await request(app.getHttpServer())
        .post('/departments')
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .send({ slug: 'x', name: 'X' })
        .expect(403);
      expect(organization.create).not.toHaveBeenCalled();
    });
  });
});
