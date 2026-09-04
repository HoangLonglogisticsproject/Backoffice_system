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
    listAccounts: jest.Mock;
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
      listAccounts: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
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

  const authed = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  const CREATE = '/driver-accounts';
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

    it('★ reads the driver roster — the one list that shows an account exists', async () => {
      await authed('get', CREATE).expect(200);

      expect(drivers.listAccounts).toHaveBeenCalledWith(
        { accountStatus: undefined },
        expect.objectContaining({ limit: expect.any(Number) }),
      );
    });

    it('passes the status filter through to the server, unfiltered by default', async () => {
      await authed('get', `${CREATE}?status=disabled`).expect(200);

      const [filter] = drivers.listAccounts.mock.calls[0] as [{ accountStatus?: string }];
      expect(filter.accountStatus).toBe('disabled');
    });

    it('refuses a status that is not one of the two, and reaches no service', async () => {
      const response = await authed('get', `${CREATE}?status=retired`);

      expect(response.status).toBe(422);
      expect(drivers.listAccounts).not.toHaveBeenCalled();
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

    it('★ may not read the driver roster either — it is account administration', async () => {
      // A head can propose a driver and see what came of their own proposal.
      // Who holds a driver account deployment-wide is a different question, and
      // it is the administrator's.
      const response = await authed('get', CREATE);

      expect(response.status).toBe(403);
      expect(drivers.listAccounts).not.toHaveBeenCalled();
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

    it('may not list who holds a driver account', async () => {
      const response = await authed('get', CREATE);

      expect(response.status).toBe(403);
      expect(drivers.listAccounts).not.toHaveBeenCalled();
    });
  });

  // ================================================================= 14 · driver ==

  describe('★ a driver account, holding the Backoffice URLs', () => {
    beforeEach(() => asDriver());

    it.each([
      ['post', CREATE],
      ['get', CREATE],
      ['post', REQUESTS],
      ['get', REQUESTS],
      ['get', `${REQUESTS}/mine`],
      ['post', APPROVE],
      ['post', REJECT],
    ] as const)('refuses %s %s with 403, and reaches no service', async (method, path) => {
      const response = await authed(method, path).send({ reason: 'x' });

      expect(response.status).toBe(403);
      for (const mock of Object.values(drivers)) expect(mock).not.toHaveBeenCalled();
    });
  });

  // ============================================================== anonymous ==

  describe('without authentication', () => {
    it.each([
      ['post', CREATE],
      ['get', CREATE],
      ['post', REQUESTS],
      ['get', REQUESTS],
      ['post', APPROVE],
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
