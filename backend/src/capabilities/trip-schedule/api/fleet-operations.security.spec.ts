import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { PermissionGuard } from '../../../core/authorization/api/permission.guard';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import type { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import type { DepartmentFunction } from '../../../core/organization/domain/department.entity';
import type { AccountType } from '../../../core/users/domain/user.entity';
import { FleetOperationsService } from '../application/fleet-operations.service';
import { FleetOperationsController } from './fleet-operations.controller';

/**
 * "Điều hành xe" over HTTP.
 *
 * ★ THE POLICY THIS FILE PINS. Reading the board is `dispatch.write`: the
 * global tier and the dispatch function, head or member. Sales, Accounting and
 * Customer Service hold `trip.read` and still read Lịch xe — but not this
 * board, whose fuel facts no route ever showed them. The money on it is
 * `cost.read`, which only the global tier holds, so a dispatcher reads the
 * board without a single amount.
 */
describe('fleet operations HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const ACTOR = '33333333-3333-3333-3333-333333333333';

  let app: INestApplication;
  let context: AuthorizationContext;
  let accountType: AccountType;
  let fleet: { board: jest.Mock };

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    functions: [],
    mustChangeSecret: false,
    ...over,
  });

  beforeEach(async () => {
    context = asContext({ global: true });
    accountType = 'employee';
    fleet = { board: jest.fn().mockResolvedValue({ businessDate: '2026-10-06', vehicles: [] }) };

    const moduleRef = await Test.createTestingModule({
      controllers: [FleetOperationsController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        BackofficeOnlyGuard,
        { provide: FleetOperationsService, useValue: fleet },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest.fn().mockImplementation(async () => ({
              id: ACTOR,
              displayName: 'Someone',
              status: 'active',
              accountType,
            })),
          },
        },
        { provide: AuthorizationService, useValue: { loadContext: jest.fn().mockImplementation(async () => context) } },
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

  const read = (path = '/fleet-operations') =>
    request(app.getHttpServer()).get(path).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`).set('X-Requested-With', 'XMLHttpRequest');

  it('★ the global tier reads the board WITH the money', async () => {
    await read().expect(200);
    expect(fleet.board).toHaveBeenCalledWith({ day: undefined, withMoney: true });
  });

  it('★ the dispatch function reads the board, member or head, WITHOUT the money', async () => {
    for (const ctx of [
      asContext({ memberOf: ['d1'], functions: ['dispatch'] }),
      asContext({ memberOf: ['d1'], headOf: ['d1'], functions: ['dispatch'] }),
    ]) {
      context = ctx;
      await read().expect(200);
      expect(fleet.board).toHaveBeenLastCalledWith({ day: undefined, withMoney: false });
    }
  });

  it.each(['sales', 'accounting', 'customer_service'] as const)(
    '★ refuses the %s function, member or head — trip.read is not this board',
    async (fn: DepartmentFunction) => {
      for (const ctx of [
        asContext({ memberOf: ['d1'], functions: [fn] }),
        asContext({ memberOf: ['d1'], headOf: ['d1'], functions: [fn] }),
      ]) {
        context = ctx;
        const response = await read();
        expect([fn, response.status, response.body.error?.code]).toEqual([fn, 403, 'FORBIDDEN']);
      }
      expect(fleet.board).not.toHaveBeenCalled();
    },
  );

  it('refuses a department with no function, and a driver account outright', async () => {
    context = asContext({ memberOf: ['d1'], headOf: ['d1'], functions: [] });
    expect((await read()).status).toBe(403);
    accountType = 'driver';
    context = asContext({ global: true });
    expect((await read()).status).toBe(403);
    expect(fleet.board).not.toHaveBeenCalled();
  });

  it('refuses an anonymous caller and a temporary credential', async () => {
    expect((await request(app.getHttpServer()).get('/fleet-operations')).status).toBe(401);
    context = asContext({ global: true, mustChangeSecret: true });
    expect((await read()).status).toBe(403);
    expect(fleet.board).not.toHaveBeenCalled();
  });

  it('takes a real business date, and refuses anything else before the service runs', async () => {
    await read('/fleet-operations?date=2026-10-05').expect(200);
    expect(fleet.board).toHaveBeenCalledWith({ day: '2026-10-05', withMoney: true });
    for (const date of ['2026-02-30', '06/10/2026', 'today']) {
      expect([date, (await read(`/fleet-operations?date=${date}`)).status]).toEqual([date, 422]);
    }
    expect(fleet.board).toHaveBeenCalledTimes(1);
  });
});
