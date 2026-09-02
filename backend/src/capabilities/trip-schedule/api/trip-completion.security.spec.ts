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
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { TripCompletionService } from '../application/trip-completion.service';
import { TripCompletionController } from './trip-completion.controller';

/**
 * Completion review, over HTTP.
 *
 * ★ THE POLICY THIS FILE PINS DOWN. Closing a trip is the one act with no undo:
 * it freezes the money and a trigger makes `done` permanent. So it is reserved
 * to `trip.complete.review`, which is `'global'`, while merely READING the
 * attempts rides on `trip.read` like the rest of the board.
 *
 * ⚠ AND IT IS DELIBERATELY NOT `trip.write`. A dispatcher correcting a delivery
 * address and a reviewer closing a trip's books are different acts; sharing a
 * key would mean the narrower one could never be granted without the wider.
 * These cases are what stop that being quietly "simplified" later.
 */
describe('trip-completion HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const DEPT = '11111111-1111-1111-1111-111111111111';
  const TRIP = '55555555-5555-5555-5555-555555555555';

  let app: INestApplication;
  let context: AuthorizationContext;
  let completion: { listRequests: jest.Mock; approve: jest.Mock; reject: jest.Mock };

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  beforeEach(async () => {
    context = asContext({ global: true });

    completion = {
      listRequests: jest.fn().mockResolvedValue([]),
      approve: jest.fn().mockResolvedValue({ id: 'request-1', state: 'approved' }),
      reject: jest.fn().mockResolvedValue({ id: 'request-1', state: 'rejected' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripCompletionController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: TripCompletionService, useValue: completion },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ id: ACTOR, displayName: 'SuperAdmin', status: 'active' }),
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

  const APPROVE = `/trip-schedules/${TRIP}/completion-requests/approve`;
  const REJECT = `/trip-schedules/${TRIP}/completion-requests/reject`;
  const LIST = `/trip-schedules/${TRIP}/completion-requests`;

  const DECISIONS = [
    ['post', APPROVE],
    ['post', REJECT],
  ] as const;

  const anyBody = { reason: 'Thiếu chứng từ dầu.' };

  describe('without authentication', () => {
    it.each([['get', LIST], ...DECISIONS] as const)(
      'refuses %s %s, and reaches no service',
      async (method, path) => {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('X-Requested-With', 'XMLHttpRequest')
          .send(anyBody);

        expect(response.status).toBe(401);

        // ★ THE SAME TEST CASE AS THE REQUEST, DELIBERATELY.
        //
        // This lived in an `it` of its own and asserted nothing at all:
        // `beforeEach` mints a fresh set of `jest.fn()`s for EVERY test, so by
        // the time that case ran it held mocks no request had ever touched.
        // `not.toHaveBeenCalled()` on a brand-new mock is true by construction
        // — it would have passed just as happily with the guard removed and
        // the service called on every anonymous request.
        //
        // Asserting here, against the instance THIS request was served by, is
        // what makes it evidence: the refusal happened before the controller
        // body, not after it did the work and threw the answer away.
        for (const mock of Object.values(completion)) expect(mock).not.toHaveBeenCalled();
      },
    );
  });

  describe('a global administrator', () => {
    it('approves', async () => {
      await authed('post', APPROVE).expect(200);
      expect(completion.approve).toHaveBeenCalledWith(TRIP, ACTOR);
    });

    it('rejects with a reason', async () => {
      await authed('post', REJECT).send(anyBody).expect(200);
      expect(completion.reject).toHaveBeenCalledWith(TRIP, {
        by: ACTOR,
        reason: 'Thiếu chứng từ dầu.',
      });
    });

    it('lists the attempts', async () => {
      await authed('get', LIST).expect(200);
      expect(completion.listRequests).toHaveBeenCalledWith(TRIP);
    });
  });

  describe('★ a department head — the tier that must NOT be enough', () => {
    beforeEach(() => {
      // Holds `trip.write` (head-anywhere) and could edit any trip on the
      // board. Closing one is a different authority.
      context = asContext({ headOf: [DEPT], memberOf: [DEPT] });
    });

    it.each(DECISIONS)('refuses %s %s with 403', async (method, path) => {
      const response = await authed(method, path).send(anyBody);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('reaches neither decision', async () => {
      for (const [method, path] of DECISIONS) await authed(method, path).send(anyBody);

      expect(completion.approve).not.toHaveBeenCalled();
      expect(completion.reject).not.toHaveBeenCalled();
    });

    it('★ may still READ the attempts, which are dispatch information', async () => {
      // `trip.read` is `'any'`. The list carries a declaration word and a
      // rejection reason, never an amount.
      await authed('get', LIST).expect(200);
    });
  });

  describe('an ordinary member', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [DEPT] });
    });

    it.each(DECISIONS)('refuses %s %s', async (method, path) => {
      await authed(method, path).send(anyBody).expect(403);
    });
  });

  describe('a caller who has not replaced their temporary credential', () => {
    beforeEach(() => {
      context = asContext({ global: true, mustChangeSecret: true });
    });

    it.each([['get', LIST], ...DECISIONS] as const)(
      '★ refuses %s %s even for a SuperAdmin',
      async (method, path) => {
        const response = await authed(method, path).send(anyBody);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      },
    );
  });

  describe('without the CSRF header', () => {
    it.each(DECISIONS)('refuses %s %s', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .send(anyBody);

      expect(response.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('★ refuses a rejection with no reason', async () => {
      // Third of three places this is enforced — DTO, service, and a CHECK the
      // row cannot exist without. A driver told only "rejected" cannot act.
      await authed('post', REJECT).send({}).expect(422);
      expect(completion.reject).not.toHaveBeenCalled();
    });

    it('refuses a reason that is only whitespace', async () => {
      await authed('post', REJECT).send({ reason: '   ' }).expect(422);
    });

    it('takes no decider from the body', async () => {
      await authed('post', APPROVE).send({ decidedBy: 'somebody-else' }).expect(200);
      expect(completion.approve).toHaveBeenCalledWith(TRIP, ACTOR);
    });

    it('refuses a malformed trip id', async () => {
      await authed('post', '/trip-schedules/not-a-uuid/completion-requests/approve').expect(422);
    });
  });
});
