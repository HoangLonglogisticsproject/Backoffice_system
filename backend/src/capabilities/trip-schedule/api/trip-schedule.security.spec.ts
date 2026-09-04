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
    status: 'awaiting_vehicle',
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
      updateStatus: jest.fn().mockResolvedValue({ ...storedTrip, status: 'done' }),
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
        .send({ scheduledOn: '2026-08-04', plate: 'X', name: 'X', status: 'done' });

      expect(response.status).toBe(403);
    });
  });

  // --------------------------------------------------------------- MEMBER --

  describe('an ordinary member — the everyday caller', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [DEPT] });
    });

    it('reads the board', async () => {
      const response = await authed('get', '/trip-schedules').expect(200);

      // The envelope is the offset one, not the cursor one. This assertion is
      // the contract §5b flags as the single exception in the API.
      expect(response.body).toMatchObject({ page: 1, limit: 50, total: 1, totalPages: 1 });
      expect(response.body.nextCursor).toBeUndefined();
    });

    it('adds a row, and the row records the SESSION as its author', async () => {
      await authed('post', '/trip-schedules')
        .send({ scheduledOn: '2026-08-04', createdBy: 'somebody-else' })
        .expect(201);

      expect(trips.create).toHaveBeenCalledWith(
        expect.objectContaining({ scheduledOn: '2026-08-04', createdBy: ACTOR }),
      );
    });

    it('adds a vehicle and a customer, so the catalogue is never bypassed', async () => {
      await authed('post', '/trip-vehicles').send({ plate: '50H-49266' }).expect(201);
      await authed('post', '/trip-customers').send({ name: 'WWL' }).expect(201);

      expect(catalogue.createVehicle).toHaveBeenCalledWith(
        expect.objectContaining({ plate: '50H-49266', createdBy: ACTOR }),
      );
    });

    it.each([
      ['patch', `/trip-schedules/${TRIP}`],
      ['patch', `/trip-schedules/${TRIP}/status`],
      ['post', `/trip-schedules/${TRIP}/archive`],
      ['patch', `/trip-vehicles/${VEHICLE}`],
      ['post', `/trip-vehicles/${VEHICLE}/archive`],
      ['patch', `/trip-customers/${CUSTOMER}`],
      ['post', `/trip-customers/${CUSTOMER}/archive`],
    ] as const)('★ is refused %s %s — correcting a row is administration', async (method, path) => {
      const response = await authed(method, path).send({ status: 'done', plate: 'X', name: 'X' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(trips.update).not.toHaveBeenCalled();
      expect(trips.archive).not.toHaveBeenCalled();
      expect(catalogue.updateVehicle).not.toHaveBeenCalled();
    });
  });

  describe('a department head', () => {
    beforeEach(() => {
      context = asContext({ headOf: [DEPT], memberOf: [DEPT] });
    });

    it('does everything a member does', async () => {
      // ★ ASSERTED ON THE RESPONSE AND ON THE SERVICE. A status alone would not
      // say the head got THROUGH — the claim is that seniority adds and never
      // subtracts, so what matters is that the same two calls a member makes
      // still reach the same two service methods.
      const read = await authed('get', '/trip-schedules');
      const write = await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' });

      expect(read.status).toBe(200);
      expect(write.status).toBe(201);
      expect(trips.list).toHaveBeenCalled();
      expect(trips.create).toHaveBeenCalled();
    });

    it('★ corrects, restatuses and archives a row — the shift senior', async () => {
      // 'head-anywhere'. The route names no department because a trip belongs
      // to none, so what is being asked here is seniority, not a relation to a
      // target. See PERMISSION_REQUIREMENT for why that needed its own tier.
      const corrected = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x' });
      const restatused = await authed('patch', `/trip-schedules/${TRIP}/status`).send({
        status: 'done',
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

    it('★ may correct the board while heading a department it has nothing to do with', async () => {
      // Deliberate, and the cost of putting company-wide data behind a
      // departmental role: there is no "the department that owns this trip".
      context = asContext({ headOf: [DEPT], memberOf: [] });

      const response = await authed('patch', `/trip-schedules/${TRIP}`).send({ note: 'x' });

      expect(response.status).toBe(200);
      // ★ THE POINT OF THE CASE: the write happened even though this head leads
      // a department with no relation to the trip. `head-anywhere` asks for
      // seniority, not for a target — and reaching `update` is what proves it.
      expect(trips.update).toHaveBeenCalled();
    });

    it('★ is refused when the head assignment is only a membership', async () => {
      // The line the tier must not blur: a member of every department in the
      // company is still not senior to one row of the board.
      context = asContext({ headOf: [], memberOf: [DEPT] });
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
      await authed('patch', `/trip-schedules/${TRIP}/status`).send({ status: 'done' }).expect(200);
      // ★ THE ACTOR IS NOT OPTIONAL HERE. A board move with no author is the
      // gap `trip_status_history` exists to close, so the route passes the
      // session user and never a value from the body.
      expect(trips.updateStatus).toHaveBeenCalledWith(TRIP, 'done', ACTOR, null);
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
        .send({ scheduledOn: '2026-08-04', id: 'x', createdBy: 'y', archivedAt: 'z' })
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

  describe('★ an employee reading the same routes is unaffected', () => {
    beforeEach(() => {
      accountType = 'employee';
      // An ordinary member: no headship, no global. `trip.read` is `'any'`, so
      // this is the weakest caller the boundary must still let through.
      context = asContext({ memberOf: [DEPT] });
    });

    it.each([...READS])('still allows %s %s', async (method, path) => {
      const response = await authed(method, path);

      expect(response.status).toBe(200);
    });

    it('★ still CREATES a trip — `trip.create` is untouched for employees', async () => {
      // The boundary refuses an account TYPE, not a permission tier. An
      // ordinary member held `trip.create` before this guard existed and holds
      // it now; if that ever stops being true, this fails rather than the
      // change being noticed in production.
      await authed('post', '/trip-schedules').send({ scheduledOn: '2026-08-04' }).expect(201);

      expect(trips.create).toHaveBeenCalled();
    });
  });

  // ===================================================== driver assignment ==

  /**
   * ★ WHO MAY PUT A DRIVER ON A TRIP, AND WHO MAY NOT.
   *
   * `trip.write`: a global administrator or the head of any department. An
   * ordinary member is refused, and a DRIVER account is refused before the
   * permission is even consulted — so a driver cannot assign themselves,
   * assign a colleague, or end anybody's turn, whatever id they hold.
   */
  describe('★ driver assignment', () => {
    const ASSIGN = ['post', `/trip-schedules/${TRIP}/driver-assignments`] as const;
    const REPLACE = ['post', `/trip-schedules/${TRIP}/driver-assignments/replace`] as const;
    const END = ['post', `/trip-schedules/${TRIP}/driver-assignments/end`] as const;
    const body = { driverUserId: DRIVER_USER, reason: 'đổi ca' };

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

      it.each([ASSIGN, REPLACE, END])('is refused %s %s — `trip.write` is not `any`', async (method, path) => {
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

      it('may still read the assignment history — it is `trip.read`', async () => {
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

    describe('a department head', () => {
      beforeEach(() => {
        context = asContext({ headOf: [DEPT], memberOf: [DEPT] });
      });

      it('assigns, against the session user', async () => {
        await authed(...ASSIGN).send({ driverUserId: DRIVER_USER }).expect(201);
        expect(execution.assign).toHaveBeenCalledWith(TRIP, DRIVER_USER, ACTOR);
      });

      it('replaces, with a reason', async () => {
        await authed(...REPLACE).send(body).expect(200);
        expect(execution.replaceDriver).toHaveBeenCalledWith(TRIP, DRIVER_USER, {
          by: ACTOR,
          reason: 'đổi ca',
        });
      });

      it('ends, with a reason', async () => {
        await authed(...END).send({ reason: 'đổi ca' }).expect(200);
        expect(execution.endAssignment).toHaveBeenCalledWith(TRIP, { by: ACTOR, reason: 'đổi ca' });
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
        await authed(...ASSIGN).send({ driverUserId: 'tai-xe-a' }).expect(422);
        noAssignmentWrite();
      });

      it('refuses a replacement with no reason', async () => {
        await authed(...REPLACE).send({ driverUserId: DRIVER_USER }).expect(422);
        noAssignmentWrite();
      });

      it('★ ignores an assignedBy in the body — the actor is the session', async () => {
        await authed(...ASSIGN).send({ driverUserId: DRIVER_USER, assignedBy: DRIVER_USER }).expect(201);
        expect(execution.assign).toHaveBeenCalledWith(TRIP, DRIVER_USER, ACTOR);
      });
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
