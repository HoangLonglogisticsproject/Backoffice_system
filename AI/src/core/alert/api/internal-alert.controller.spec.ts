import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { ServiceAuthGuard } from '../../../infrastructure/service-auth/service-auth.guard';
import { signTrustedContext } from '../../../infrastructure/service-auth/trusted-context';
import { TrustedContextVerifier } from '../../../infrastructure/service-auth/trusted-context.verifier';
import { AlertService } from '../application/alert.service';
import { InternalAlertController } from './internal-alert.controller';

/**
 * The HTTP surface WITHOUT a database: what a caller sees for the guard, the
 * context check and the validation envelope. The service is a mock; the
 * lifecycle itself is proven in tests/integration.
 */
describe('InternalAlertController — auth and validation surface', () => {
  const SERVICE_TOKEN = 'backend-to-ai-service-token-for-unit-00000';
  const CONTEXT_SECRET = 'trusted-context-secret-for-unit-0000000000';
  const ALERT_ID = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  let app: INestApplication;
  let service: { list: jest.Mock; summary: jest.Mock; getById: jest.Mock; historyOf: jest.Mock; transition: jest.Mock };

  const context = () => {
    const now = Math.floor(Date.now() / 1000);
    return signTrustedContext({ sub: USER, perms: [], fn: [], aud: 'ai', iat: now, exp: now + 60, cid: 'c' }, CONTEXT_SECRET);
  };

  beforeAll(async () => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      summary: jest.fn().mockResolvedValue({ open: 0, acknowledged: 0, dismissed: 0, bySeverity: {} }),
      getById: jest.fn().mockResolvedValue({ id: ALERT_ID, status: 'open' }),
      historyOf: jest.fn().mockResolvedValue([]),
      transition: jest.fn().mockResolvedValue({ id: ALERT_ID, status: 'acknowledged' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalAlertController],
      providers: [
        { provide: AlertService, useValue: service },
        { provide: AppConfig, useValue: { serviceTokenBackendToAi: SERVICE_TOKEN, trustedContextSecret: CONTEXT_SECRET } },
        ServiceAuthGuard,
        TrustedContextVerifier,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${SERVICE_TOKEN}`);

  it('every route is behind the service guard', async () => {
    await request(app.getHttpServer()).get('/internal/v1/alerts').expect(401);
    await request(app.getHttpServer()).get('/internal/v1/alerts/summary').expect(401);
    await request(app.getHttpServer()).get(`/internal/v1/alerts/${ALERT_ID}`).expect(401);
    await request(app.getHttpServer()).post(`/internal/v1/alerts/${ALERT_ID}/transitions`).send({}).expect(401);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.transition).not.toHaveBeenCalled();
  });

  it('a wrong bearer is refused with the shared envelope and is not echoed', async () => {
    const res = await request(app.getHttpServer())
      .get('/internal/v1/alerts')
      .set('Authorization', 'Bearer wrong-wrong-wrong-wrong-wrong-wrong-wrong')
      .expect(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Service authentication required.' } });
  });

  it('passes the parsed query to the service', async () => {
    await authed(request(app.getHttpServer()).get('/internal/v1/alerts?status=dismissed&severity=high&limit=5')).expect(200);
    expect(service.list).toHaveBeenCalledWith({
      statuses: ['dismissed'],
      severities: ['high'],
      detectorCode: undefined,
      tripId: undefined,
      limit: 5,
      cursor: undefined,
    });
  });

  it('"summary" is a route, not an id', async () => {
    await authed(request(app.getHttpServer()).get('/internal/v1/alerts/summary')).expect(200);
    expect(service.summary).toHaveBeenCalled();
    expect(service.getById).not.toHaveBeenCalled();
  });

  it('a malformed id answers 422 in the shared envelope', async () => {
    const res = await authed(request(app.getHttpServer()).get('/internal/v1/alerts/nope')).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  describe('transitions', () => {
    const post = (body: Record<string, unknown>) =>
      authed(request(app.getHttpServer()).post(`/internal/v1/alerts/${ALERT_ID}/transitions`)).send(body);

    it('a missing context is a validation failure; a bad one is 401 with its own code', async () => {
      const missing = await post({ to: 'acknowledged' }).expect(422);
      expect(missing.body.error.details).toHaveProperty('context');

      const bad = await post({ to: 'acknowledged', context: 'v1.x.y' }).expect(401);
      expect(bad.body.error.code).toBe('INVALID_TRUSTED_CONTEXT');
      expect(service.transition).not.toHaveBeenCalled();
    });

    it('an unknown target is a validation failure', async () => {
      const res = await post({ to: 'open', context: context() }).expect(422);
      expect(res.body.error.details).toHaveProperty('to');
    });

    it('a verified context becomes the user actor, and the correlation id travels', async () => {
      await post({ to: 'acknowledged', context: context() }).set('X-Correlation-Id', 'abc').expect(200);
      expect(service.transition).toHaveBeenCalledWith({
        alertId: ALERT_ID,
        to: 'acknowledged',
        actor: { type: 'user', id: USER },
        reason: null,
        correlationId: 'abc',
      });
    });
  });
});
