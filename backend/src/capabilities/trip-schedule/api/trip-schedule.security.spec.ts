import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import {
  AuthorizationContext,
  can as can_,
} from '../../../core/authorization/domain/authorization.context';
import { PermissionGuard } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import type { AccountType } from '../../../core/users/domain/user.entity';
import { TripCatalogueService } from '../application/trip-catalogue.service';
import { OperationalBoardService } from '../application/operational-board.service';
import { TripExecutionService } from '../application/trip-execution.service';
import { TripScheduleService } from '../application/trip-schedule.service';
import { TripCatalogueController } from './trip-catalogue.controller';
import { TripScheduleController } from './trip-schedule.controller';

/**
 * The dispatch board over HTTP.
 *
 * ★ THE POLICY THIS FILE EXISTS TO PIN DOWN. Everybody reads and adds; only a
 * global administrator corrects or archives. That asymmetry is the whole reason
 * the `'any'` permission tier was added to `core`, and it is one decorator away
 * from being wrong in either direction — so it is asserted here per route
 * rather than trusted to review.
 *
 * The second thing asserted is subtler and easier to break by "simplifying":
 * every route runs `PermissionGuard`, INCLUDING the ones whose permission
 * everybody holds, because that guard is where a temporary credential is
 * refused. A route that dropped to a bare `AuthGuard` would still look correct
 * and would let a half-provisioned account write to the board.
 */
describe('trip-schedule HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const DEPT = '11111111-1111-1111-1111-111111111111';
  const TRIP = '55555555-5555-5555-5555-555555555555';
  const VEHICLE = '66666666-6666-6666-6666-666666666666';
  const CUSTOMER = '77777777-7777-7777-7777-777777777777';
  const LOCATION = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

  /**
   * Named rather than `Record<string, jest.Mock>`: this project compiles with
   * `noPropertyAccessFromIndexSignature`, so an index-signature stand-in turns
   * every `trips.create` in the assertions into a compile error.
   */
  interface TripServiceMock {
    list: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateStatus: jest.Mock;
    archive: jest.Mock;
    statusHistory: jest.Mock;
  }

  interface CatalogueServiceMock {
    listVehicles: jest.Mock;
    createVehicle: jest.Mock;
    updateVehicle: jest.Mock;
    archiveVehicle: jest.Mock;
    listCustomers: jest.Mock;
    createCustomer: jest.Mock;
    updateCustomer: jest.Mock;
    archiveCustomer: jest.Mock;
    listLocations: jest.Mock;
    createLocation: jest.Mock;
    updateLocation: jest.Mock;
    archiveLocation: jest.Mock;
  }

  let app: INestApplication;
  let trips: TripServiceMock;
  let catalogue: CatalogueServiceMock;
  let operations: { list: jest.Mock; listUnresolvedCompletions: jest.Mock };
  let execution: {
    listEvents: jest.Mock;
    listAssignments: jest.Mock;
    listEligibleDrivers: jest.Mock;
    listDriverHistory: jest.Mock;
    assign: jest.Mock;
    replaceDriver: jest.Mock;
    endAssignment: jest.Mock;
  };
  /** Somebody with a driver account, to be assigned. */
  const DRIVER_USER = '99999999-9999-4999-8999-999999999999';
  let context: AuthorizationContext;
  /** What KIND of account is calling. Drivers are refused the Backoffice. */
  let accountType: AccountType;

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    functions: [],
    mustChangeSecret: false,
    ...over,
  });

  const storedTrip = {
    id: TRIP,
    scheduledOn: '2026-08-04',
    vehicleId: VEHICLE,
    customerId: CUSTOMER,
    cargoInfo: '1 kiện / 18 kgs',
    pickupAddress: 'VP KHO SÂN BAY',
    deliveryAddress: 'KHO LONG BÌNH',
    pickupContact: null,
    deliveryContact: null,
    pickupAt: new Date('2026-08-04T01:30:00Z'),
    deliveryAt: new Date('2026-08-04T03:00:00Z'),
    note: null,
    status: 'confirmed',
    createdBy: ACTOR,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };

  beforeEach(async () => {
    accountType = 'employee';
    context = asContext();

    trips = {
      list: jest.fn().mockResolvedValue({
        items: [storedTrip],
        page: 1,
        limit: 50,
        total: 1,
        totalPages: 1,
      }),
      findById: jest.fn().mockResolvedValue(storedTrip),
      create: jest.fn().mockResolvedValue(storedTrip),
      update: jest.fn().mockResolvedValue(storedTrip),
      updateStatus: jest.fn().mockResolvedValue({ ...storedTrip, status: 'finished' }),
      archive: jest.fn().mockResolvedValue(storedTrip),
      statusHistory: jest.fn().mockResolvedValue([]),
    };

    operations = {
      list: jest.fn().mockResolvedValue([]),
      listUnresolvedCompletions: jest.fn().mockResolvedValue([]),
    };
    execution = {
      listEvents: jest.fn().mockResolvedValue([]),
      listAssignments: jest.fn().mockResolvedValue([]),
      listEligibleDrivers: jest.fn().mockResolvedValue([{ id: DRIVER_USER, displayName: 'Tài Xế' }]),
      listDriverHistory: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      assign: jest.fn().mockResolvedValue({ id: 'assignment-1', driverUserId: DRIVER_USER }),
      replaceDriver: jest.fn().mockResolvedValue({ id: 'assignment-2', driverUserId: DRIVER_USER }),
      endAssignment: jest.fn().mockResolvedValue({ id: 'assignment-1', state: 'ended' }),
    };

    catalogue = {
      listVehicles: jest.fn().mockResolvedValue([]),
      createVehicle: jest.fn().mockResolvedValue({ id: VEHICLE, plate: '50H-49266' }),
      updateVehicle: jest.fn().mockResolvedValue({ id: VEHICLE, plate: '50H-49266' }),
      archiveVehicle: jest.fn().mockResolvedValue({ id: VEHICLE, plate: '50H-49266' }),
      listCustomers: jest.fn().mockResolvedValue([]),
      createCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER, name: 'WWL' }),
      updateCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER, name: 'WWL' }),
      archiveCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER, name: 'WWL' }),
      listLocations: jest.fn().mockResolvedValue([]),
      createLocation: jest.fn().mockResolvedValue({ id: LOCATION, customerId: CUSTOMER }),
      updateLocation: jest.fn().mockResolvedValue({ id: LOCATION, customerId: CUSTOMER }),
      archiveLocation: jest.fn().mockResolvedValue({ id: LOCATION, customerId: CUSTOMER, status: 'archived' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripScheduleController, TripCatalogueController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        BackofficeOnlyGuard,
        CsrfGuard,
        { provide: TripScheduleService, useValue: trips },
        { provide: OperationalBoardService, useValue: operations },
        { provide: TripExecutionService, useValue: execution },
        { provide: TripCatalogueService, useValue: catalogue },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest.fn().mockImplementation(async () => ({
              id: ACTOR,
              displayName: 'Actor',
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

  /** Every mutating route, for the checks that must hold on all of them. */
  const WRITES = [
    ['post', '/trip-schedules'],
    ['patch', `/trip-schedules/${TRIP}`],
    ['patch', `/trip-schedules/${TRIP}/status`],
    ['post', `/trip-schedules/${TRIP}/archive`],
    ['post', '/trip-vehicles'],
    ['patch', `/trip-vehicles/${VEHICLE}`],
    ['post', `/trip-vehicles/${VEHICLE}/archive`],
    ['post', '/trip-customers'],
    ['patch', `/trip-customers/${CUSTOMER}`],
    ['post', `/trip-customers/${CUSTOMER}/archive`],
  ] as const;

  const READS = [
    ['get', '/trip-schedules'],
    ['get', `/trip-schedules/${TRIP}`],
    ['get', `/trip-schedules/${TRIP}/status-history`],
    // The operational board is dispatch information behind the same two guards.
    ['get', '/operational-board'],
    // The review queue: outstanding work, deliberately not date-filtered.
    ['get', '/completion-review-queue'],
    // The reviewer's timeline read. Same permission as the board; no money in it.
    ['get', `/trip-schedules/${TRIP}/execution-events`],
    ['get', '/trip-vehicles'],
    ['get', '/trip-customers'],
  ] as const;

  // ------------------------------------------------------------ anonymous --

  describe('without authentication', () => {
    it.each([...READS, ...WRITES])(
      'refuses %s %s with 401, and calls nothing on the services',
      async (method, path) => {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('X-Requested-With', 'XMLHttpRequest')
          .send({});

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('UNAUTHORIZED');

        // ★ ASSERTED HERE BECAUSE `beforeEach` REBUILDS THE MOCKS PER TEST.
        //
        // As its own case this checked a set of `jest.fn()`s created moments
        // earlier and never handed to a request — vacuously true, and it would
        // have stayed green with the guard deleted. Against the instances that
        // served THIS request it is the real claim: the refusal came before
        // any service was reached, on every route in the table.
        for (const mock of [
          ...Object.values(trips),
          ...Object.values(catalogue),
          ...Object.values(operations),
          ...Object.values(execution),
        ]) {
          expect(mock).not.toHaveBeenCalled();
        }
      },
    );
  });

  // ------------------------------------------------- temporary credential --

  describe('a caller who has not replaced their temporary credential', () => {
    beforeEach(() => {
      context = asContext({ global: true, mustChangeSecret: true });
    });

    it.each([...READS, ...WRITES])(
      '★ refuses %s %s with PASSWORD_CHANGE_REQUIRED, even for a SuperAdmin',
      async (method, path) => {
        // The reason every route here runs PermissionGuard. A bare AuthGuard
        // would answer 200 to all of these.
        const response = await authed(method, path).send({});

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      },
    );
  });

  // ----------------------------------------------------------------- CSRF --

  describe('CSRF', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it.each(WRITES)('refuses %s %s without the X-Requested-With header', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .send({ scheduledOn: '2026-08-04', plate: 'X', name: 'X', status: 'finished' });

      expect(response.status).toBe(403);
    });
  });

  // --------------------------------------------------------------- MEMBER --

  describe('a sales member — the everyday caller', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [DEPT], functions: ['sales'] });
    });

    it('reads the board', async () => {
      const response = await authed('get', '/trip-schedules').expect(200);

      // The envelope is the offset one, not the cursor one. This assertion is
      // the contract §5b flags as the single exception in the API.
      expect(response.body).toMatchObject({ page: 1, limit: 50, total: 1, totalPages: 1 });
      expect(response.body.nextCursor).toBeUndefined();
    });

    it.each([
      ['patch', `/trip-schedules/${TRIP}`],
      ['patch', `/trip-schedules/${TRIP}/status`],
      ['post', `/trip-schedules/${TRIP}/archive`],
      ['patch', `/trip-vehicles/${VEHICLE}`],
      ['post', `/trip-vehicles/${VEHICLE}/archive`],
      ['patch', `/trip-customers/${CUSTOMER}`],
      ['post', `/trip-customers/${CUSTOMER}/archive`],
    ] as const)('★ is refused %s %s — correcting a row is its head’s, not a member’s', async (method, path) => {
      const response = await authed(method, path).send({ status: 'finished', plate: 'X', name: 'X' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(trips.update).not.toHaveBeenCalled();
      expect(trips.archive).not.toHaveBeenCalled();
      expect(catalogue.updateVehicle).not.toHaveBeenCalled();
    });
  });

  /**
   * ★ A MEMBER OF AN ORDINARY UNIT — MARKETING, HR, IT — SEES NOTHING OF THE
   * BOARD (business clarification 2026-09-17). `trip.read` is the three
   * booking functions' key; the tier is 'global' so that no membership
   * anywhere else reaches it.
   */
  describe('a member of an ordinary unit — no trip visibility at all', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [DEPT] });
    });

    it.each([...READS])('★ is refused %s %s, and reaches no service', async (method, path) => {
      const response = await authed(method, path);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      for (const mock of [...Object.values(trips), ...Object.values(catalogue), ...Object.values(operations), ...Object.values(execution)]) {
        expect(mock).not.toHaveBeenCalled();
      }
    });

    it('★ does NOT add a row — booking belongs to the sales, accounting and dispatch functions (0032)', async () => {
      const response = await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' });

      expect(response.status).toBe(403);
      expect(trips.create).not.toHaveBeenCalled();
    });

    it('does not add a vehicle or a customer either — the same key gates the catalogues', async () => {
      await authed('post', '/trip-vehicles').send({ plate: '50H-49266' }).expect(403);
      await authed('post', '/trip-customers').send({ name: 'WWL' }).expect(403);

      expect(catalogue.createVehicle).not.toHaveBeenCalled();
      expect(catalogue.createCustomer).not.toHaveBeenCalled();
    });

    it.each([
      ['patch', `/trip-schedules/${TRIP}`],
      ['patch', `/trip-schedules/${TRIP}/status`],
      ['post', `/trip-schedules/${TRIP}/archive`],
      ['patch', `/trip-vehicles/${VEHICLE}`],
      ['post', `/trip-vehicles/${VEHICLE}/archive`],
      ['patch', `/trip-customers/${CUSTOMER}`],
      ['post', `/trip-customers/${CUSTOMER}/archive`],
    ] as const)('is refused %s %s as well', async (method, path) => {
      const response = await authed(method, path).send({ status: 'finished', plate: 'X', name: 'X' });

      expect(response.status).toBe(403);
      expect(trips.update).not.toHaveBeenCalled();
      expect(trips.archive).not.toHaveBeenCalled();
      expect(catalogue.updateVehicle).not.toHaveBeenCalled();
    });
  });

  /**
   * ★ THE HEAD OF AN ORDINARY UNIT — THE CALLER `head-anywhere` USED TO LET
   * THROUGH. A head of Marketing could read every trip, see every price and
   * rewrite any row. The clarification of 2026-09-17 closes all three:
   * `trip.read` and `trip.price.read` are the functions' keys, and
   * `trip.write` is a head WITHIN a booking function.
   */
  describe('★ the head of an ordinary unit — seniority buys nothing on the board', () => {
    beforeEach(() => {
      context = asContext({ headOf: [DEPT], memberOf: [DEPT] });
    });

    it.each([...READS])('★ is refused %s %s — including the board and the detail', async (method, path) => {
      const response = await authed(method, path);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(trips.list).not.toHaveBeenCalled();
      expect(trips.findById).not.toHaveBeenCalled();
      expect(operations.list).not.toHaveBeenCalled();
    });

    it('★ neither corrects, restatuses nor archives a row — `trip.write` is a head WITHIN a booking function', async () => {
      const corrected = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x' });
      const restatused = await authed('patch', `/trip-schedules/${TRIP}/status`).send({ status: 'confirmed' });
      const archived = await authed('post', `/trip-schedules/${TRIP}/archive`);

      expect([corrected.status, restatused.status, archived.status]).toEqual([403, 403, 403]);
      expect(trips.update).not.toHaveBeenCalled();
      expect(trips.updateStatus).not.toHaveBeenCalled();
      expect(trips.archive).not.toHaveBeenCalled();
    });

    it('does not book a trip either (0032)', async () => {
      await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' }).expect(403);
      expect(trips.create).not.toHaveBeenCalled();
    });
  });

  /**
   * ★ THE SHIFT SENIOR — A HEAD OF SALES, ACCOUNTING OR DISPATCH. The tier
   * ('head-anywhere') and the function together are what `trip.write` asks.
   */
  describe.each([
    ['the sales head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['sales'] })],
    ['the accounting head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['accounting'] })],
    ['the dispatch head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['dispatch'] })],
  ])('%s — corrects the board', (_label, caller) => {
    beforeEach(() => {
      context = caller();
    });

    it('★ corrects, restatuses and archives a row — the shift senior', async () => {
      // The route names no department because a trip belongs to none, so what
      // is being asked here is seniority WITHIN a booking function, not a
      // relation to a target. See PERMISSION_REQUIREMENT for `withinFunction`.
      const corrected = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x' });
      const restatused = await authed('patch', `/trip-schedules/${TRIP}/status`).send({
        status: 'confirmed',
      });
      const archived = await authed('post', `/trip-schedules/${TRIP}/archive`);

      expect(corrected.status).toBe(200);
      expect(restatused.status).toBe(200);
      expect(archived.status).toBe(200);

      // ★ ALL THREE REACHED THE SERVICE. "Does the work" is the claim; three
      // 200s from a controller that never called anything would satisfy the
      // status check and say nothing about the tier.
      expect(trips.update).toHaveBeenCalled();
      expect(trips.updateStatus).toHaveBeenCalled();
      expect(trips.archive).toHaveBeenCalled();
    });

    it('corrects the catalogues too', async () => {
      await authed('patch', `/trip-vehicles/${VEHICLE}`).send({ plate: '50H-49267' }).expect(200);
      await authed('patch', `/trip-customers/${CUSTOMER}`).send({ name: 'WWL 2' }).expect(200);
      expect(catalogue.updateVehicle).toHaveBeenCalled();
      expect(catalogue.updateCustomer).toHaveBeenCalled();
    });

    it('★ is refused when the head assignment is only a membership', async () => {
      // The line the tier must not blur: a member of a booking function is
      // still not senior to one row of the board.
      context = asContext({ headOf: [], memberOf: [DEPT], functions: context.functions });
      const response = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x' });
      expect(response.status).toBe(403);
      expect(trips.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- SUPERADMIN --

  describe('a global administrator', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('corrects a row', async () => {
      await authed('patch', `/trip-schedules/${TRIP}`)
        .send({ note: 'TÀI XẾ KIỂM TRA LẠI SỐ LƯỢNG' })
        .expect(200);

      // The actor rides along because this route can move the status too, and
      // every board move is recorded against whoever made it.
      expect(trips.update).toHaveBeenCalledWith(
        TRIP,
        { note: 'TÀI XẾ KIỂM TRA LẠI SỐ LƯỢNG' },
        ACTOR,
      );
    });

    it('moves a row along the board', async () => {
      await authed('patch', `/trip-schedules/${TRIP}/status`).send({ status: 'finished' }).expect(200);
      // ★ THE ACTOR IS NOT OPTIONAL HERE. A board move with no author is the
      // gap `trip_status_history` exists to close, so the route passes the
      // session user and never a value from the body.
      expect(trips.updateStatus).toHaveBeenCalledWith(TRIP, 'finished', ACTOR, null);
    });

    it('archives rather than deletes, and gets the archived row back', async () => {
      await authed('post', `/trip-schedules/${TRIP}/archive`).expect(200);
      expect(trips.archive).toHaveBeenCalledWith(TRIP, ACTOR);
    });
  });

  // ----------------------------------------------------------- validation --

  describe('validation', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('refuses a trip with no day', async () => {
      const response = await authed('post', '/trip-schedules').send({ note: 'x' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details).toHaveProperty('scheduledOn');
    });

    it('refuses a day written any other way', async () => {
      const slashes = await authed('post', '/trip-schedules').send({ scheduledOn: '04/08/2026' });
      const unpadded = await authed('post', '/trip-schedules').send({ scheduledOn: '2026-8-4' });

      expect(slashes.status).toBe(422);
      expect(unpadded.status).toBe(422);
      // Named the same way the sibling case above names it, so a reader sees
      // one contract rather than two spellings of a refusal.
      expect(slashes.body.error.details).toHaveProperty('scheduledOn');
      expect(unpadded.body.error.details).toHaveProperty('scheduledOn');

      // ★ REFUSED AT THE BOUNDARY. A date the server could not parse must never
      // reach the service, where it would become a row nobody can read back.
      expect(trips.create).not.toHaveBeenCalled();
    });

    it('refuses a status outside the five the board has', async () => {
      const response = await authed('patch', `/trip-schedules/${TRIP}/status`).send({
        status: 'in_progress',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.details).toHaveProperty('status');
    });

    it('refuses a backwards range and an oversized one, rather than trimming them', async () => {
      const backwards = await authed('get', '/trip-schedules?from=2026-08-31&to=2026-08-01');
      const tooWide = await authed('get', '/trip-schedules?from=2020-01-01&to=2026-12-31');
      const tooMany = await authed('get', '/trip-schedules?limit=5000');

      expect(backwards.status).toBe(422);
      expect(tooWide.status).toBe(422);
      expect(tooMany.status).toBe(422);

      // ★ "RATHER THAN TRIMMING THEM" IS THE WHOLE CLAIM, and only this line
      // measures it. A server that silently clamped `limit=5000` to 100 would
      // answer 200 — but one that clamped and still answered 422 would pass a
      // status-only check while having queried the database anyway.
      expect(trips.list).not.toHaveBeenCalled();
    });

    it('answers 422 for a malformed id, in the same envelope as everything else', async () => {
      const response = await authed('get', '/trip-schedules/not-a-uuid');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('★ keeps null distinguishable from absent, so a field can be cleared', async () => {
      await authed('patch', `/trip-schedules/${TRIP}`)
        .send({ deliveryAddress: null })
        .expect(200);

      // `null` survives the schema. If it were stripped, "remove the delivery
      // address" and "leave it alone" would be the same request.
      expect(trips.update).toHaveBeenCalledWith(TRIP, { deliveryAddress: null }, ACTOR);
    });

    it('strips a field the body must not decide', async () => {
      await authed('post', '/trip-schedules')
        .send({ scheduledOn: '2026-08-04', sellPrice: '4500000', id: 'x', createdBy: 'y', archivedAt: 'z' })
        .expect(201);

      const payload = trips.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('archivedAt');
      expect(payload['createdBy']).toBe(ACTOR);
    });

    it('refuses includeArchived=false being read as true', async () => {
      // `z.coerce.boolean()` would make this pass archived rows through.
      await authed('get', '/trip-vehicles?includeArchived=false').expect(200);
      expect(catalogue.listVehicles).toHaveBeenCalledWith(false);
    });
  });

  // ==================================================== ★ THE TWO PRICES ==

  /**
   * ★ WHAT A TRIP IS SOLD AND BOUGHT FOR, AND WHO MAY TOUCH EITHER FIGURE.
   *
   * 0024 put the quoted price on \`trip_schedules\` and wrote down that it
   * therefore rode on a response every finished account can read. 0026 takes
   * that back for both figures and puts them behind \`trip.price.read\`, which
   * is 'head-anywhere' — a global administrator or the head of some department.
   *
   * Asserted over HTTP rather than on \`can()\` alone, because the rule has
   * three halves living in three different places and only a request exercises
   * all of them: the tier, the refusal to ACCEPT a price from somebody who may
   * not set one, and the blanking of both columns on the way back out.
   */
  describe('★ the two prices on a trip', () => {
    /** A row that HAS both figures, so a blanked response is visibly a blanking. */
    const priced = { ...storedTrip, sellPrice: '4500000.00', purchasePrice: '3000000.00' };

    beforeEach(() => {
      trips.list.mockResolvedValue({ items: [priced], page: 1, limit: 50, total: 1, totalPages: 1 });
      trips.findById.mockResolvedValue(priced);
      trips.create.mockResolvedValue(priced);
      trips.update.mockResolvedValue(priced);
    });

    /**
     * ★ THE CALLERS THE FIGURES ARE KEPT FROM: a member AND a head of an
     * ordinary unit. Since 2026-09-17 they do not reach the board at all, so
     * there is no blanked row to inspect — the refusal is the guard's, and no
     * figure is serialised anywhere in the response.
     */
    describe.each([
      ['a member of an ordinary unit', () => asContext({ memberOf: [DEPT] })],
      ['the head of an ordinary unit', () => asContext({ headOf: [DEPT], memberOf: [DEPT] })],
    ])('%s — the caller the figures are kept from', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it('★ is refused the board, and no figure is serialised anywhere in the answer', async () => {
        const response = await authed('get', '/trip-schedules');

        expect(response.status).toBe(403);
        expect(JSON.stringify(response.body)).not.toContain('4500000');
        expect(JSON.stringify(response.body)).not.toContain('3000000');
        expect(trips.list).not.toHaveBeenCalled();
      });

      it('is refused the detail too', async () => {
        const response = await authed('get', `/trip-schedules/${TRIP}`);

        expect(response.status).toBe(403);
        expect(JSON.stringify(response.body)).not.toContain('4500000');
        expect(trips.findById).not.toHaveBeenCalled();
      });

      it('★ does not create a trip at all — an ordinary unit does not book (0032)', async () => {
        const response = await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' });

        expect(response.status).toBe(403);
        expect(trips.create).not.toHaveBeenCalled();
      });

      it.each([
        ['a selling price', { sellPrice: '4500000' }],
        ['a buying price', { purchasePrice: '3000000' }],
        ['an explicit null', { sellPrice: null }],
      ])('is refused %s on create, at the guard', async (_label, price) => {
        const response = await authed('post', '/trip-schedules').send({
          scheduledOn: '2026-08-04',
          ...price,
        });

        expect(response.status).toBe(403);
        expect(trips.create).not.toHaveBeenCalled();
      });

      it.each([
        ['a price', { sellPrice: null }],
        ['an ordinary field', { note: 'x' }],
      ])('is refused %s on the patch route — the field decides the permission, and they hold neither', async (_label, patch) => {
        const response = await authed('patch', `/trip-schedules/${TRIP}`).send(patch);

        expect(response.status).toBe(403);
        expect(trips.update).not.toHaveBeenCalled();
      });
    });

    /**
     * ★ THE DISPATCH FUNCTION — THE CALLERS WHO MAY SET THE FIGURES (0032).
     *
     * Member and head alike: the grant is the department's function, not the
     * person's seniority. Every case below runs for both.
     */
    describe.each([
      ['a dispatch member', () => asContext({ memberOf: [DEPT], functions: ['dispatch'] })],
      ['the dispatch head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['dispatch'] })],
    ])('%s — may set the prices', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it('★ reads both figures as they are stored', async () => {
        const response = await authed('get', `/trip-schedules/${TRIP}`).expect(200);
        expect(response.body.sellPrice).toBe('4500000.00');
        expect(response.body.purchasePrice).toBe('3000000.00');
      });

      it('★ must give a selling price when creating — the rule binds those who may set it', async () => {
        const response = await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' });

        expect(response.status).toBe(422);
        expect(trips.create).not.toHaveBeenCalled();
      });

      it('★ is refused an explicit null selling price as well as an absent one', async () => {
        const response = await authed('post', '/trip-schedules').send({
          scheduledOn: '2026-08-04',
          sellPrice: null,
        });

        expect(response.status).toBe(422);
      });

      it('★ needs no buying price — most runs are on our own lorries', async () => {
        await authed('post', '/trip-schedules')
          .send({ scheduledOn: '2026-08-04', sellPrice: '4500000' })
          .expect(201);

        const [input] = trips.create.mock.calls[0] as [Record<string, unknown>];
        expect(input['sellPrice']).toBe('4500000');
      });

      it('sends both through to the service when both are given', async () => {
        await authed('post', '/trip-schedules')
          .send({ scheduledOn: '2026-08-04', sellPrice: '4500000', purchasePrice: '3000000' })
          .expect(201);

        const [input] = trips.create.mock.calls[0] as [Record<string, unknown>];
        expect(input['sellPrice']).toBe('4500000');
        expect(input['purchasePrice']).toBe('3000000');
      });

      /**
       * ★ THE PATCH IS AUTHORIZED PER FIELD. Pricing an existing trip is
       * `trip.price.write`, which the dispatch MEMBER holds without holding
       * `trip.write`; so a body carrying only the two price keys goes through
       * for member and head alike.
       */
      it.each([
        ['a selling price', { sellPrice: '4500000' }],
        ['a buying price', { purchasePrice: '3000000' }],
        ['both', { sellPrice: '4500000', purchasePrice: '3000000' }],
        ['a cleared selling price', { sellPrice: null }],
      ])('★ patches %s on an existing trip, whether or not they head anything', async (_label, price) => {
        await authed('patch', `/trip-schedules/${TRIP}`).send(price).expect(200);

        const [, patch] = trips.update.mock.calls[0] as [string, Record<string, unknown>];
        expect(patch).toEqual(price);
      });

      it('★ corrects the ROW only with `trip.write` — a member of dispatch is refused, its head is not', async () => {
        const note = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x' });
        // A price beside a note: the row half needs `trip.write`, so the whole
        // patch is refused for the member. Nothing is written half-way.
        const mixed = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x', sellPrice: '1' });
        const empty = await authed('patch', `/trip-schedules/${TRIP}`).send({});

        if (context.headOf.length > 0) {
          expect([note.status, mixed.status, empty.status]).toEqual([200, 200, 200]);
          expect(trips.update).toHaveBeenCalledTimes(3);
        } else {
          expect([note.status, mixed.status, empty.status]).toEqual([403, 403, 403]);
          expect(trips.update).not.toHaveBeenCalled();
        }
      });

      it('refuses a figure NUMERIC(14,2) cannot hold exactly, and not as a 403', async () => {
        // A third decimal place is refused rather than rounded — 422 from the
        // schema, not 403 from the tier, because this caller IS allowed.
        const response = await authed('post', '/trip-schedules')
          .send({ scheduledOn: '2026-08-04', sellPrice: '4500000.005' })
          .expect(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(trips.create).not.toHaveBeenCalled();
      });

      it('refuses a zero, which is not the same fact as unpriced', async () => {
        const response = await authed('post', '/trip-schedules')
          .send({ scheduledOn: '2026-08-04', sellPrice: '0' })
          .expect(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(trips.create).not.toHaveBeenCalled();
      });
    });

    /**
     * ★ SALES AND ACCOUNTING READ, MEMBER OR HEAD; NEITHER WRITES (0032).
     */
    describe.each([
      ['an accounting member', () => asContext({ memberOf: [DEPT], functions: ['accounting'] })],
      ['the accounting head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['accounting'] })],
      ['a sales member', () => asContext({ memberOf: [DEPT], functions: ['sales'] })],
      ['the sales head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['sales'] })],
    ])('%s', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it('★ reads both figures, on the detail and on the board', async () => {
        const detail = await authed('get', `/trip-schedules/${TRIP}`).expect(200);
        expect(detail.body.sellPrice).toBe('4500000.00');
        expect(detail.body.purchasePrice).toBe('3000000.00');

        const board = await authed('get', '/trip-schedules').expect(200);
        const [row] = board.body.items as Record<string, unknown>[];
        expect(row?.['sellPrice']).toBe('4500000.00');
      });

      it('★ creates a trip, unpriced', async () => {
        await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' }).expect(201);
        const [input] = trips.create.mock.calls[0] as [Record<string, unknown>];
        expect(input).not.toHaveProperty('sellPrice');
      });

      it.each([
        ['a selling price', { sellPrice: '4500000' }],
        ['a buying price', { purchasePrice: '3000000' }],
      ])('★ is refused %s on create', async (_what, price) => {
        const response = await authed('post', '/trip-schedules').send({
          scheduledOn: '2026-08-04',
          ...price,
        });

        expect(response.status).toBe(403);
        expect(trips.create).not.toHaveBeenCalled();
      });

      it.each([
        ['a selling price', { sellPrice: '4500000' }],
        ['a buying price', { purchasePrice: '3000000' }],
        ['a cleared selling price', { sellPrice: null }],
      ])('★ is refused %s on the patch route — reading is not setting', async (_what, price) => {
        const response = await authed('patch', `/trip-schedules/${TRIP}`).send(price);

        expect(response.status).toBe(403);
        expect(trips.update).not.toHaveBeenCalled();
      });

      it('patches an ordinary field only as a head — the row half is `trip.write`', async () => {
        const response = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x' });

        expect(response.status).toBe(context.headOf.length > 0 ? 200 : 403);
      });
    });

    describe('a global administrator', () => {
      beforeEach(() => {
        context = asContext({ global: true });
      });

      it('★ reads both figures — global is above every department', async () => {
        const response = await authed('get', `/trip-schedules/${TRIP}`).expect(200);
        expect(response.body.sellPrice).toBe('4500000.00');
        expect(response.body.purchasePrice).toBe('3000000.00');
      });

      it('is held to the compulsory selling price just as a head is', async () => {
        const response = await authed('post', '/trip-schedules')
          .send({ scheduledOn: '2026-08-04' })
          .expect(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(trips.create).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================ ★ THE BACKOFFICE BOUNDARY ==

  /**
   * ★ WHY THIS BLOCK EXISTS, AND WHY A TIER COULD NOT DO ITS JOB.
   *
   * `trip.read` and `trip.create` are `'any'` — company-wide dispatch data with
   * no departmental owner, readable by any authenticated caller. That was a
   * safe reading while every account belonged to a department. Driver accounts
   * break it: they authenticate, they hold no membership, and `'any'` would
   * hand them the whole board — every customer, address, contact and cargo note
   * on every trip, plus the ability to CREATE trips.
   *
   * Narrowing the tier would have refused the same routes to any employee
   * outside a department, which is a different rule about different people. So
   * the boundary names the one account type that does not belong here.
   */
  describe('★ a driver account holding Backoffice URLs', () => {
    beforeEach(() => {
      // A driver is not a member or a head of anything. The context is empty,
      // which is exactly why `'any'` would otherwise have let them through.
      accountType = 'driver';
      context = asContext();
    });

    it.each([...READS])('refuses %s %s with 403, and reaches no service', async (method, path) => {
      const response = await authed(method, path);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');

      for (const mock of [
        ...Object.values(trips),
        ...Object.values(catalogue),
        ...Object.values(operations),
        ...Object.values(execution),
      ]) {
        expect(mock).not.toHaveBeenCalled();
      }
    });

    it('★ cannot CREATE a trip either — `trip.create` is `any` too', async () => {
      const response = await authed('post', '/trip-schedules').send({});

      expect(response.status).toBe(403);
      expect(trips.create).not.toHaveBeenCalled();
    });

    it.each([...WRITES])(
      '★ cannot touch the vehicle or customer catalogue: %s %s is 403',
      async (method, path) => {
        // The contract draws the line at the CATALOGUE, not at the vehicle: a
        // driver sees the plate on their own trip through `/driver`, and never
        // the list it was picked from.
        const response = await authed(method, path).send({});

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
        for (const mock of Object.values(catalogue)) expect(mock).not.toHaveBeenCalled();
      },
    );
  });

  describe('★ an employee in a booking function reading the same routes is unaffected', () => {
    beforeEach(() => {
      accountType = 'employee';
      // A sales member: no headship, no global. `trip.read` is the booking
      // functions' key, so this is the weakest caller the boundary must still
      // let through — the same context on a DRIVER account is refused above.
      context = asContext({ memberOf: [DEPT], functions: ['sales'] });
    });

    it.each([...READS])('still allows %s %s', async (method, path) => {
      const response = await authed(method, path);

      expect(response.status).toBe(200);
    });

    it('★ CREATES a trip when the employee is in a booking function — the boundary refuses a TYPE, not a tier', async () => {
      // The boundary refuses an account TYPE, not a permission tier. A member
      // of a sales unit passes it and then passes `trip.create`; a driver with
      // the same context would have been refused at the boundary.
      context = asContext({ memberOf: [DEPT], functions: ['sales'] });
      await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' }).expect(201);

      expect(trips.create).toHaveBeenCalled();
    });
  });

  // ============================================== ★ WHO MAY BOOK A TRIP ==

  /**
   * ★ `trip.create` IS A FUNCTION'S KEY (0032). Sales, accounting and dispatch
   * book runs — member or head. A member or head of any other unit reads the
   * board and does not book on it; the superadmin always may; a driver is
   * refused at the boundary. The same key gates the catalogues, so the same
   * answer holds for adding a lorry or a customer.
   */
  describe('★ who may book a trip', () => {
    const booking = { scheduledOn: '2026-08-04' };

    describe.each([
      ['a sales member', () => asContext({ memberOf: [DEPT], functions: ['sales'] })],
      ['the sales head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['sales'] })],
      ['an accounting member', () => asContext({ memberOf: [DEPT], functions: ['accounting'] })],
      ['the accounting head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['accounting'] })],
      ['a dispatch member', () => asContext({ memberOf: [DEPT], functions: ['dispatch'] })],
      ['the dispatch head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['dispatch'] })],
      ['a global administrator', () => asContext({ global: true })],
    ])('%s', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it('books a trip, and the row records the SESSION as its author', async () => {
        // A dispatch caller and the superadmin must give a selling price; the
        // other two functions may not send one. Neither fact is what this case
        // is about, so the body is the one shape every caller here accepts.
        const price = can_(context, 'trip.price.write') ? { sellPrice: '4500000' } : {};
        await authed('post', '/trip-schedules')
          .send({ ...booking, ...price, createdBy: 'somebody-else' })
          .expect(201);

        expect(trips.create).toHaveBeenCalledWith(
          expect.objectContaining({ scheduledOn: '2026-08-04', createdBy: ACTOR }),
        );
      });

      it('adds a vehicle and a customer to the catalogues', async () => {
        await authed('post', '/trip-vehicles').send({ plate: '50H-49266' }).expect(201);
        await authed('post', '/trip-customers').send({ name: 'WWL' }).expect(201);
        expect(catalogue.createVehicle).toHaveBeenCalledWith(
          expect.objectContaining({ plate: '50H-49266', createdBy: ACTOR }),
        );
      });
    });

    describe.each([
      ['a member of an ordinary unit', () => asContext({ memberOf: [DEPT] })],
      ['the head of an ordinary unit', () => asContext({ headOf: [DEPT], memberOf: [DEPT] })],
      ['somebody in no unit at all', () => asContext()],
    ])('%s', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it('★ is refused, and reaches no service', async () => {
        const response = await authed('post', '/trip-schedules').send(booking);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
        expect(trips.create).not.toHaveBeenCalled();
      });

      it('cannot add to the catalogues either', async () => {
        await authed('post', '/trip-vehicles').send({ plate: '50H-49266' }).expect(403);
        await authed('post', '/trip-customers').send({ name: 'WWL' }).expect(403);
        expect(catalogue.createVehicle).not.toHaveBeenCalled();
        expect(catalogue.createCustomer).not.toHaveBeenCalled();
      });

      it('★ does not read the board either — visibility is the function’s, not the membership’s', async () => {
        await authed('get', '/trip-schedules').expect(403);
        await authed('get', '/operational-board').expect(403);
        expect(trips.list).not.toHaveBeenCalled();
        expect(operations.list).not.toHaveBeenCalled();
      });
    });

    it('★ refuses a driver at the boundary, whatever function its context claims', async () => {
      accountType = 'driver';
      // A driver holds no membership, so this context cannot occur; it is
      // built anyway to prove the boundary does not read the context at all.
      context = asContext({ memberOf: [DEPT], functions: ['dispatch'] });

      const response = await authed('post', '/trip-schedules').send(booking);

      expect(response.status).toBe(403);
      expect(trips.create).not.toHaveBeenCalled();
    });
  });

  // ==================================================== customer locations ==

  /**
   * ★ A CUSTOMER'S PLACES, AND WHO MAY TOUCH THEM. Same three tiers as the
   * customer catalogue — read `trip.read`, add `trip.create`, change
   * `trip.write` — and a DRIVER account is refused every one before the
   * permission is consulted, so a driver never sees the list of anybody's
   * warehouses. There is no route without a customer in the path.
   */
  describe('★ customer locations', () => {
    const LIST = ['get', `/trip-customers/${CUSTOMER}/locations`] as const;
    const CREATE = ['post', `/trip-customers/${CUSTOMER}/locations`] as const;
    const UPDATE = ['patch', `/trip-customers/${CUSTOMER}/locations/${LOCATION}`] as const;
    const ARCHIVE = ['post', `/trip-customers/${CUSTOMER}/locations/${LOCATION}/archive`] as const;
    const body = { name: 'Kho OSC', address: 'KCN Sóng Thần', latitude: 10.8, longitude: 106.6 };

    const nothingTouched = () => {
      for (const mock of [catalogue.listLocations, catalogue.createLocation, catalogue.updateLocation, catalogue.archiveLocation]) {
        expect(mock).not.toHaveBeenCalled();
      }
    };

    describe('a driver account', () => {
      beforeEach(() => {
        accountType = 'driver';
        context = asContext();
      });

      it.each([LIST, CREATE, UPDATE, ARCHIVE])('is refused %s %s — never the list, never a write', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect(response.status).toBe(403);
        nothingTouched();
      });
    });

    describe.each([
      ['a member of an ordinary unit', () => asContext({ memberOf: [DEPT] })],
      ['the head of an ordinary unit', () => asContext({ headOf: [DEPT], memberOf: [DEPT] })],
    ])('%s', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it.each([LIST, CREATE, UPDATE, ARCHIVE])('★ is refused %s %s — a customer’s places are trip data', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect(response.status).toBe(403);
        nothingTouched();
      });
    });

    describe('a sales member', () => {
      beforeEach(() => {
        context = asContext({ memberOf: [DEPT], functions: ['sales'] });
      });

      it('reads a customer’s places — `trip.read`, as for the customer list', async () => {
        await authed(...LIST).expect(200);
        expect(catalogue.listLocations).toHaveBeenCalledWith(CUSTOMER, false);
      });

      it('adds one — `trip.create`, as for a customer', async () => {
        await authed(...CREATE).send(body).expect(201);
        expect(catalogue.createLocation).toHaveBeenCalledWith(CUSTOMER, expect.objectContaining({ ...body, createdBy: ACTOR }));
      });

      it.each([UPDATE, ARCHIVE])('is refused %s %s — changing a place is `trip.write`, a head’s', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect(response.status).toBe(403);
        expect(catalogue.updateLocation).not.toHaveBeenCalled();
        expect(catalogue.archiveLocation).not.toHaveBeenCalled();
      });
    });

    describe('the sales head', () => {
      beforeEach(() => {
        context = asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['sales'] });
      });

      it('★ changes a place under ITS customer only — both ids come from the route', async () => {
        await authed(...UPDATE).send({ name: 'Kho OSC 2', customerId: 'somebody-else' }).expect(200);
        expect(catalogue.updateLocation).toHaveBeenCalledWith(CUSTOMER, LOCATION, { name: 'Kho OSC 2' });
      });

      it('archives one', async () => {
        await authed(...ARCHIVE).expect(200);
        expect(catalogue.archiveLocation).toHaveBeenCalledWith(CUSTOMER, LOCATION);
      });
    });

    describe('the body', () => {
      beforeEach(() => {
        context = asContext({ global: true });
      });

      it.each([
        ['latitude off the planet', { ...body, latitude: 91 }],
        ['longitude off the planet', { ...body, longitude: -180.5 }],
        ['a latitude that is not a number', { ...body, latitude: 'ten' }],
        ['no name', { ...body, name: '  ' }],
        ['no address', { ...body, address: '' }],
      ])('refuses %s with 422 before the service runs', async (_label, invalid) => {
        const response = await authed(...CREATE).send(invalid);
        expect(response.status).toBe(422);
        expect(catalogue.createLocation).not.toHaveBeenCalled();
      });

      it('accepts a place with no coordinates at all', async () => {
        await authed(...CREATE).send({ name: 'Nhà máy', address: 'Bình Dương' }).expect(201);
        expect(catalogue.createLocation).toHaveBeenCalledWith(
          CUSTOMER,
          expect.objectContaining({ name: 'Nhà máy', address: 'Bình Dương' }),
        );
      });

      it('accepts the edges of both axes, and forwards them untouched', async () => {
        await authed(...CREATE).send({ ...body, latitude: -90, longitude: 180 }).expect(201);
        expect(catalogue.createLocation).toHaveBeenCalledWith(
          CUSTOMER,
          expect.objectContaining({ latitude: -90, longitude: 180 }),
        );
      });
    });

    it('refuses every write without a CSRF header', async () => {
      context = asContext({ global: true });
      for (const [method, path] of [CREATE, UPDATE, ARCHIVE]) {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
          .send(body);
        expect(response.status).toBe(403);
      }
      nothingTouched();
    });
  });

  // ============================================ the trip names a place ==

  describe('★ a trip names a place, never a coordinate', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('forwards the place ids and strips any coordinate a client typed', async () => {
      await authed('post', '/trip-schedules')
        .send({
          scheduledOn: '2026-09-01',
          customerId: CUSTOMER,
          pickupLocationId: LOCATION,
          pickupLatitude: 1,
          pickupLongitude: 2,
          deliveryLatitude: 3,
          deliveryLongitude: 4,
          // The caller here is global, so the sell price is compulsory. Nothing
          // in this test is about money; it is here so the POST is well formed.
          sellPrice: '4500000',
        })
        .expect(201);

      const [input] = trips.create.mock.calls[0] as [Record<string, unknown>];
      expect(input['pickupLocationId']).toBe(LOCATION);
      for (const key of ['pickupLatitude', 'pickupLongitude', 'deliveryLatitude', 'deliveryLongitude']) {
        expect(input).not.toHaveProperty(key);
      }
    });

    it('refuses a place id that is not a UUID', async () => {
      await authed('post', '/trip-schedules')
        .send({ scheduledOn: '2026-09-01', pickupLocationId: 'kho-osc' })
        .expect(422);
      expect(trips.create).not.toHaveBeenCalled();
    });
  });

  // ===================================================== driver assignment ==

  /**
   * ★ WHO MAY PUT A DRIVER ON A TRIP, AND WHO MAY NOT.
   *
   * `dispatch.write` (0032): a global administrator, or anybody whose
   * department's function is DISPATCH — head or member. A head of any OTHER
   * department is refused, an ordinary member is refused, and a DRIVER account
   * is refused before the permission is even consulted — so a driver cannot
   * assign themselves, assign a colleague, or end anybody's turn, whatever id
   * they hold.
   */
  describe('★ driver assignment', () => {
    /** The turn being swapped or ended. */
    const ASSIGNMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ASSIGN = ['post', `/trip-schedules/${TRIP}/driver-assignments`] as const;
    const REPLACE = [
      'post',
      `/trip-schedules/${TRIP}/driver-assignments/${ASSIGNMENT}/replace`,
    ] as const;
    const END = ['post', `/trip-schedules/${TRIP}/driver-assignments/${ASSIGNMENT}/end`] as const;
    /** Valid for every route: a pair for ADD, a driver and a reason for the rest. */
    const body = { vehicleId: VEHICLE, driverUserId: DRIVER_USER, reason: 'đổi ca' };

    const noAssignmentWrite = () => {
      expect(execution.assign).not.toHaveBeenCalled();
      expect(execution.replaceDriver).not.toHaveBeenCalled();
      expect(execution.endAssignment).not.toHaveBeenCalled();
    };

    describe('a driver account', () => {
      beforeEach(() => {
        accountType = 'driver';
        context = asContext();
      });

      it.each([ASSIGN, REPLACE, END])('is refused %s %s — cannot assign, swap or remove anybody', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect(response.status).toBe(403);
        noAssignmentWrite();
      });

      it('cannot list the drivers either', async () => {
        await authed('get', '/trip-drivers').expect(403);
        expect(execution.listEligibleDrivers).not.toHaveBeenCalled();
      });

      it('★ cannot read anybody’s driving history, not even their own', async () => {
        // `BackofficeOnlyGuard` refuses a driver account before the permission is
        // asked. A driver's own work is the Driver Portal's to show, and it shows
        // live trips — not a paginated audit of every turn they have had.
        await authed('get', `/trip-drivers/${DRIVER_USER}/trips`).expect(403);
        expect(execution.listDriverHistory).not.toHaveBeenCalled();
      });
    });

    describe('an ordinary employee', () => {
      beforeEach(() => {
        context = asContext({ memberOf: [DEPT] });
      });

      it.each([ASSIGN, REPLACE, END])('is refused %s %s — `dispatch.write` is not `any`', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect(response.status).toBe(403);
        noAssignmentWrite();
      });

      it('cannot list the drivers', async () => {
        const response = await authed('get', '/trip-drivers');

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
        // Refused at the guard: the list of the company's drivers is never built.
        expect(execution.listEligibleDrivers).not.toHaveBeenCalled();
      });

      it('★ reads neither the assignment history nor a driver’s — `trip.read` is the functions’ key', async () => {
        await authed('get', `/trip-schedules/${TRIP}/driver-assignments`).expect(403);
        await authed('get', `/trip-drivers/${DRIVER_USER}/trips`).expect(403);
        expect(execution.listAssignments).not.toHaveBeenCalled();
        expect(execution.listDriverHistory).not.toHaveBeenCalled();
      });
    });

    describe('a sales member — reads the crew, never changes it', () => {
      beforeEach(() => {
        context = asContext({ memberOf: [DEPT], functions: ['sales'] });
      });

      it.each([ASSIGN, REPLACE, END])('is refused %s %s — dispatch is the dispatch function’s', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect(response.status).toBe(403);
        noAssignmentWrite();
      });

      it('may read the assignment history — it is `trip.read`', async () => {
        await authed('get', `/trip-schedules/${TRIP}/driver-assignments`).expect(200);
        expect(execution.listAssignments).toHaveBeenCalledWith(TRIP);
      });

      /**
       * ★ THE SAME ROWS AS THE LINE ABOVE, ASKED THE OTHER WAY ROUND. One trip's
       * turns and one driver's turns are the same table read from opposite ends,
       * so they carry the same key — guarding them differently would make a fact
       * readable or not depending on how somebody phrased the question.
       */
      it('may read one DRIVER’s history too — the same rows, the same key', async () => {
        await authed('get', `/trip-drivers/${DRIVER_USER}/trips`).expect(200);

        expect(execution.listDriverHistory).toHaveBeenCalledWith(
          DRIVER_USER,
          expect.objectContaining({ limit: expect.any(Number) }),
        );
      });
    });

    /**
     * ★ THE HEAD OF A DEPARTMENT THAT IS NOT DISPATCH — THE CALLER 0032 EXISTS
     * TO STOP. Under `trip.write` a head of Sales could dispatch; under
     * `dispatch.write` seniority buys nothing here.
     */
    describe.each([
      ['a head of an ordinary department', () => asContext({ headOf: [DEPT], memberOf: [DEPT] })],
      ['the sales head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['sales'] })],
      ['the accounting head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['accounting'] })],
      ['a sales member', () => asContext({ memberOf: [DEPT], functions: ['sales'] })],
      ['an accounting member', () => asContext({ memberOf: [DEPT], functions: ['accounting'] })],
    ])('%s', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it.each([ASSIGN, REPLACE, END])('★ is refused %s %s — dispatch is a function, not a seniority', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
        noAssignmentWrite();
      });

      it('cannot list the drivers to choose from', async () => {
        await authed('get', '/trip-drivers').expect(403);
        expect(execution.listEligibleDrivers).not.toHaveBeenCalled();
      });
    });

    describe.each([
      ['a dispatch member', () => asContext({ memberOf: [DEPT], functions: ['dispatch'] })],
      ['the dispatch head', () => asContext({ headOf: [DEPT], memberOf: [DEPT], functions: ['dispatch'] })],
    ])('★ %s — the dispatch function', (_label, caller) => {
      beforeEach(() => {
        context = caller();
      });

      it('★ dispatches a lorry AND a driver, as one pair, against the session user', async () => {
        await authed(...ASSIGN).send({ vehicleId: VEHICLE, driverUserId: DRIVER_USER }).expect(201);
        expect(execution.assign).toHaveBeenCalledWith(
          TRIP,
          { vehicleId: VEHICLE, driverUserId: DRIVER_USER },
          ACTOR,
        );
      });

      it('replaces the driver on ONE assignment, with a reason', async () => {
        await authed(...REPLACE).send({ driverUserId: DRIVER_USER, reason: 'đổi ca' }).expect(200);
        expect(execution.replaceDriver).toHaveBeenCalledWith(TRIP, ASSIGNMENT, DRIVER_USER, {
          by: ACTOR,
          reason: 'đổi ca',
        });
      });

      it('ends ONE assignment, with a reason', async () => {
        await authed(...END).send({ reason: 'đổi ca' }).expect(200);
        expect(execution.endAssignment).toHaveBeenCalledWith(TRIP, ASSIGNMENT, {
          by: ACTOR,
          reason: 'đổi ca',
        });
      });

      it('lists the drivers to choose from', async () => {
        const response = await authed('get', '/trip-drivers').expect(200);
        expect(response.body).toEqual([{ id: DRIVER_USER, displayName: 'Tài Xế' }]);
      });
    });

    describe('a global administrator', () => {
      beforeEach(() => {
        context = asContext({ global: true });
      });

      it.each([ASSIGN, REPLACE, END])('is allowed %s %s', async (method, path) => {
        const response = await authed(method, path).send(body);
        expect([200, 201]).toContain(response.status);
      });
    });

    describe('the body', () => {
      beforeEach(() => {
        context = asContext({ global: true });
      });

      it('refuses a driver id that is not a UUID', async () => {
        await authed(...ASSIGN).send({ vehicleId: VEHICLE, driverUserId: 'tai-xe-a' }).expect(422);
        noAssignmentWrite();
      });

      it('★ refuses a lorry with no driver — there is no lorry-only assignment', async () => {
        // ADR-0004: an assignment is a PAIR. "Add the lorry, fill the driver in
        // later" is not a state the board has.
        await authed(...ASSIGN).send({ vehicleId: VEHICLE }).expect(422);
        noAssignmentWrite();
      });

      it('★ refuses a driver with no lorry, for the same reason', async () => {
        await authed(...ASSIGN).send({ driverUserId: DRIVER_USER }).expect(422);
        noAssignmentWrite();
      });

      it('refuses a replacement with no reason', async () => {
        await authed(...REPLACE).send({ driverUserId: DRIVER_USER }).expect(422);
        noAssignmentWrite();
      });

      it('refuses a malformed assignment id on replace and end', async () => {
        await authed('post', `/trip-schedules/${TRIP}/driver-assignments/not-a-uuid/replace`)
          .send({ driverUserId: DRIVER_USER, reason: 'đổi ca' })
          .expect(422);
        await authed('post', `/trip-schedules/${TRIP}/driver-assignments/not-a-uuid/end`)
          .send({ reason: 'đổi ca' })
          .expect(422);
        noAssignmentWrite();
      });

      it('★ ignores an assignedBy in the body — the actor is the session', async () => {
        await authed(...ASSIGN)
          .send({ vehicleId: VEHICLE, driverUserId: DRIVER_USER, assignedBy: DRIVER_USER })
          .expect(201);
        expect(execution.assign).toHaveBeenCalledWith(
          TRIP,
          { vehicleId: VEHICLE, driverUserId: DRIVER_USER },
          ACTOR,
        );
      });
    });

    it('★ a lorry on the trip body is not a fact — the create route strips it', async () => {
      // ADR-0004: `trip_schedules.vehicle_id` is legacy. A client still sending
      // one gets a trip with no lorry on the row; the lorry is dispatched as an
      // assignment, paired with its driver, through the routes above.
      context = asContext({ global: true });
      await authed('post', '/trip-schedules')
        .send({ scheduledOn: '2026-09-01', vehicleId: VEHICLE, sellPrice: '100000' })
        .expect(201);

      const [input] = trips.create.mock.calls[0] as [Record<string, unknown>];
      expect(input).not.toHaveProperty('vehicleId');
    });

    it('refuses every assignment route without a CSRF header', async () => {
      context = asContext({ global: true });
      for (const [method, path] of [ASSIGN, REPLACE, END]) {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
          .send(body);
        expect(response.status).toBe(403);
      }
      noAssignmentWrite();
    });
  });
});
