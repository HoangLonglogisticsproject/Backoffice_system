import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { NotFoundError } from '../../../common/errors/domain.error';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { PermissionGuard } from '../../../core/authorization/api/permission.guard';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import type { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import type { AccountType } from '../../../core/users/domain/user.entity';
import { BookingExportService } from '../application/booking-export.service';
import type { BookingExport } from '../domain/booking-export';
import { BookingExportController } from './booking-export.controller';

/**
 * "Tải booking PNG" over HTTP.
 *
 * ★ THE POLICY THIS FILE PINS. The trip detail's own rule — `trip.read`,
 * Backoffice only — and ONE document for every reader: the controller hands the
 * service the trip id and nothing about the caller, so no role can widen or
 * narrow what comes back.
 */

/** Fails to COMPILE if the contract ever gains one of these keys — not null, not hidden: absent. */
type FinancialOrInternal =
  | 'sellPrice' | 'purchasePrice' | 'costSummary' | 'margin' | 'vehicleCosts' | 'tripCosts' | 'note' | 'status' | 'id';
const contractHasNone: [Extract<keyof BookingExport, FinancialOrInternal>] extends [never] ? true : false = true;

const TRIP = '11111111-1111-4111-8111-111111111111';
const BOOKING: BookingExport = {
  scheduledOn: '2026-10-06',
  scheduledPickupAt: new Date('2026-10-06T09:00:00Z'),
  scheduledDeliveryAt: null,
  pickup: { name: 'Kho Củ Chi', address: 'Lô B2-7, KCN Tân Phú Trung', contact: 'Anh Tuấn — 0909 123 456' },
  delivery: { name: null, address: '12 Nguyễn Huệ', contact: null },
  customerName: 'KAPV',
  cargoInfo: '24 kiện',
  driverInstructions: null,
  crew: [{ plate: '51H-27314', driverName: 'Nguyễn Văn A' }],
};

describe('booking export HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const ACTOR = '33333333-3333-3333-3333-333333333333';

  let app: INestApplication;
  let context: AuthorizationContext;
  let accountType: AccountType;
  let bookings: { find: jest.Mock };

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
    bookings = { find: jest.fn().mockResolvedValue(BOOKING) };

    const moduleRef = await Test.createTestingModule({
      controllers: [BookingExportController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        BackofficeOnlyGuard,
        { provide: BookingExportService, useValue: bookings },
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

  const read = (tripId = TRIP) =>
    request(app.getHttpServer())
      .get(`/trip-schedules/${tripId}/booking-export`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  it('★ the contract type has no financial or internal key at all', () => {
    expect(contractHasNone).toBe(true);
  });

  it('★ SuperAdmin and every booking function, head or member, get the SAME document', async () => {
    const readers = [
      asContext({ global: true }),
      ...(['dispatch', 'sales', 'customer_service', 'accounting'] as const).flatMap((fn) => [
        asContext({ memberOf: ['d1'], functions: [fn] }),
        asContext({ memberOf: ['d1'], headOf: ['d1'], functions: [fn] }),
      ]),
    ];
    const bodies: unknown[] = [];
    for (const reader of readers) {
      context = reader;
      bodies.push((await read().expect(200)).body);
    }

    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(Object.keys(bodies[0] as object).sort()).toEqual([
      'cargoInfo', 'crew', 'customerName', 'delivery', 'driverInstructions', 'pickup',
      'scheduledDeliveryAt', 'scheduledOn', 'scheduledPickupAt',
    ]);
    // Nothing about the caller reaches the read: the trip id, and only that.
    for (const call of bookings.find.mock.calls) expect(call).toEqual([TRIP]);
  });

  it('★ refuses a driver account outright — even one holding the global tier', async () => {
    accountType = 'driver';
    const response = await read();
    expect([response.status, response.body.error?.code]).toEqual([403, 'FORBIDDEN']);
    expect(bookings.find).not.toHaveBeenCalled();
  });

  it('refuses a unit with no booking function, an anonymous caller and a temporary credential', async () => {
    context = asContext({ memberOf: ['d1'], headOf: ['d1'], functions: [] });
    expect((await read()).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/trip-schedules/${TRIP}/booking-export`)).status).toBe(401);
    context = asContext({ global: true, mustChangeSecret: true });
    expect((await read()).status).toBe(403);
    expect(bookings.find).not.toHaveBeenCalled();
  });

  it('a malformed id is 422 before any read; an unknown or archived trip is 404', async () => {
    expect((await read('not-a-uuid')).status).toBe(422);
    expect(bookings.find).not.toHaveBeenCalled();

    bookings.find.mockRejectedValueOnce(new NotFoundError('Trip not found.'));
    const missing = await read();
    expect([missing.status, missing.body.error?.code]).toEqual([404, 'NOT_FOUND']);
  });
});
