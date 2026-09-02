import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { DriverPortalService } from '../application/driver-portal.service';
import { TripCompletionService } from '../application/trip-completion.service';
import { TripCostService } from '../application/trip-cost.service';
import { TripExecutionService } from '../application/trip-execution.service';
import { DriverAssignmentRepository } from '../persistence/trip-execution.repository';
import { ActiveAssignmentGuard } from './active-assignment.guard';
import { DriverPortalController } from './driver-portal.controller';

/**
 * The Driver Portal, over HTTP.
 *
 * ★ THE ONE PROPERTY THIS FILE EXISTS TO PIN DOWN:
 *
 *   Driver A cannot touch Trip B, EVEN KNOWING ITS ID.
 *
 * Every other guarantee in this capability is enforced by a database
 * constraint that a test can be written against later. This one is enforced by
 * a decorator, and a decorator is one careless edit from being absent. So every
 * route is asserted for every caller shape, including the shapes that ought
 * obviously to fail.
 *
 * ⚠ NO ROUTE HERE DECLARES A PERMISSION, and that is not an omission — it is
 * the finding. No tier the system has can express "the driver assigned to this
 * trip"; the available keys would either say nothing (`trip.read` is `'any'`)
 * or say far too much (`trip.write` is `head-anywhere`, `cost.*` is `global`).
 * `ActiveAssignmentGuard` asks the only question that matters, and these cases
 * are what stop it being quietly replaced by a decorator that looks tidier.
 */
describe('driver-portal HTTP security', () => {
  const TOKEN = 'a-session-token-value';

  /** The caller. */
  const DRIVER_A = '33333333-3333-3333-3333-333333333333';
  /** Somebody else, driving something else. */
  const DRIVER_B = '44444444-4444-4444-4444-444444444444';

  /** Assigned to driver A. */
  const TRIP_A = '55555555-5555-5555-5555-555555555555';
  /** Assigned to driver B. A knows this id — that is the premise. */
  const TRIP_B = '66666666-6666-6666-6666-666666666666';
  /** Real, on the board, and nobody is driving it. */
  const TRIP_UNASSIGNED = '77777777-7777-7777-7777-777777777777';

  const COST = '88888888-8888-8888-8888-888888888888';

  let app: INestApplication;
  let context: AuthorizationContext;

  let portal: { listMyTrips: jest.Mock; findMyTrip: jest.Mock };
  let execution: { recordEvent: jest.Mock };
  let money: { declareCost: jest.Mock; editCost: jest.Mock };
  let completion: { submit: jest.Mock };
  let assignments: { findActive: jest.Mock };

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: DRIVER_A,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  beforeEach(async () => {
    context = asContext();

    portal = {
      listMyTrips: jest.fn().mockResolvedValue([]),
      findMyTrip: jest.fn().mockResolvedValue({ tripId: TRIP_A }),
    };
    execution = { recordEvent: jest.fn().mockResolvedValue({ id: 'event-1' }) };
    money = {
      declareCost: jest.fn().mockResolvedValue({ id: COST }),
      editCost: jest.fn().mockResolvedValue({ id: COST }),
    };
    completion = { submit: jest.fn().mockResolvedValue({ id: 'request-1', attemptNo: 1 }) };

    // The real assignment table, faked at its edge: TRIP_A belongs to driver A,
    // TRIP_B to driver B, and TRIP_UNASSIGNED to nobody.
    assignments = {
      findActive: jest.fn().mockImplementation(async (tripId: string) => {
        if (tripId === TRIP_A) return { id: 'assignment-a', tripId, driverUserId: DRIVER_A };
        if (tripId === TRIP_B) return { id: 'assignment-b', tripId, driverUserId: DRIVER_B };
        return null;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DriverPortalController],
      providers: [
        Reflector,
        AuthGuard,
        CsrfGuard,
        ActiveAssignmentGuard,
        { provide: DriverPortalService, useValue: portal },
        { provide: TripExecutionService, useValue: execution },
        { provide: TripCostService, useValue: money },
        { provide: TripCompletionService, useValue: completion },
        { provide: DriverAssignmentRepository, useValue: assignments },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ id: DRIVER_A, displayName: 'Tài Xế A', status: 'active' }),
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

  type Route = [method: 'get' | 'post' | 'patch', path: string];

  /** Every route that names a trip, parameterised by which trip. */
  const scopedRoutes = (trip: string): Route[] =>
    [
      ['get', `/driver/trips/${trip}`],
      ['post', `/driver/trips/${trip}/execution-events`],
      ['post', `/driver/trips/${trip}/expenses`],
      ['patch', `/driver/trips/${trip}/expenses/${COST}`],
      ['post', `/driver/trips/${trip}/completion-requests`],
    ];

  /** A body valid enough for every route, so a 422 never masks a 403. */
  const anyBody = {
    type: 'ARRIVED_PICKUP',
    clientEventId: 'tap-1',
    category: 'fuel',
    amount: '1500000.00',
    expenseDeclaration: 'expenses',
  };

  const noWriteHappened = (): void => {
    for (const mock of [
      ...Object.values(portal),
      ...Object.values(execution),
      ...Object.values(money),
      ...Object.values(completion),
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
  };

  // ------------------------------------------------------------- anonymous --

  describe('without authentication', () => {
    it.each<Route>([['get', '/driver/trips'], ...scopedRoutes(TRIP_A)])(
      'refuses %s %s with 401, and reaches no service at all',
      async (method, path) => {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('X-Requested-With', 'XMLHttpRequest')
          .send(anyBody);

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('UNAUTHORIZED');

        // ★ IN THE SAME CASE AS THE REQUEST — see the sibling describe below,
        // which already had this right. `beforeEach` builds new mocks for each
        // test, so as a standalone case this asserted that objects created
        // seconds earlier had not been called: true no matter what the guards
        // do. Here it says what it means — this anonymous request reached no
        // service.
        noWriteHappened();
      },
    );
  });

  // ------------------------------------------- ★ ANOTHER DRIVER'S TRIP --

  describe("★ driver A, holding driver B's trip id", () => {
    it.each<Route>(scopedRoutes(TRIP_B))('refuses %s %s with 403', async (method, path) => {
      // The premise is that A KNOWS the id. Knowing it must buy nothing.
      const response = await authed(method, path).send(anyBody);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('reaches no service, so nothing is written and nothing is read', async () => {
      for (const [method, path] of scopedRoutes(TRIP_B)) {
        await authed(method, path).send(anyBody);
      }

      noWriteHappened();
    });

    it('★ answers the same way as a trip that does not exist', async () => {
      // Distinguishing "not yours" from "no such trip" would let a caller
      // holding only an id learn whether it exists and whether it is crewed —
      // information about work that is not theirs.
      const foreign = await authed('get', `/driver/trips/${TRIP_B}`).send();
      const missing = await authed('get', `/driver/trips/${TRIP_UNASSIGNED}`).send();

      expect(foreign.status).toBe(missing.status);
      expect(foreign.body.error.code).toBe(missing.body.error.code);
    });
  });

  describe('a trip nobody is driving', () => {
    it.each<Route>(scopedRoutes(TRIP_UNASSIGNED))('refuses %s %s with 403', async (method, path) => {
      const response = await authed(method, path).send(anyBody);
      expect(response.status).toBe(403);
    });
  });

  // ------------------------------------------------------- no global bypass --

  describe('★ a global administrator', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it.each<Route>(scopedRoutes(TRIP_B))('is refused %s %s like anybody else', async (method, path) => {
      // Not under-privileged — the WRONG ACTOR. The contract says an execution
      // event is raised by the driver and by nobody on their behalf, so there
      // is deliberately no `if (global)` escape in the guard.
      const response = await authed(method, path).send(anyBody);
      expect(response.status).toBe(403);
    });
  });

  // ------------------------------------------------- temporary credential --

  describe('a caller who has not replaced their temporary credential', () => {
    beforeEach(() => {
      context = asContext({ global: true, mustChangeSecret: true });
    });

    it.each<Route>(scopedRoutes(TRIP_A))(
      '★ refuses %s %s even on their OWN trip',
      async (method, path) => {
        // The reason the guard repeats this gate rather than assuming
        // PermissionGuard ran: on these routes it did not, and a
        // half-provisioned account would otherwise be reporting deliveries.
        const response = await authed(method, path).send(anyBody);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      },
    );
  });

  // ------------------------------------------------------------ CSRF --

  describe('without the CSRF header', () => {
    it.each<Route>(scopedRoutes(TRIP_A).filter(([method]) => method !== 'get'))(
      'refuses %s %s',
      async (method, path) => {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
          .send(anyBody);

        expect(response.status).toBe(403);
      },
    );
  });

  // ------------------------------------------------------ the driver's own --

  describe('driver A on driver A’s trip', () => {
    it('reads the trip', async () => {
      await authed('get', `/driver/trips/${TRIP_A}`).expect(200);
      expect(portal.findMyTrip).toHaveBeenCalledWith(TRIP_A, DRIVER_A);
    });

    it('lists their own trips from the session, with no parameter to widen it', async () => {
      await authed('get', '/driver/trips').expect(200);
      expect(portal.listMyTrips).toHaveBeenCalledWith(DRIVER_A);
    });

    it('records an execution event against the session user', async () => {
      await authed('post', `/driver/trips/${TRIP_A}/execution-events`)
        .send({ type: 'ARRIVED_PICKUP', clientEventId: 'tap-1' })
        .expect(201);

      expect(execution.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP_A, recordedBy: DRIVER_A }),
      );
    });

    it('declares an expense against the session user', async () => {
      await authed('post', `/driver/trips/${TRIP_A}/expenses`)
        .send({ category: 'fuel', amount: '1500000.00' })
        .expect(201);

      expect(money.declareCost).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP_A, declaredBy: DRIVER_A }),
      );
    });

    it('corrects an expense', async () => {
      await authed('patch', `/driver/trips/${TRIP_A}/expenses/${COST}`)
        .send({ amount: '1550000.00' })
        .expect(200);

      expect(money.editCost).toHaveBeenCalledWith(
        TRIP_A,
        COST,
        { amount: '1550000.00' },
        DRIVER_A,
      );
    });

    it('submits a completion carrying an explicit declaration', async () => {
      await authed('post', `/driver/trips/${TRIP_A}/completion-requests`)
        .send({ expenseDeclaration: 'none' })
        .expect(201);

      expect(completion.submit).toHaveBeenCalledWith(TRIP_A, DRIVER_A, 'none');
    });
  });

  // ---------------------------------------------------------- body vs route --

  describe('★ the body cannot widen what the route scoped', () => {
    it('ignores a tripId in the body of an execution event', async () => {
      // The guard checked the ROUTE. If the handler read the body instead, a
      // driver assigned to one trip could act on any other and the guard would
      // have checked something irrelevant.
      await authed('post', `/driver/trips/${TRIP_A}/execution-events`)
        .send({
          tripId: TRIP_B,
          type: 'ARRIVED_PICKUP',
          clientEventId: 'tap-1',
        })
        .expect(201);

      expect(execution.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP_A }),
      );
    });

    it('ignores a declaredBy in the body of an expense', async () => {
      await authed('post', `/driver/trips/${TRIP_A}/expenses`)
        .send({ category: 'fuel', amount: '1500000.00', declaredBy: DRIVER_B })
        .expect(201);

      expect(money.declareCost).toHaveBeenCalledWith(
        expect.objectContaining({ declaredBy: DRIVER_A }),
      );
    });

    it('ignores a recordedBy in the body of an execution event', async () => {
      await authed('post', `/driver/trips/${TRIP_A}/execution-events`)
        .send({
          type: 'ARRIVED_PICKUP',
          clientEventId: 'tap-1',
          recordedBy: DRIVER_B,
        })
        .expect(201);

      expect(execution.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ recordedBy: DRIVER_A }),
      );
    });
  });


  // ============================ the API is the boundary, not the interface ==

  describe('★ event order — the CONTROLLER forwards, the SERVICE decides', () => {
    /**
     * ⚠ THE PORTAL OFFERS ONE BUTTON AT A TIME. That is an interaction design,
     * not a security control — anybody can POST these routes in any order with
     * curl.
     *
     * ★ AND THE ROUTE DELIBERATELY HAS NO OPINION ABOUT ORDER. The rule lives
     * in the service, inside the transaction that already holds the trip row
     * lock, because "has an earlier milestone been reported" is a question
     * about OTHER rows and answering it here would be answering it against
     * state nothing is holding still. The cases below pin that division: the
     * controller passes every well-formed body through, and the integration
     * suite proves the service refuses the invalid ones.
     */
    const post = (type: string, clientEventId: string) =>
      authed('post', `/driver/trips/${TRIP_A}/execution-events`).send({ type, clientEventId });

    it('forwards PICKUP_CONFIRMED before ARRIVED_PICKUP, leaving the refusal to the service', async () => {
      await post('PICKUP_CONFIRMED', 'a').expect(201);

      expect(execution.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PICKUP_CONFIRMED' }),
      );
    });

    it('forwards DELIVERY_CONFIRMED before ARRIVED_DELIVERY', async () => {
      await post('DELIVERY_CONFIRMED', 'a').expect(201);
      await post('ARRIVED_DELIVERY', 'b').expect(201);

      expect(execution.recordEvent).toHaveBeenCalledTimes(2);
    });

    it('forwards the whole journey reported backwards', async () => {
      for (const [index, type] of [
        'DELIVERY_CONFIRMED',
        'ARRIVED_DELIVERY',
        'PICKUP_CONFIRMED',
        'ARRIVED_PICKUP',
      ].entries()) {
        await post(type, `tap-${index}`).expect(201);
      }

      expect(execution.recordEvent).toHaveBeenCalledTimes(4);
    });

    it('★ still refuses another driver’s trip, whatever the order', async () => {
      // The ordering question changes nothing about the resource boundary.
      await authed('post', `/driver/trips/${TRIP_B}/execution-events`)
        .send({ type: 'DELIVERY_CONFIRMED', clientEventId: 'a' })
        .expect(403);

      expect(execution.recordEvent).not.toHaveBeenCalled();
    });

    it('★ still refuses a body carrying its own timestamp', async () => {
      // The rule that must not regress while the ordering one is decided.
      await post('ARRIVED_PICKUP', 'a').expect(201);

      const [passed] = execution.recordEvent.mock.calls[0] as [Record<string, unknown>];
      expect(passed).not.toHaveProperty('actualAt');
      expect(passed).not.toHaveProperty('recordedAt');
    });

    it('refuses an event type outside the four, in any position', async () => {
      await post('LOADED', 'a').expect(422);
      expect(execution.recordEvent).not.toHaveBeenCalled();
    });

    it('passes a repeated client id straight to the service, which decides', async () => {
      // Idempotency is resolved in the service against the database, not by the
      // controller — so the route forwards both and the second reads back the
      // first. The HTTP layer must not develop an opinion of its own.
      await post('ARRIVED_PICKUP', 'same').expect(201);
      await post('ARRIVED_PICKUP', 'same').expect(201);

      expect(execution.recordEvent).toHaveBeenCalledTimes(2);
      const calls = execution.recordEvent.mock.calls as [Record<string, unknown>][];
      expect(calls[0]![0]!['clientEventId']).toBe('same');
      expect(calls[1]![0]!['clientEventId']).toBe('same');
    });
  });

  // -------------------------------------------------------------- validation --

  describe('validation', () => {
    it('refuses a completion with no declaration, rather than assuming one', async () => {
      // ★ Contract §9.7: zero cost lines is not an answer. A default here would
      // be the system answering on the driver's behalf.
      const response = await authed('post', `/driver/trips/${TRIP_A}/completion-requests`).send({});

      expect(response.status).toBe(422);
      expect(completion.submit).not.toHaveBeenCalled();
    });

    it('refuses a declaration value the contract does not have', async () => {
      const response = await authed('post', `/driver/trips/${TRIP_A}/completion-requests`).send({
        expenseDeclaration: 'maybe',
      });

      expect(response.status).toBe(422);
    });

    it('refuses an event type outside the four canonical ones', async () => {
      const response = await authed('post', `/driver/trips/${TRIP_A}/execution-events`).send({
        type: 'LUNCH',
        clientEventId: 'tap-1',
      });

      expect(response.status).toBe(422);
    });

    it('refuses an event with no client id, which would defeat retry protection', async () => {
      const response = await authed('post', `/driver/trips/${TRIP_A}/execution-events`).send({
        type: 'ARRIVED_PICKUP',
      });

      expect(response.status).toBe(422);
    });

    it('refuses an amount NUMERIC(14,2) cannot hold exactly', async () => {
      const response = await authed('post', `/driver/trips/${TRIP_A}/expenses`).send({
        category: 'fuel',
        amount: '10.005',
      });

      expect(response.status).toBe(422);
    });

    it('★ accepts no actualAt from a client — a phone clock cannot set a delay', async () => {
      // ★ THE MOST IMPORTANT CASE IN THIS FILE. `actual_at` is what every delay
      // in the system is measured from. A handset whose clock is an hour out
      // would otherwise write an hour of lateness nobody caused — or erase an
      // hour somebody did.
      await authed('post', `/driver/trips/${TRIP_A}/execution-events`)
        .send({
          type: 'ARRIVED_PICKUP',
          clientEventId: 'tap-1',
          actualAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      const [passed] = execution.recordEvent.mock.calls[0] as [Record<string, unknown>];
      expect(passed).not.toHaveProperty('actualAt');
    });

    it('records an event with no time in the body at all', async () => {
      await authed('post', `/driver/trips/${TRIP_A}/execution-events`)
        .send({ type: 'ARRIVED_PICKUP', clientEventId: 'tap-1' })
        .expect(201);

      expect(execution.recordEvent).toHaveBeenCalled();
    });

    it('keeps the handset clock as a DIAGNOSTIC field, clearly separate', async () => {
      // Recorded so a disagreement can be investigated. Nothing computes from it.
      await authed('post', `/driver/trips/${TRIP_A}/execution-events`)
        .send({
          type: 'ARRIVED_PICKUP',
          clientEventId: 'tap-1',
          deviceReportedAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      const [passed] = execution.recordEvent.mock.calls[0] as [Record<string, unknown>];
      expect(passed['deviceReportedAt']).toEqual(new Date('2020-01-01T00:00:00.000Z'));
      expect(passed).not.toHaveProperty('actualAt');
    });

    it('★ accepts no recordedAt from a client — the server owns its own clock', async () => {
      await authed('post', `/driver/trips/${TRIP_A}/execution-events`)
        .send({
          type: 'ARRIVED_PICKUP',
          clientEventId: 'tap-1',
          recordedAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      const [passed] = execution.recordEvent.mock.calls[0] as [Record<string, unknown>];
      expect(passed).not.toHaveProperty('recordedAt');
    });

    it('★ answers a malformed trip id with 403, not 422', async () => {
      // Guards run BEFORE pipes in Nest, so `ActiveAssignmentGuard` sees the
      // raw string, finds no assignment for it and refuses. That ordering is
      // the better one and worth pinning: a 422 would tell an unauthorized
      // caller that their id was merely misspelt, which is one bit more than
      // they are entitled to. Every unauthorized shape answers identically.
      const malformed = await authed('get', '/driver/trips/not-a-uuid').send();
      const foreign = await authed('get', `/driver/trips/${TRIP_B}`).send();

      expect(malformed.status).toBe(403);
      expect(malformed.body.error.code).toBe(foreign.body.error.code);
    });
  });
});
