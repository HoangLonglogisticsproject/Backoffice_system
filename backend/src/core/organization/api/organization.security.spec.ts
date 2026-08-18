import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { PermissionGuard } from '../../authorization/api/permission.guard';
import { AuthorizationService } from '../../authorization/application/authorization.service';
import { AuthorizationContext } from '../../authorization/domain/authorization.context';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../identity/api/session.cookie';
import { SessionService } from '../../identity/application/session.service';
import { DepartmentService } from '../application/department.service';
import { MembershipService } from '../application/membership.service';
import { OrganizationController } from './organization.controller';

/**
 * The organization over HTTP — the read side included.
 *
 * Reads are where a scoped permission is easiest to get wrong, because a
 * too-generous one leaks the org chart rather than corrupting it, and nothing
 * fails loudly. So every route below is exercised from all four standings, and
 * the assertions check the SERVICE WAS NEVER REACHED on a refusal, not just the
 * status code.
 */
describe('organization HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const TARGET = '44444444-4444-4444-4444-444444444444';

  let app: INestApplication;
  let departments: {
    list: jest.Mock;
    require: jest.Mock;
    create: jest.Mock;
    rename: jest.Mock;
    archive: jest.Mock;
  };
  let memberships: { listActiveMembers: jest.Mock; transfer: jest.Mock };
  let context: AuthorizationContext;

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  const department = { id: A, slug: 'operations', name: 'Operations', status: 'active' };

  beforeEach(async () => {
    context = asContext();
    departments = {
      list: jest.fn().mockResolvedValue([department]),
      require: jest.fn().mockResolvedValue(department),
      create: jest.fn().mockResolvedValue(department),
      rename: jest.fn().mockResolvedValue({ ...department, name: 'Renamed' }),
      archive: jest.fn().mockResolvedValue({ ...department, status: 'archived' }),
    };
    memberships = {
      listActiveMembers: jest
        .fn()
        .mockResolvedValue([{ id: 'm1', userId: TARGET, departmentId: A, status: 'active' }]),
      transfer: jest
        .fn()
        .mockResolvedValue({ id: 'm2', userId: TARGET, departmentId: A, status: 'active' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: DepartmentService, useValue: departments },
        { provide: MembershipService, useValue: memberships },
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

  const authed = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  const noneOfTheServicesRan = () => {
    for (const double of [...Object.values(departments), ...Object.values(memberships)]) {
      expect(double).not.toHaveBeenCalled();
    }
  };

  // ------------------------------------------------------------ anonymous --

  describe('without authentication', () => {
    it.each([
      ['get', '/departments'],
      ['get', `/departments/${A}`],
      ['get', `/departments/${A}/members`],
      ['post', '/departments'],
      ['patch', `/departments/${A}`],
      ['post', `/departments/${A}/archive`],
      ['post', `/departments/${A}/members`],
    ] as const)('refuses %s %s with 401', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('reaches no service at all', async () => {
      const list = await request(app.getHttpServer()).get('/departments');
      const roster = await request(app.getHttpServer()).get(`/departments/${A}/members`);

      expect([list.status, roster.status]).toEqual([401, 401]);
      noneOfTheServicesRan();
    });
  });

  // --------------------------------------------------------------- MEMBER --

  describe('a plain member', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [A] });
    });

    it('reads the unit it belongs to', async () => {
      const response = await authed('get', `/departments/${A}`).expect(200);

      expect(response.body.id).toBe(A);
      expect(departments.require).toHaveBeenCalledWith(A);
    });

    it('cannot read a unit it does not belong to', async () => {
      await authed('get', `/departments/${B}`).expect(403);
      expect(departments.require).not.toHaveBeenCalled();
    });

    it('cannot list every unit — that read has no scope, so it is global-only', async () => {
      await authed('get', '/departments').expect(403);
      expect(departments.list).not.toHaveBeenCalled();
    });

    it('cannot see who else is in its own unit — the decided default', async () => {
      await authed('get', `/departments/${A}/members`).expect(403);
      expect(memberships.listActiveMembers).not.toHaveBeenCalled();
    });

    it('cannot write anything', async () => {
      await authed('post', '/departments').send({ slug: 'x', name: 'X' }).expect(403);
      await authed('patch', `/departments/${A}`).send({ name: 'X' }).expect(403);
      await authed('post', `/departments/${A}/archive`).expect(403);
      await authed('post', `/departments/${A}/members`).send({ userId: TARGET }).expect(403);

      expect(departments.create).not.toHaveBeenCalled();
      expect(departments.rename).not.toHaveBeenCalled();
      expect(departments.archive).not.toHaveBeenCalled();
      expect(memberships.transfer).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------- HEAD --

  describe('a department head', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('reads its own unit and its own roster', async () => {
      await authed('get', `/departments/${A}`).expect(200);
      const roster = await authed('get', `/departments/${A}/members`).expect(200);

      expect(roster.body).toHaveLength(1);
      expect(memberships.listActiveMembers).toHaveBeenCalledWith(A);
    });

    it('cannot read another unit’s roster — IDOR on the route parameter', async () => {
      await authed('get', `/departments/${B}/members`).expect(403);
      await authed('get', `/departments/${B}`).expect(403);

      expect(memberships.listActiveMembers).not.toHaveBeenCalled();
      expect(departments.require).not.toHaveBeenCalled();
    });

    it('cannot list every unit', async () => {
      await authed('get', '/departments').expect(403);
      expect(departments.list).not.toHaveBeenCalled();
    });

    it('cannot move anybody into the unit it leads — that is the approval path', async () => {
      await authed('post', `/departments/${A}/members`).send({ userId: TARGET }).expect(403);
      expect(memberships.transfer).not.toHaveBeenCalled();
    });

    it('cannot create, rename or archive a unit', async () => {
      await authed('post', '/departments').send({ slug: 'x', name: 'X' }).expect(403);
      await authed('patch', `/departments/${A}`).send({ name: 'X' }).expect(403);
      await authed('post', `/departments/${A}/archive`).expect(403);

      expect(departments.create).not.toHaveBeenCalled();
      expect(departments.rename).not.toHaveBeenCalled();
      expect(departments.archive).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- SUPERADMIN --

  describe('a SuperAdmin', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('reads every unit and every roster, belonging to none of them', async () => {
      await authed('get', '/departments').expect(200);
      await authed('get', `/departments/${B}`).expect(200);
      await authed('get', `/departments/${B}/members`).expect(200);

      expect(memberships.listActiveMembers).toHaveBeenCalledWith(B);
    });

    it('creates, renames and archives', async () => {
      await authed('post', '/departments').send({ slug: 'ops', name: 'Operations' }).expect(201);
      await authed('patch', `/departments/${A}`).send({ name: 'Renamed' }).expect(200);
      const archived = await authed('post', `/departments/${A}/archive`).expect(200);

      expect(departments.create).toHaveBeenCalledWith({ slug: 'ops', name: 'Operations' });
      expect(departments.rename).toHaveBeenCalledWith(A, 'Renamed');
      expect(archived.body.status).toBe('archived');
    });

    it('transfers somebody into the unit named on the route', async () => {
      await authed('post', `/departments/${B}/members`).send({ userId: TARGET }).expect(201);

      expect(memberships.transfer).toHaveBeenCalledWith({
        userId: TARGET,
        toDepartmentId: B,
      });
    });
  });

  // -------------------------------------------------------------- spoofing --

  describe('a client that lies in the request body', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('cannot redirect a transfer away from the route’s unit', async () => {
      await authed('post', `/departments/${A}/members`)
        .send({ userId: TARGET, departmentId: B, toDepartmentId: B, fromDepartmentId: B })
        .expect(201);

      expect(memberships.transfer).toHaveBeenCalledWith({
        userId: TARGET,
        toDepartmentId: A,
      });
    });

    it('cannot name the source unit — that is read from the database', async () => {
      await authed('post', `/departments/${A}/members`)
        .send({ userId: TARGET, sourceDepartmentId: B })
        .expect(201);

      expect(JSON.stringify(memberships.transfer.mock.calls[0][0])).not.toContain(B);
    });

    it('cannot make somebody a head while transferring them', async () => {
      await authed('post', `/departments/${A}/members`)
        .send({ userId: TARGET, role: 'DEPARTMENT_HEAD', permissions: ['role.assign'] })
        .expect(201);

      expect(memberships.transfer).toHaveBeenCalledWith({
        userId: TARGET,
        toDepartmentId: A,
      });
    });

    it('cannot set a status while creating a unit', async () => {
      await authed('post', '/departments')
        .send({ slug: 'ops', name: 'Operations', status: 'archived', id: B })
        .expect(201);

      expect(departments.create).toHaveBeenCalledWith({ slug: 'ops', name: 'Operations' });
    });

    it('rejects a malformed transfer before the service is reached', async () => {
      await authed('post', `/departments/${A}/members`).send({ userId: 'not-a-uuid' }).expect(422);
      await authed('post', '/departments').send({ slug: '', name: 'X' }).expect(422);

      expect(memberships.transfer).not.toHaveBeenCalled();
      expect(departments.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------- domain errors over HTTP --

  describe('service refusals reach the client with their own status', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    const errors = () =>
      jest.requireActual<typeof import('../../../common/errors/domain.error')>(
        '../../../common/errors/domain.error',
      );

    it('maps an unknown unit to 404', async () => {
      const { NotFoundError } = errors();
      departments.require.mockRejectedValue(new NotFoundError('No such department.'));

      const response = await authed('get', `/departments/${A}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('maps archiving a populated unit to 409', async () => {
      const { ConflictError } = errors();
      departments.archive.mockRejectedValue(
        new ConflictError('That department still has active members.'),
      );

      const response = await authed('post', `/departments/${A}/archive`);

      // 409 and not 422: the request is well formed, the world is not ready.
      // A client should reload and re-check, not correct the body and resend.
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('maps a duplicate slug to 409', async () => {
      const { ConflictError } = errors();
      departments.create.mockRejectedValue(new ConflictError('That slug is taken.'));

      const response = await authed('post', '/departments').send({ slug: 'ops', name: 'Operations' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  // ------------------------------------------------ temporary credential --

  describe('a caller whose temporary credential is unchanged', () => {
    beforeEach(() => {
      context = asContext({ global: true, headOf: [A], memberOf: [A], mustChangeSecret: true });
    });

    it('is refused every route here, reads included', async () => {
      const responses = [
        await authed('get', '/departments'),
        await authed('get', `/departments/${A}`),
        await authed('get', `/departments/${A}/members`),
        await authed('post', '/departments').send({ slug: 'x', name: 'X' }),
        await authed('post', `/departments/${A}/members`).send({ userId: TARGET }),
      ];

      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
      // The distinct code is what lets a client send them to the password
      // screen instead of showing a dead end.
      for (const response of responses) {
        expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      }
      noneOfTheServicesRan();
    });
  });

  // ------------------------------------------------------------------ CSRF --

  describe('CSRF', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('refuses every mutation without the header', async () => {
      const bare = (method: 'post' | 'patch', path: string) =>
        request(app.getHttpServer())[method](path).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

      const responses = [
        await bare('post', '/departments').send({ slug: 'ops', name: 'Operations' }),
        await bare('patch', `/departments/${A}`).send({ name: 'X' }),
        await bare('post', `/departments/${A}/archive`),
        await bare('post', `/departments/${A}/members`).send({ userId: TARGET }),
      ];

      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect(departments.create).not.toHaveBeenCalled();
      expect(memberships.transfer).not.toHaveBeenCalled();
    });

    it('allows a read without it — a GET changes nothing', async () => {
      const response = await request(app.getHttpServer())
        .get('/departments')
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

      expect(response.status).toBe(200);
      expect(departments.list).toHaveBeenCalled();
    });
  });
});
