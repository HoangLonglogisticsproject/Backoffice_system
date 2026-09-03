import { NotFoundError } from '../../../common/errors/domain.error';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { PermissionGuard } from '../../../core/authorization/api/permission.guard';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import type { AccountType } from '../../../core/users/domain/user.entity';
import { DriverAccountService } from '../application/driver-account.service';
import { DriverAccountController } from './driver-account.controller';

/**
 * Driver accounts, over HTTP.
 *
 * ★ THE POLICY THIS FILE PINS DOWN. Proposing a driver and creating one are two
 * authorities, and the second is not a wider version of the first — it is a
 * different key at a different tier. A department head may say who should
 * drive; only a global administrator may make it so.
 *
 * ⚠ THESE CASES EXIST BECAUSE "HIDE THE BUTTON" IS NOT A CONTROL. Every refusal
 * below is asserted at the HTTP boundary with the service mocked, so a head who
 * knows the URL is refused by the server rather than by the absence of a link.
 */
describe('driver-account HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const BOSS = '11111111-1111-1111-1111-111111111111';
  const OPS_HEAD = '22222222-2222-2222-2222-222222222222';
  const ACC_HEAD = '33333333-3333-3333-3333-333333333333';
  const MEMBER = '44444444-4444-4444-4444-444444444444';
  const DRIVER = '55555555-5555-5555-5555-555555555555';
  const OPS_DEPT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ACC_DEPT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const REQUEST = '99999999-9999-9999-9999-999999999999';
  /** A driver account the administrator manages — not the one that is signed in. */
  const MANAGED = '66666666-6666-6666-6666-666666666666';

  let app: INestApplication;
  let context: AuthorizationContext;
  let accountType: AccountType;
  let sessionUserId: string;
  let drivers: {
    createDirectly: jest.Mock;
    request: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    listPending: jest.Mock;
    listMine: jest.Mock;
    list: jest.Mock;
    get: jest.Mock;
    setStatus: jest.Mock;
  };

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: sessionUserId,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  /** A global administrator. */
  const asSuperAdmin = () => {
    sessionUserId = BOSS;
    accountType = 'employee';
    context = asContext({ userId: BOSS, global: true });
  };

  /** Head of Operations — a DEPARTMENT_HEAD, which is all the model has. */
  const asOperationsHead = () => {
    sessionUserId = OPS_HEAD;
    accountType = 'employee';
    context = asContext({ userId: OPS_HEAD, headOf: [OPS_DEPT], memberOf: [OPS_DEPT] });
  };

  const asAccountingHead = () => {
    sessionUserId = ACC_HEAD;
    accountType = 'employee';
    context = asContext({ userId: ACC_HEAD, headOf: [ACC_DEPT], memberOf: [ACC_DEPT] });
  };

  const asOrdinaryMember = () => {
    sessionUserId = MEMBER;
    accountType = 'employee';
    context = asContext({ userId: MEMBER, memberOf: [OPS_DEPT] });
  };

  const asDriver = () => {
    sessionUserId = DRIVER;
    accountType = 'driver';
    context = asContext({ userId: DRIVER });
  };

  beforeEach(async () => {
    asSuperAdmin();

    drivers = {
      createDirectly: jest.fn().mockResolvedValue({
        userId: 'new-driver',
        displayName: 'Tài Xế A',
        username: 'taixea',
      }),
      request: jest.fn().mockResolvedValue({ id: REQUEST, status: 'pending' }),
      approve: jest.fn().mockResolvedValue({
        request: { id: REQUEST, status: 'approved' },
        driver: { userId: 'new-driver', username: 'taixea', temporaryPassword: 'generated' },
      }),
      reject: jest.fn().mockResolvedValue({ id: REQUEST, status: 'rejected' }),
      listPending: jest.fn().mockResolvedValue([]),
      listMine: jest.fn().mockResolvedValue([]),
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({
        id: MANAGED,
        displayName: 'Tài Xế A',
        username: 'taixea',
        accountType: 'driver',
        status: 'active',
        createdAt: new Date('2026-08-01T00:00:00Z'),
      }),
      setStatus: jest.fn().mockResolvedValue({ id: MANAGED, status: 'disabled' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DriverAccountController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        BackofficeOnlyGuard,
        { provide: DriverAccountService, useValue: drivers },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest.fn().mockImplementation(async () => ({
              id: sessionUserId,
              displayName: 'Somebody',
              accountType,
              status: 'active',
            })),
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

  const CREATE = '/driver-accounts';
  const LIST = '/driver-accounts';
  const DETAIL = `${LIST}/${MANAGED}`;
  const STATUS = `${DETAIL}/status`;
  const REQUESTS = '/driver-account-requests';
  const APPROVE = `${REQUESTS}/${REQUEST}/approve`;
  const REJECT = `${REQUESTS}/${REQUEST}/reject`;

  const newDriver = { displayName: 'Tài Xế A', email: 'taixea@hoanglonglti.com' };

  // ================================================================ 1 · create ==

  describe('a global administrator', () => {
    it('★ creates a driver directly, with no approval step', async () => {
      const response = await authed('post', CREATE).send({ ...newDriver, initialPassword: 'Tam-2026!' });

      expect(response.status).toBe(201);
      expect(drivers.createDirectly).toHaveBeenCalledWith({
        ...newDriver,
        initialPassword: 'Tam-2026!',
      });
      // The decision path was not involved: nothing to approve.
      expect(drivers.request).not.toHaveBeenCalled();
      expect(drivers.approve).not.toHaveBeenCalled();
    });

    it('★ never echoes the password it was given back', async () => {
      const response = await authed('post', CREATE).send({ ...newDriver, initialPassword: 'Tam-2026!' });

      expect(JSON.stringify(response.body)).not.toContain('Tam-2026!');
    });

    it('reads the pending queue', async () => {
      await authed('get', REQUESTS).expect(200);
      expect(drivers.listPending).toHaveBeenCalled();
    });

    // ------------------------------------------------- driver management --

    it('lists the driver accounts', async () => {
      drivers.list.mockResolvedValue([{ id: MANAGED, displayName: 'Tài Xế A', status: 'disabled' }]);

      const response = await authed('get', LIST).expect(200);

      expect(response.body).toEqual([{ id: MANAGED, displayName: 'Tài Xế A', status: 'disabled' }]);
    });

    it('reads one driver, and gets only the six management fields', async () => {
      const response = await authed('get', DETAIL).expect(200);

      expect(drivers.get).toHaveBeenCalledWith(MANAGED);
      expect(Object.keys(response.body).sort()).toEqual(
        ['accountType', 'createdAt', 'displayName', 'id', 'status', 'username'].sort(),
      );
    });

    it.each(['disabled', 'active'] as const)('★ sets a driver to %s, as the session user', async (status) => {
      drivers.setStatus.mockResolvedValue({ id: MANAGED, status });

      const response = await authed('patch', STATUS).send({ status }).expect(200);

      expect(drivers.setStatus).toHaveBeenCalledWith({ userId: MANAGED, status, actingUserId: BOSS });
      expect(response.body).toEqual({ id: MANAGED, status });
    });

    it('refuses a status that is neither, before any service', async () => {
      await authed('patch', STATUS).send({ status: 'archived' }).expect(422);
      expect(drivers.setStatus).not.toHaveBeenCalled();
    });

    it('★ answers 404 for a target that is not a driver — the service says so, the route repeats it', async () => {
      drivers.get.mockRejectedValue(new NotFoundError('Driver not found.'));
      drivers.setStatus.mockRejectedValue(new NotFoundError('Driver not found.'));

      await authed('get', DETAIL).expect(404);
      await authed('patch', STATUS).send({ status: 'disabled' }).expect(404);
    });

    it('refuses a status change without the CSRF header, before the service', async () => {
      await request(app.getHttpServer())
        .patch(STATUS)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .send({ status: 'disabled' })
        .expect(403);
      expect(drivers.setStatus).not.toHaveBeenCalled();
    });
  });

  // ============================================================== 3,4 · request ==

  describe.each([
    ['an Operations head', asOperationsHead],
    ['an Accounting head', asAccountingHead],
  ])('%s', (_label, become) => {
    beforeEach(() => become());

    it('★ may PROPOSE a driver — the request is all they get', async () => {
      const response = await authed('post', REQUESTS).send(newDriver);

      expect(response.status).toBe(201);
      expect(drivers.request).toHaveBeenCalledWith({
        ...newDriver,
        requestedBy: sessionUserId,
      });
      // ★ NOTHING WAS CREATED. This is the whole separation: proposing is not a
      // narrower way of creating, it is a different act with a different key.
      expect(drivers.createDirectly).not.toHaveBeenCalled();
    });

    it('reads back only their OWN proposals', async () => {
      const response = await authed('get', `${REQUESTS}/mine`);

      expect(response.status).toBe(200);
      // Scoped from the session, so no query string can widen it.
      expect(drivers.listMine).toHaveBeenCalledWith(sessionUserId);
    });

    it('★ may NOT create a driver directly, and reaches no service', async () => {
      const response = await authed('post', CREATE).send({ ...newDriver, initialPassword: 'x' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(drivers.createDirectly).not.toHaveBeenCalled();
    });

    it.each([
      ['approve', APPROVE],
      ['reject', REJECT],
    ])('★ may NOT %s, and reaches no service', async (_action, path) => {
      const response = await authed('post', path).send({ reason: 'Không đạt.' });

      expect(response.status).toBe(403);
      expect(drivers.approve).not.toHaveBeenCalled();
      expect(drivers.reject).not.toHaveBeenCalled();
    });

    it('may not read the global pending queue', async () => {
      const response = await authed('get', REQUESTS);

      expect(response.status).toBe(403);
      expect(drivers.listPending).not.toHaveBeenCalled();
    });

    it.each([
      ['get', LIST],
      ['get', DETAIL],
      ['patch', STATUS],
    ] as const)('★ may not manage driver accounts — %s %s is 403 and reaches no service', async (method, path) => {
      const response = await authed(method, path).send({ status: 'disabled' });

      expect(response.status).toBe(403);
      expect(drivers.list).not.toHaveBeenCalled();
      expect(drivers.get).not.toHaveBeenCalled();
      expect(drivers.setStatus).not.toHaveBeenCalled();
    });
  });

  // ================================================================= 5 · member ==

  describe('an ordinary member', () => {
    beforeEach(() => asOrdinaryMember());

    it('★ may not even PROPOSE a driver', async () => {
      const response = await authed('post', REQUESTS).send(newDriver);

      expect(response.status).toBe(403);
      expect(drivers.request).not.toHaveBeenCalled();
    });

    it('may not create one either', async () => {
      const response = await authed('post', CREATE).send({ ...newDriver, initialPassword: 'x' });

      expect(response.status).toBe(403);
      expect(drivers.createDirectly).not.toHaveBeenCalled();
    });

    it.each([
      ['get', LIST],
      ['get', DETAIL],
      ['patch', STATUS],
    ] as const)('may not manage driver accounts — %s %s', async (method, path) => {
      const response = await authed(method, path).send({ status: 'active' });

      expect(response.status).toBe(403);
      expect(drivers.list).not.toHaveBeenCalled();
      expect(drivers.get).not.toHaveBeenCalled();
      expect(drivers.setStatus).not.toHaveBeenCalled();
    });
  });

  // ================================================================= 14 · driver ==

  describe('★ a driver account, holding the Backoffice URLs', () => {
    beforeEach(() => asDriver());

    it.each([
      ['post', CREATE],
      ['post', REQUESTS],
      ['get', REQUESTS],
      ['get', `${REQUESTS}/mine`],
      ['post', APPROVE],
      ['post', REJECT],
      ['get', LIST],
      ['get', DETAIL],
      ['patch', STATUS],
    ] as const)('refuses %s %s with 403, and reaches no service', async (method, path) => {
      const response = await authed(method, path).send({ reason: 'x', status: 'active' });

      expect(response.status).toBe(403);
      for (const mock of Object.values(drivers)) expect(mock).not.toHaveBeenCalled();
    });
  });

  // ============================================================== anonymous ==

  describe('without authentication', () => {
    it.each([
      ['post', CREATE],
      ['post', REQUESTS],
      ['get', REQUESTS],
      ['post', APPROVE],
      ['get', LIST],
      ['patch', STATUS],
    ] as const)('refuses %s %s with 401, and reaches no service', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ reason: 'x' });

      expect(response.status).toBe(401);
      for (const mock of Object.values(drivers)) expect(mock).not.toHaveBeenCalled();
    });
  });

  // ================================================================ 12 · reason ==

  describe('rejection needs a reason', () => {
    it.each([
      ['no body at all', undefined],
      ['an empty reason', { reason: '' }],
      ['whitespace only', { reason: '   ' }],
    ])('★ refuses %s, and reaches no service', async (_label, body) => {
      const response = await authed('post', REJECT).send(body);

      expect(response.status).toBe(422);
      // The refusal is at the boundary: nothing reached the decision path.
      expect(drivers.reject).not.toHaveBeenCalled();
    });

    it('accepts one that says something', async () => {
      await authed('post', REJECT).send({ reason: 'Chưa đủ hồ sơ.' }).expect(200);

      expect(drivers.reject).toHaveBeenCalledWith({
        requestId: REQUEST,
        decidedBy: BOSS,
        reason: 'Chưa đủ hồ sơ.',
      });
    });
  });

  // ============================================================ client inputs ==

  describe('★ the client decides nothing', () => {
    it('takes no requester from the body', async () => {
      asOperationsHead();
      await authed('post', REQUESTS).send({ ...newDriver, requestedBy: BOSS }).expect(201);

      // Read from the session, never the payload.
      expect(drivers.request).toHaveBeenCalledWith({ ...newDriver, requestedBy: OPS_HEAD });
    });

    it('takes no actor from the body of a status change', async () => {
      await authed('patch', STATUS).send({ status: 'disabled', actingUserId: MEMBER }).expect(200);

      expect(drivers.setStatus).toHaveBeenCalledWith({ userId: MANAGED, status: 'disabled', actingUserId: BOSS });
    });

    it('refuses a malformed driver id on the management routes', async () => {
      await authed('get', `${LIST}/not-a-uuid`).expect(422);
      await authed('patch', `${LIST}/not-a-uuid/status`).send({ status: 'disabled' }).expect(422);
      expect(drivers.get).not.toHaveBeenCalled();
      expect(drivers.setStatus).not.toHaveBeenCalled();
    });

    it('takes no decider from the body', async () => {
      await authed('post', APPROVE).send({ decidedBy: OPS_HEAD }).expect(200);

      expect(drivers.approve).toHaveBeenCalledWith({ requestId: REQUEST, decidedBy: BOSS });
    });

    it('refuses a malformed request id', async () => {
      const response = await authed('post', `${REQUESTS}/not-a-uuid/approve`);

      expect(response.status).toBe(422);
      expect(drivers.approve).not.toHaveBeenCalled();
    });
  });
});
