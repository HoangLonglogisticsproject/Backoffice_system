import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { PermissionGuard } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { TripCostService } from '../application/trip-cost.service';
import { TripCostController } from './trip-cost.controller';

/**
 * The money on a trip, over HTTP.
 *
 * ★ THE POLICY THIS FILE PINS DOWN. The board is read by everybody
 * (`trip.read` is `'any'`), and the money on it is not. That asymmetry is the
 * entire reason cost has its own controller and its own permissions, and it is
 * one decorator away from being wrong — so every route is asserted for every
 * caller shape rather than trusted to review.
 *
 * ⚠ `cost.*` IS `'global'` FOR NOW, WHICH IS A PLACEHOLDER AND NOT A FINISHED
 * ANSWER. Which holders should see prices is a role-mapping decision nobody has
 * taken; until it is taken this fails CLOSED, because a tier that is too tight
 * blocks work while a tier that is too loose has already disclosed the figures.
 * These cases encode the current answer so that widening it later is a visible,
 * deliberate edit rather than a quiet drift.
 */
describe('trip-cost HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const DEPT = '11111111-1111-1111-1111-111111111111';
  const TRIP = '55555555-5555-5555-5555-555555555555';
  const COST = '88888888-8888-8888-8888-888888888888';
  const HIRE = '99999999-9999-9999-9999-999999999999';

  let money: {
    createCost: jest.Mock;
    listCosts: jest.Mock;
    voidCost: jest.Mock;
    createHire: jest.Mock;
    listHires: jest.Mock;
    voidHire: jest.Mock;
    summary: jest.Mock;
  };

  let app: INestApplication;
  let context: AuthorizationContext;

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  const storedCost = {
    id: COST,
    tripId: TRIP,
    category: 'fuel',
    amount: '1500000.00',
    note: null,
    createdBy: ACTOR,
    createdAt: new Date('2026-08-04T02:00:00Z'),
    createdByUser: { id: ACTOR, displayName: 'Kế Toán' },
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };

  const storedHire = {
    id: HIRE,
    tripId: TRIP,
    carrierName: 'Hai Thành',
    agreedAmount: '4500000.00',
    amountIncludesVat: false,
    documentRef: null,
    note: null,
    createdBy: ACTOR,
    createdAt: new Date('2026-08-04T02:00:00Z'),
    createdByUser: { id: ACTOR, displayName: 'Kế Toán' },
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };

  beforeEach(async () => {
    context = asContext({ global: true });

    money = {
      createCost: jest.fn().mockResolvedValue(storedCost),
      listCosts: jest.fn().mockResolvedValue({ items: [storedCost], total: '1500000.00' }),
      voidCost: jest.fn().mockResolvedValue({ ...storedCost, voidedAt: new Date() }),
      createHire: jest.fn().mockResolvedValue(storedHire),
      listHires: jest.fn().mockResolvedValue({ items: [storedHire], total: '4500000.00' }),
      voidHire: jest.fn().mockResolvedValue({ ...storedHire, voidedAt: new Date() }),
      summary: jest
        .fn()
        .mockResolvedValue({ costs: '1500000.00', hires: '4500000.00', combined: '6000000.00' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripCostController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: TripCostService, useValue: money },
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

  const READ_ROUTES = [
    ['get', `/trip-schedules/${TRIP}/costs`],
    ['get', `/trip-schedules/${TRIP}/outsource-hires`],
    ['get', `/trip-schedules/${TRIP}/cost-summary`],
  ] as const;

  const WRITE_ROUTES = [
    ['post', `/trip-schedules/${TRIP}/costs`],
    ['post', `/trip-schedules/${TRIP}/outsource-hires`],
    ['post', `/trip-schedules/${TRIP}/costs/${COST}/void`],
    ['post', `/trip-schedules/${TRIP}/outsource-hires/${HIRE}/void`],
  ] as const;

  const ALL_ROUTES = [...READ_ROUTES, ...WRITE_ROUTES];

  const anyBody = {
    category: 'fuel',
    amount: '1000',
    carrierName: 'Hai Thành',
    agreedAmount: '1000',
    reason: 'sai',
  };

  describe('without authentication', () => {
    it.each(ALL_ROUTES)('refuses %s %s', async (method, path) => {
      const response = await request(app.getHttpServer())[method](path).send(anyBody);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('calls nothing on the service', async () => {
      await request(app.getHttpServer()).get(`/trip-schedules/${TRIP}/costs`).expect(401);
      expect(money.listCosts).not.toHaveBeenCalled();
    });
  });

  describe('a caller who has not replaced their temporary credential', () => {
    beforeEach(() => {
      context = asContext({ global: true, mustChangeSecret: true });
    });

    it.each(ALL_ROUTES)('★ refuses %s %s even though the caller is global', async (method, path) => {
      // `PermissionGuard` is the only place `mustChangeSecret` is refused, which
      // is why every route here runs it — including the reads.
      const response = await authed(method, path).send(anyBody);
      expect(response.status).toBe(403);
      expect(money.listCosts).not.toHaveBeenCalled();
      expect(money.createCost).not.toHaveBeenCalled();
    });
  });

  describe('CSRF', () => {
    it.each(WRITE_ROUTES)('refuses %s %s without the header', async (method, path) => {
      await request(app.getHttpServer())
        [method](path)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .send(anyBody)
        .expect(403);

      expect(money.createCost).not.toHaveBeenCalled();
      expect(money.voidCost).not.toHaveBeenCalled();
    });
  });

  describe('★ an ordinary member sees no money at all', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [DEPT] });
    });

    it.each(ALL_ROUTES)('refuses %s %s', async (method, path) => {
      const response = await authed(method, path).send(anyBody);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('reaches the service on none of them', async () => {
      for (const [method, path] of ALL_ROUTES) await authed(method, path).send(anyBody);
      for (const call of Object.values(money)) expect(call).not.toHaveBeenCalled();
    });
  });

  describe('★ a caller with no relations at all sees no money', () => {
    beforeEach(() => {
      // Authenticated, provisioning finished, and holding nothing: no
      // membership, no head assignment, no global. The shape a new employee
      // has on their first day.
      context = asContext();
    });

    it.each(ALL_ROUTES)('refuses %s %s', async (method, path) => {
      const response = await authed(method, path).send(anyBody);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('★ a department head sees no money either — cost is not `head-anywhere`', () => {
    beforeEach(() => {
      // The tier that lets a head correct the BOARD deliberately does not let
      // them read the company's cost base.
      context = asContext({ headOf: [DEPT], memberOf: [DEPT] });
    });

    it.each(ALL_ROUTES)('refuses %s %s', async (method, path) => {
      expect((await authed(method, path).send(anyBody)).status).toBe(403);
    });
  });

  describe('a global administrator', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('reads the cost lines and their total', async () => {
      const response = await authed('get', `/trip-schedules/${TRIP}/costs`).expect(200);
      expect(response.body.total).toBe('1500000.00');
      // ★ A STRING ON THE WIRE. A number here would already have gone through
      // float64 and lost the precision NUMERIC(14,2) exists to keep.
      expect(typeof response.body.items[0].amount).toBe('string');
    });

    it('reads the three totals from one call', async () => {
      const response = await authed('get', `/trip-schedules/${TRIP}/cost-summary`).expect(200);
      expect(response.body).toEqual({
        costs: '1500000.00',
        hires: '4500000.00',
        combined: '6000000.00',
      });
    });

    it('records a cost line, and the row records the SESSION as its author', async () => {
      await authed('post', `/trip-schedules/${TRIP}/costs`)
        .send({ category: 'toll', amount: '250000', createdBy: 'somebody-else' })
        .expect(201);

      expect(money.createCost).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP, category: 'toll', amount: '250000', createdBy: ACTOR }),
      );
      // A body that names its own author is a body that can name somebody else's.
      expect(money.createCost.mock.calls[0][0]).not.toHaveProperty('createdBy', 'somebody-else');
    });

    it('records an outsourced hire', async () => {
      await authed('post', `/trip-schedules/${TRIP}/outsource-hires`)
        .send({ carrierName: 'xe Út', agreedAmount: '3000000', amountIncludesVat: true })
        .expect(201);

      expect(money.createHire).toHaveBeenCalledWith(
        expect.objectContaining({ carrierName: 'xe Út', agreedAmount: '3000000', amountIncludesVat: true }),
      );
    });

    it('voids with a reason, and gets the withdrawn record back', async () => {
      const response = await authed('post', `/trip-schedules/${TRIP}/costs/${COST}/void`)
        .send({ reason: 'nhập nhầm' })
        .expect(200);

      expect(money.voidCost).toHaveBeenCalledWith(TRIP, COST, { by: ACTOR, reason: 'nhập nhầm' });
      expect(response.body.voidedAt).toBeDefined();
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it.each([['0'], ['-1'], ['abc'], ['1.234'], ['']])(
      'refuses the amount %p before it reaches the service',
      async (amount) => {
        await authed('post', `/trip-schedules/${TRIP}/costs`)
          .send({ category: 'fuel', amount })
          .expect(422);
        expect(money.createCost).not.toHaveBeenCalled();
      },
    );

    it('★ refuses an amount sent as a JSON number', async () => {
      // JSON numbers are float64. Accepting one would mean 1500000.01 arriving
      // as something a little else, with nothing to show it had changed.
      await authed('post', `/trip-schedules/${TRIP}/costs`)
        .send({ category: 'fuel', amount: 1500000.01 })
        .expect(422);
      expect(money.createCost).not.toHaveBeenCalled();
    });

    it.each([['other'], ['allowance'], ['FUEL'], ['']])(
      'refuses the category %p',
      async (category) => {
        await authed('post', `/trip-schedules/${TRIP}/costs`)
          .send({ category, amount: '1000' })
          .expect(422);
        expect(money.createCost).not.toHaveBeenCalled();
      },
    );

    it('★ accepts a void with no reason — the body may be empty', async () => {
      // 0020: withdrawing is a confirmation, not a form. An empty body is the
      // ordinary case, not a malformed request.
      await authed('post', `/trip-schedules/${TRIP}/costs/${COST}/void`).send({}).expect(200);
      expect(money.voidCost).toHaveBeenCalledWith(TRIP, COST, { by: ACTOR, reason: undefined });
    });

    it('★ refuses a reason longer than the column allows', async () => {
      await authed('post', `/trip-schedules/${TRIP}/costs/${COST}/void`)
        .send({ reason: 'x'.repeat(501) })
        .expect(422);
      expect(money.voidCost).not.toHaveBeenCalled();
    });

    it('answers 422 for a malformed trip id', async () => {
      const response = await authed('get', '/trip-schedules/not-a-uuid/costs');

      expect(response.status).toBe(422);
      expect(money.listCosts).not.toHaveBeenCalled();
    });

    it('refuses includeVoided=false being read as true', async () => {
      await authed('get', `/trip-schedules/${TRIP}/costs?includeVoided=false`).expect(200);
      expect(money.listCosts).toHaveBeenCalledWith(TRIP, false);
    });

    it('passes includeVoided=true through', async () => {
      await authed('get', `/trip-schedules/${TRIP}/costs?includeVoided=true`).expect(200);
      expect(money.listCosts).toHaveBeenCalledWith(TRIP, true);
    });

    it('refuses any other spelling of includeVoided', async () => {
      const response = await authed('get', `/trip-schedules/${TRIP}/costs?includeVoided=yes`);

      expect(response.status).toBe(422);
      expect(money.listCosts).not.toHaveBeenCalled();
    });
  });

  describe('★ there is no way to edit a financial record', () => {
    it.each([
      ['patch', `/trip-schedules/${TRIP}/costs/${COST}`],
      ['put', `/trip-schedules/${TRIP}/costs/${COST}`],
      ['delete', `/trip-schedules/${TRIP}/costs/${COST}`],
      ['patch', `/trip-schedules/${TRIP}/outsource-hires/${HIRE}`],
      ['delete', `/trip-schedules/${TRIP}/outsource-hires/${HIRE}`],
    ] as const)('%s %s does not exist', async (method, path) => {
      // A correction is a void plus a new record. No route offers anything else,
      // and this fails loudly if one is ever added.
      const response = await request(app.getHttpServer())
        [method](path)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ amount: '1' });

      expect(response.status).toBe(404);
      // Nothing on the service is reachable by these verbs.
      for (const call of Object.values(money)) expect(call).not.toHaveBeenCalled();
    });
  });
});
