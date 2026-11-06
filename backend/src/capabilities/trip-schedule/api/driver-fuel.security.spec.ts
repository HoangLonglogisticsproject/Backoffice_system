import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { ProvisionedAccountGuard } from '../../../core/authorization/api/provisioned-account.guard';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import type { AuthorizationContext } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { DriverOnlyGuard } from '../../../core/identity/api/driver-only.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { DriverFuelService } from '../application/driver-fuel.service';
import { FuelEvidenceService } from '../application/fuel-evidence.service';
import { DriverFuelController } from './driver-fuel.controller';

/**
 * The driver's door to their fuel (0038). Pinned: a DRIVER account only —
 * never an office account, whatever it holds — every write behind CSRF, a
 * temporary password refused, and the session the only "who": no body or
 * query names another driver.
 */
describe('driver-fuel HTTP security', () => {
  const DRIVER = '33333333-3333-3333-3333-333333333333';
  const FILL = '55555555-5555-4555-8555-555555555555';
  const IMAGE = '99999999-9999-4999-8999-999999999999';
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  let app: INestApplication;
  let accountType: 'employee' | 'driver';
  let context: AuthorizationContext;
  const evidence = { stage: jest.fn(), staged: jest.fn(), discard: jest.fn(), contentOfUploader: jest.fn() };
  const fills = { mine: jest.fn(), detail: jest.fn(), resubmit: jest.fn() };

  beforeEach(async () => {
    accountType = 'driver';
    context = { userId: DRIVER, global: false, headOf: [], memberOf: [], functions: [], mustChangeSecret: false };
    for (const mock of [...Object.values(evidence), ...Object.values(fills)]) mock.mockReset().mockResolvedValue({});
    fills.mine.mockResolvedValue([]);
    evidence.staged.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      controllers: [DriverFuelController],
      providers: [
        Reflector,
        AuthGuard,
        CsrfGuard,
        DriverOnlyGuard,
        ProvisionedAccountGuard,
        { provide: FuelEvidenceService, useValue: evidence },
        { provide: DriverFuelService, useValue: fills },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: { resolve: jest.fn().mockImplementation(async () => ({ id: DRIVER, displayName: 'Tài Xế', status: 'active', accountType })) },
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
    request(app.getHttpServer())[method](path).set('Cookie', `${SESSION_COOKIE}=token`).set('X-Requested-With', 'XMLHttpRequest');
  const ROUTES = [
    ['get', '/driver/fuel-evidence/staged'],
    ['post', `/driver/fuel-evidence/${IMAGE}/discard`],
    ['get', '/driver/fuel-submissions'],
    ['get', `/driver/fuel-submissions/${FILL}`],
    ['post', `/driver/fuel-submissions/${FILL}/resubmit`],
  ] as const;

  it.each(ROUTES)('★ refuses an OFFICE account on %s %s — even the SuperAdmin', async (method, path) => {
    accountType = 'employee';
    context = { ...context, global: true };
    expect((await authed(method, path).send({})).status).toBe(403);
  });

  it.each(ROUTES)('refuses %s %s without a session', async (method, path) => {
    expect((await request(app.getHttpServer())[method](path).send({})).status).toBe(401);
  });

  it('refuses a driver still on a temporary password', async () => {
    context = { ...context, mustChangeSecret: true };
    expect((await authed('get', '/driver/fuel-submissions')).status).toBe(403);
  });

  it('stages a photo for the session driver, behind CSRF', async () => {
    await authed('post', '/driver/fuel-evidence').attach('file', JPEG, 'pump.jpg').expect(201);
    expect(evidence.stage.mock.calls[0]?.[1]).toBe(DRIVER);
    const noCsrf = await request(app.getHttpServer()).post('/driver/fuel-evidence').set('Cookie', `${SESSION_COOKIE}=token`).attach('file', JPEG, 'a.jpg');
    expect(noCsrf.status).toBe(403);
  });

  it('★ reads only the session driver’s fills and photos — a query naming another driver changes nothing', async () => {
    await authed('get', '/driver/fuel-submissions?status=needs_info,submitted&day=2026-10-08&driverUserId=someone').expect(200);
    expect(fills.mine).toHaveBeenCalledWith(DRIVER, { statuses: ['needs_info', 'submitted'], businessDate: '2026-10-08' });
    await authed('get', `/driver/fuel-evidence/${IMAGE}/content`);
    expect(evidence.contentOfUploader).toHaveBeenCalledWith(IMAGE, DRIVER);
    await authed('get', '/driver/fuel-evidence/staged').expect(200);
    expect(evidence.staged).toHaveBeenCalledWith(DRIVER);
    expect((await authed('get', '/driver/fuel-submissions?status=paid,unknown')).status).toBe(422);
  });

  it('resubmits with what the receipt says and the driver’s own photos — nothing else from the body', async () => {
    await authed('post', `/driver/fuel-submissions/${FILL}/resubmit`)
      .send({ documentNumber: '0007', evidence: [{ id: IMAGE, type: 'tax_invoice' }], note: 'Đã bổ sung', status: 'approved', amount: '1' })
      .expect(200);
    expect(fills.resubmit).toHaveBeenCalledWith(DRIVER, FILL, {
      facts: { documentNumber: '0007' },
      evidence: [{ id: IMAGE, type: 'tax_invoice' }],
      note: 'Đã bổ sung',
    });
  });
});
