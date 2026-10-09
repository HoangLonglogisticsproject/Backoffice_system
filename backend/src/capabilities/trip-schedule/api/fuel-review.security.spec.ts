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
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { FuelReviewService } from '../application/fuel-review.service';
import { FuelReviewController } from './fuel-review.controller';

/**
 * "Kế toán → Nhiên liệu" over HTTP (0038). Pinned: `cost.import` — the
 * SuperAdmin and the ACCOUNTING function — and nobody else; never a driver
 * account; every decision behind CSRF, made as the session user.
 */
describe('fuel-review HTTP security', () => {
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const FILL = '55555555-5555-4555-8555-555555555555';

  let app: INestApplication;
  let context: AuthorizationContext;
  let accountType: 'employee' | 'driver';
  const reviews = { list: jest.fn(), detail: jest.fn(), act: jest.fn() };

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR, global: false, headOf: [], memberOf: [], functions: [], mustChangeSecret: false, ...over,
  });

  beforeEach(async () => {
    context = asContext({ memberOf: ['11111111-1111-1111-1111-111111111111'], functions: ['accounting'] });
    accountType = 'employee';
    for (const mock of Object.values(reviews)) mock.mockReset().mockResolvedValue({ status: 'submitted' });
    const moduleRef = await Test.createTestingModule({
      controllers: [FuelReviewController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: FuelReviewService, useValue: reviews },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: { resolve: jest.fn().mockImplementation(async () => ({ id: ACTOR, displayName: 'Kế Toán', status: 'active', accountType })) },
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
    ['get', '/fuel-reviews'],
    ['get', `/fuel-reviews/${FILL}`],
    ['post', `/fuel-reviews/${FILL}/approve`],
    ['post', `/fuel-reviews/${FILL}/mark-paid`],
    ['post', `/fuel-reviews/${FILL}/request-info`],
    ['post', `/fuel-reviews/${FILL}/reject`],
  ] as const;

  it.each(ROUTES)('★ lets the accounting function %s %s', async (method, path) => {
    expect((await authed(method, path).send({ note: 'lý do' })).status).toBeLessThan(300);
  });

  it.each(['sales', 'dispatch', 'customer_service'] as const)('★ refuses a %s head — approving and paying are accounting’s', async (fn) => {
    context = asContext({ headOf: ['d'], memberOf: ['d'], functions: [fn] });
    for (const [method, path] of ROUTES) expect((await authed(method, path).send({})).status).toBe(403);
    expect(reviews.act).not.toHaveBeenCalled();
  });

  it('★ refuses a driver account — a driver never decides on a fill', async () => {
    accountType = 'driver';
    for (const [method, path] of ROUTES) expect((await authed(method, path).send({})).status).toBe(403);
    expect(reviews.act).not.toHaveBeenCalled();
  });

  it('refuses a decision without the CSRF header, or without a session', async () => {
    const noCsrf = await request(app.getHttpServer()).post(`/fuel-reviews/${FILL}/approve`).set('Cookie', `${SESSION_COOKIE}=token`);
    expect(noCsrf.status).toBe(403);
    expect((await request(app.getHttpServer()).get('/fuel-reviews')).status).toBe(401);
    expect(reviews.act).not.toHaveBeenCalled();
  });

  it('decides as the session user, with the note as sent — and knows only the four decisions', async () => {
    await authed('post', `/fuel-reviews/${FILL}/mark-paid`).send({ note: 'CK VCB 4589', actor: 'someone', status: 'paid' }).expect(200);
    expect(reviews.act).toHaveBeenCalledWith(FILL, 'mark-paid', 'CK VCB 4589', ACTOR);
    expect((await authed('post', `/fuel-reviews/${FILL}/pay-now`).send({})).status).toBe(422);
    expect((await authed('post', `/fuel-reviews/${FILL}/submit`).send({})).status).toBe(422);
  });

  it('lists one state at a time, paged', async () => {
    await authed('get', '/fuel-reviews?status=needs_info&page=2&limit=20').expect(200);
    expect(reviews.list).toHaveBeenCalledWith('needs_info', 2, 20);
    expect((await authed('get', '/fuel-reviews?status=accrued')).status).toBe(422);
  });
});
