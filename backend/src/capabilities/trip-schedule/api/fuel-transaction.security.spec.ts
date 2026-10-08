import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { PermissionGuard } from '../../../core/authorization/api/permission.guard';
import type { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { FuelTransactionService } from '../application/fuel-transaction.service';
import { FuelTransactionController } from './fuel-transaction.controller';

/**
 * A fill's fuel transaction, over HTTP (0037). The policy pinned here:
 * `cost.import` — the SuperAdmin and the ACCOUNTING function, member or head —
 * and nobody else; never a driver account; every write behind CSRF.
 */
describe('fuel-transaction HTTP security', () => {
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const VEHICLE = '44444444-4444-4444-4444-444444444444';
  const TRIP = '55555555-5555-5555-5555-555555555555';
  const COST = '88888888-8888-8888-8888-888888888888';
  const IMAGE = '99999999-9999-9999-9999-999999999999';

  let app: INestApplication;
  let context: AuthorizationContext;
  let accountType: 'employee' | 'driver';
  const fuel = {
    viewOfVehicleCost: jest.fn(),
    recordOnVehicleCost: jest.fn(),
    viewOfTripCost: jest.fn(),
    recordOnTripCost: jest.fn(),
  };

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    functions: [],
    mustChangeSecret: false,
    ...over,
  });
  const accountant = () => asContext({ memberOf: ['11111111-1111-1111-1111-111111111111'], functions: ['accounting'] });

  beforeEach(async () => {
    context = accountant();
    accountType = 'employee';
    for (const mock of Object.values(fuel)) mock.mockReset().mockResolvedValue({ fuelTransactionId: null });

    const moduleRef = await Test.createTestingModule({
      controllers: [FuelTransactionController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: FuelTransactionService, useValue: fuel },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest.fn().mockImplementation(async () => ({ id: ACTOR, displayName: 'Kế Toán', status: 'active', accountType })),
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

  const vehicleRoute = `/trip-vehicles/${VEHICLE}/costs/${COST}/fuel-transaction`;
  const tripRoute = `/trip-schedules/${TRIP}/costs/${COST}/fuel-transaction`;
  const ROUTES = [
    ['get', vehicleRoute],
    ['post', vehicleRoute],
    ['get', tripRoute],
    ['post', tripRoute],
  ] as const;
  const body = { evidence: [{ id: IMAGE, type: 'receipt' }], vendorName: 'Cây xăng X' };
  const authed = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('Cookie', `${SESSION_COOKIE}=token`).set('X-Requested-With', 'XMLHttpRequest');

  it.each(ROUTES)('refuses %s %s without a session', async (method, path) => {
    const response = await request(app.getHttpServer())[method](path).send(body);
    expect(response.status).toBe(401);
  });

  it.each(ROUTES)('★ lets the accounting function %s %s', async (method, path) => {
    const response = await authed(method, path).send(body);
    expect(response.status).toBeLessThan(300);
  });

  it.each(ROUTES)('lets the SuperAdmin %s %s', async (method, path) => {
    context = asContext({ global: true });
    expect((await authed(method, path).send(body)).status).toBeLessThan(300);
  });

  it.each(['sales', 'dispatch', 'customer_service'] as const)('★ refuses a %s head — fuel evidence is accounting’s', async (fn) => {
    context = asContext({ headOf: ['d'], memberOf: ['d'], functions: [fn] });
    for (const [method, path] of ROUTES) expect((await authed(method, path).send(body)).status).toBe(403);
    expect(fuel.recordOnVehicleCost).not.toHaveBeenCalled();
  });

  it('refuses a driver account even with the accounting context — the backoffice door', async () => {
    accountType = 'driver';
    for (const [method, path] of ROUTES) expect((await authed(method, path).send(body)).status).toBe(403);
  });

  it('refuses a caller still holding a temporary credential', async () => {
    context = asContext({ global: true, mustChangeSecret: true });
    expect((await authed('get', vehicleRoute)).status).toBe(403);
  });

  it('refuses a write without the CSRF header', async () => {
    const response = await request(app.getHttpServer()).post(vehicleRoute).set('Cookie', `${SESSION_COOKIE}=token`).send(body);
    expect(response.status).toBe(403);
    expect(fuel.recordOnVehicleCost).not.toHaveBeenCalled();
  });

  it('passes the parsed command and the session actor — never a lorry or day from the body on a vehicle cost', async () => {
    await authed('post', vehicleRoute).send({ ...body, vehicleId: TRIP, businessDate: '2026-01-01', liters: '50' }).expect(201);
    expect(fuel.recordOnVehicleCost).toHaveBeenCalledWith(
      VEHICLE,
      COST,
      { facts: { vendorName: 'Cây xăng X' }, evidence: [{ id: IMAGE, type: 'receipt' }] },
      ACTOR,
    );
  });

  it('gives the trip route its lorry and day — and its readings as facts, added once each', async () => {
    await authed('post', tripRoute).send({ vehicleId: VEHICLE, businessDate: '2026-10-06', liters: '26.00', odometerKm: 1200 }).expect(201);
    expect(fuel.recordOnTripCost).toHaveBeenCalledWith(
      TRIP,
      COST,
      { facts: { liters: '26.00', odometerKm: 1200 }, evidence: [], vehicleId: VEHICLE, businessDate: '2026-10-06' },
      ACTOR,
    );
  });

  it.each([
    ['nothing at all', {}],
    ['an image id that is not a UUID', { evidence: [{ id: 'nope' }] }],
    ['the same image twice', { evidence: [{ id: IMAGE }, { id: IMAGE }] }],
    ['an unknown evidence type', { evidence: [{ id: IMAGE, type: 'selfie' }] }],
    ['eleven images', { evidence: Array.from({ length: 11 }, (_, i) => ({ id: `99999999-9999-9999-9999-9999999999${10 + i}` })) }],
  ])('answers 422 for %s', async (_case, payload) => {
    const response = await authed('post', vehicleRoute).send(payload);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('answers 422 for liters a trip line cannot record', async () => {
    expect((await authed('post', tripRoute).send({ vehicleId: VEHICLE, liters: '-3' })).status).toBe(422);
  });
});
