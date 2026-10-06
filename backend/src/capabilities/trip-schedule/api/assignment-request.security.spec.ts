import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { PermissionGuard } from '../../../core/authorization/api/permission.guard';
import { ProvisionedAccountGuard } from '../../../core/authorization/api/provisioned-account.guard';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import type { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { DriverOnlyGuard } from '../../../core/identity/api/driver-only.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import type { AccountType } from '../../../core/users/domain/user.entity';
import type { DepartmentFunction } from '../../../core/organization/domain/department.entity';
import { AssignmentRequestReviewService } from '../application/assignment-request-review.service';
import { DriverAssignmentRequestService } from '../application/driver-assignment-request.service';
import { AssignmentRequestController } from './assignment-request.controller';
import { DriverOpenBookingController } from './driver-open-booking.controller';

/**
 * Open bookings and drivers' asks, over HTTP (0035).
 *
 * ★ THE POLICY THIS FILE PINS. Reviewing an ask is DISPATCH: `dispatch.write`,
 * held globally or by the dispatch function — never by sales, accounting or
 * customer service, who book runs but do not decide who drives them. Asking
 * is a DRIVER's, as themselves: the id is the session's, never the request's.
 */
describe('open booking HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const TRIP = '55555555-5555-5555-5555-555555555555';
  const REQUEST = '99999999-9999-4999-8999-999999999999';
  const VEHICLE = '77777777-7777-4777-8777-777777777777';

  let app: INestApplication;
  let context: AuthorizationContext;
  let accountType: AccountType;
  let review: Record<'listPending' | 'listForTrip' | 'approve' | 'reject', jest.Mock>;
  let asks: Record<'listOpenBookings' | 'listMine' | 'request' | 'withdraw', jest.Mock>;

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
    review = {
      listPending: jest.fn().mockResolvedValue([]),
      listForTrip: jest.fn().mockResolvedValue([]),
      approve: jest.fn().mockResolvedValue({ id: REQUEST, state: 'approved' }),
      reject: jest.fn().mockResolvedValue({ id: REQUEST, state: 'rejected' }),
    };
    asks = {
      listOpenBookings: jest.fn().mockResolvedValue([]),
      listMine: jest.fn().mockResolvedValue([]),
      request: jest.fn().mockResolvedValue({ id: REQUEST, state: 'pending' }),
      withdraw: jest.fn().mockResolvedValue({ id: REQUEST, state: 'withdrawn' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AssignmentRequestController, DriverOpenBookingController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        DriverOnlyGuard,
        ProvisionedAccountGuard,
        { provide: AssignmentRequestReviewService, useValue: review },
        { provide: DriverAssignmentRequestService, useValue: asks },
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

  const authed = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`).set('X-Requested-With', 'XMLHttpRequest');

  const APPROVE = `/trip-schedules/${TRIP}/assignment-requests/${REQUEST}/approve`;
  const REJECT = `/trip-schedules/${TRIP}/assignment-requests/${REQUEST}/reject`;
  const REVIEW = [
    ['get', '/assignment-request-queue'],
    ['get', `/trip-schedules/${TRIP}/assignment-requests`],
    ['post', APPROVE],
    ['post', REJECT],
  ] as const;

  describe('Dispatch review — dispatch.write', () => {
    it.each(['sales', 'accounting', 'customer_service'] as const)(
      '★ refuses the %s function every review route, reads included',
      async (fn: DepartmentFunction) => {
        context = asContext({ memberOf: ['d1'], headOf: ['d1'], functions: [fn] });
        for (const [method, path] of REVIEW) {
          const response = await authed(method, path).send({ vehicleId: VEHICLE });
          expect([path, response.status]).toEqual([path, 403]);
        }
        expect(review.approve).not.toHaveBeenCalled();
      },
    );

    it('admits the dispatch function, member or head, and a global administrator', async () => {
      for (const ctx of [asContext({ memberOf: ['d1'], functions: ['dispatch'] }), asContext({ global: true })]) {
        context = ctx;
        expect((await authed('get', '/assignment-request-queue')).status).toBe(200);
        expect((await authed('post', APPROVE).send({ vehicleId: VEHICLE })).status).toBe(200);
      }
      expect(review.approve).toHaveBeenCalledWith(TRIP, REQUEST, VEHICLE, ACTOR);
    });

    it('★ refuses an approval that names no lorry, before the service runs', async () => {
      const response = await authed('post', APPROVE).send({});
      expect(response.status).toBe(422);
      expect(review.approve).not.toHaveBeenCalled();
    });

    it('refuses a write without the CSRF header, and a driver account outright', async () => {
      const noCsrf = await request(app.getHttpServer()).post(REJECT).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`).send({});
      expect(noCsrf.status).toBe(403);
      accountType = 'driver';
      context = asContext();
      expect((await authed('get', '/assignment-request-queue')).status).toBe(403);
    });

    it('passes an optional rejection reason through', async () => {
      await authed('post', REJECT).send({ reason: 'Đã có xe khác' });
      expect(review.reject).toHaveBeenCalledWith(TRIP, REQUEST, 'Đã có xe khác', ACTOR);
    });
  });

  describe('Driver asks — driver accounts only, as themselves', () => {
    beforeEach(() => {
      accountType = 'driver';
      context = asContext();
    });

    it('★ asks and withdraws as the SESSION driver, whatever the body says', async () => {
      await authed('post', `/driver/open-bookings/${TRIP}/requests`).send({ driverUserId: 'someone-else' });
      await authed('post', `/driver/assignment-requests/${REQUEST}/withdraw`).send({ driverUserId: 'someone-else' });
      expect(asks.request).toHaveBeenCalledWith(TRIP, ACTOR);
      expect(asks.withdraw).toHaveBeenCalledWith(REQUEST, ACTOR);
    });

    it('reads only the caller’s own lists', async () => {
      expect((await authed('get', '/driver/open-bookings')).status).toBe(200);
      expect((await authed('get', '/driver/assignment-requests')).status).toBe(200);
      expect(asks.listOpenBookings).toHaveBeenCalledWith(ACTOR);
      expect(asks.listMine).toHaveBeenCalledWith(ACTOR);
    });

    it('refuses an employee account, and a driver still holding a temporary credential', async () => {
      accountType = 'employee';
      expect((await authed('get', '/driver/open-bookings')).status).toBe(403);
      accountType = 'driver';
      context = asContext({ mustChangeSecret: true });
      expect((await authed('get', '/driver/open-bookings')).status).toBe(403);
    });

    it('refuses an ask without the CSRF header', async () => {
      const response = await request(app.getHttpServer())
        .post(`/driver/open-bookings/${TRIP}/requests`)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
      expect(response.status).toBe(403);
      expect(asks.request).not.toHaveBeenCalled();
    });
  });
});
