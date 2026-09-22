import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { DomainErrorFilter } from '@common/http/domain-error.filter';
import { DATABASE } from '@common/types/database.port';
import { AppConfig } from '@config/app.config';
import { InternalAlertController } from '@core/alert/api/internal-alert.controller';
import { AlertService } from '@core/alert/application/alert.service';
import { AlertHistoryRepository } from '@core/alert/persistence/alert-history.repository';
import { AlertRepository } from '@core/alert/persistence/alert.repository';
import { ScanRunRepository } from '@core/alert/persistence/scan-run.repository';
import { DatabaseService } from '@infrastructure/database/database.service';
import { ServiceAuthGuard } from '@infrastructure/service-auth/service-auth.guard';
import { signTrustedContext } from '@infrastructure/service-auth/trusted-context';
import { TrustedContextVerifier } from '@infrastructure/service-auth/trusted-context.verifier';
import {
  TEST_URL,
  describeIntegration,
  migrateTestSchema,
  openTestSchema,
  signal,
} from '../helpers/integration-database';

/**
 * The internal Alert API end to end: real HTTP through the real guard, the
 * real verifier, the real service and a real PostgreSQL. Seeded through the
 * application service — there is no create route, by design.
 */
const SCHEMA = 'ai_itest_api';
const SERVICE_TOKEN = 'backend-to-ai-service-token-for-itest-0000';
const CONTEXT_SECRET = 'trusted-context-secret-for-itest-000000000';
const USER_A = '11111111-1111-4111-8111-111111111111';

describeIntegration('Internal Alert API against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let pool: Pool;
  let service: AlertService;
  let scanRuns: ScanRunRepository;

  const context = (overrides: Partial<Parameters<typeof signTrustedContext>[0]> = {}): string => {
    const now = Math.floor(Date.now() / 1000);
    return signTrustedContext(
      { sub: USER_A, perms: ['alert.operational.write'], fn: ['dispatch'], aud: 'ai', iat: now, exp: now + 60, cid: 'req-1', ...overrides },
      CONTEXT_SECRET,
    );
  };

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${SERVICE_TOKEN}`);

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await migrateTestSchema(pool, SCHEMA);

    const config = {
      nodeEnv: 'test',
      databaseUrl: TEST_URL as string,
      dbSchema: SCHEMA,
      serviceTokenBackendToAi: SERVICE_TOKEN,
      trustedContextSecret: CONTEXT_SECRET,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalAlertController],
      providers: [
        { provide: AppConfig, useValue: config },
        DatabaseService,
        { provide: DATABASE, useExisting: DatabaseService },
        AlertRepository,
        AlertHistoryRepository,
        ScanRunRepository,
        AlertService,
        ServiceAuthGuard,
        TrustedContextVerifier,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
    service = moduleRef.get(AlertService);
    scanRuns = moduleRef.get(ScanRunRepository);
  });

  afterAll(async () => {
    await app.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE alert_scan_observations, alert_transition_history, alerts, scan_runs');
  });

  describe('service authentication', () => {
    it('refuses every route without a bearer token', async () => {
      await request(app.getHttpServer()).get('/internal/v1/alerts').expect(401);
      await request(app.getHttpServer()).get('/internal/v1/alerts/summary').expect(401);
      await request(app.getHttpServer()).get(`/internal/v1/alerts/${USER_A}`).expect(401);
      const res = await request(app.getHttpServer())
        .post(`/internal/v1/alerts/${USER_A}/transitions`)
        .send({ to: 'acknowledged', context: context() })
        .expect(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });

    it('refuses a wrong token, and never echoes it', async () => {
      const wrong = 'not-the-service-token-at-all-000000000000';
      const res = await request(app.getHttpServer())
        .get('/internal/v1/alerts')
        .set('Authorization', `Bearer ${wrong}`)
        .expect(401);
      expect(JSON.stringify(res.body)).not.toContain(wrong);
    });
  });

  describe('reads', () => {
    it('lists live alerts by default, newest activity first, paged', async () => {
      const a = (await service.recordSignal(signal({ detectorCode: 'A' }))).alert;
      const b = (await service.recordSignal(signal({ detectorCode: 'B' }))).alert;
      const verified = await scanRuns.start({ detectorCode: 'B', detectorVersion: 1, phase: 'resolution' });
      await scanRuns.finish(verified.id, { outcome: 'succeeded' });
      await service.resolveBySystem({ alertId: b.id, scanRunId: verified.id });
      const c = (await service.recordSignal(signal({ detectorCode: 'C' }))).alert;

      const res = await authed(request(app.getHttpServer()).get('/internal/v1/alerts?limit=1')).expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([c.id]);
      expect(res.body.hasMore).toBe(true);

      const next = await authed(
        request(app.getHttpServer()).get(`/internal/v1/alerts?limit=1&cursor=${encodeURIComponent(res.body.nextCursor)}`),
      ).expect(200);
      expect(next.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
      expect(next.body.hasMore).toBe(false);

      const resolved = await authed(request(app.getHttpServer()).get('/internal/v1/alerts?status=resolved')).expect(200);
      expect(resolved.body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
    });

    it('filters by severity, detector and trip', async () => {
      const trip = '33333333-3333-4333-8333-333333333333';
      const hit = (await service.recordSignal(signal({ detectorCode: 'X', severity: 'high', tripId: trip }))).alert;
      await service.recordSignal(signal({ detectorCode: 'Y', severity: 'warning', tripId: trip }));

      const res = await authed(
        request(app.getHttpServer()).get(`/internal/v1/alerts?severity=high&detectorCode=X&tripId=${trip}`),
      ).expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([hit.id]);
    });

    it('refuses an unknown status or a malformed cursor with the validation envelope', async () => {
      const bad = await authed(request(app.getHttpServer()).get('/internal/v1/alerts?status=archived')).expect(422);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
      const cursor = await authed(request(app.getHttpServer()).get('/internal/v1/alerts?cursor=nope')).expect(422);
      expect(cursor.body.error.details).toHaveProperty('cursor');
    });

    it('summarises live incidents', async () => {
      await service.recordSignal(signal({ severity: 'high' }));
      const res = await authed(request(app.getHttpServer()).get('/internal/v1/alerts/summary')).expect(200);
      expect(res.body).toEqual({ open: 1, acknowledged: 0, dismissed: 0, bySeverity: { info: 0, warning: 0, high: 1, critical: 0 } });
    });

    it('returns detail with history, 404 for an unknown id, 422 for a malformed one', async () => {
      const { alert } = await service.recordSignal(signal());
      const res = await authed(request(app.getHttpServer()).get(`/internal/v1/alerts/${alert.id}`)).expect(200);
      expect(res.body.alert.id).toBe(alert.id);
      expect(res.body.history).toHaveLength(1);
      expect(res.body.history[0]).toMatchObject({ fromStatus: null, toStatus: 'open', actorType: 'system', actorId: null });

      await authed(request(app.getHttpServer()).get(`/internal/v1/alerts/${USER_A}`)).expect(404);
      await authed(request(app.getHttpServer()).get('/internal/v1/alerts/not-a-uuid')).expect(422);
    });
  });

  describe('transitions', () => {
    const transition = (id: string, body: Record<string, unknown>) =>
      authed(request(app.getHttpServer()).post(`/internal/v1/alerts/${id}/transitions`)).send(body);

    it('acknowledges, dismisses with a reason, and records the vouched-for user as actor', async () => {
      const { alert } = await service.recordSignal(signal());

      const acked = await transition(alert.id, { to: 'acknowledged', context: context() }).expect(200);
      expect(acked.body.alert.status).toBe('acknowledged');
      expect(acked.body.alert.acknowledgedBy).toBe(USER_A);

      const dismissed = await transition(alert.id, { to: 'dismissed', reason: 'handled', context: context() })
        .set('X-Correlation-Id', 'corr-77')
        .expect(200);
      expect(dismissed.body.alert.status).toBe('dismissed');
      expect(dismissed.body.history.at(-1)).toMatchObject({
        toStatus: 'dismissed',
        actorType: 'user',
        actorId: USER_A,
        reason: 'handled',
        correlationId: 'corr-77',
      });
    });

    it('falls back to the context correlation id when no header is sent', async () => {
      const { alert } = await service.recordSignal(signal());
      const res = await transition(alert.id, { to: 'resolved', context: context({ cid: 'from-context' }) }).expect(200);
      expect(res.body.alert.resolutionKind).toBe('user');
      expect(res.body.history.at(-1).correlationId).toBe('from-context');
    });

    it('refuses to dismiss without a reason (422) and changes nothing', async () => {
      const { alert } = await service.recordSignal(signal());
      const res = await transition(alert.id, { to: 'dismissed', context: context() }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: expect.any(String) } });
      expect((await service.getById(alert.id)).status).toBe('open');
    });

    it('answers 409 with its own code for an invalid move', async () => {
      const { alert } = await service.recordSignal(signal());
      await transition(alert.id, { to: 'acknowledged', context: context() }).expect(200);
      const res = await transition(alert.id, { to: 'acknowledged', context: context() }).expect(409);
      expect(res.body.error.code).toBe('INVALID_ALERT_TRANSITION');
    });

    it('refuses a missing, tampered, expired or mis-audienced context with 401 — before looking anything up', async () => {
      const { alert } = await service.recordSignal(signal());
      const now = Math.floor(Date.now() / 1000);

      const missing = await transition(alert.id, { to: 'acknowledged' }).expect(422);
      expect(missing.body.error.details).toHaveProperty('context');

      const tampered = context().replace(/\.[^.]+$/, '.AAAA');
      const t = await transition(alert.id, { to: 'acknowledged', context: tampered }).expect(401);
      expect(t.body.error.code).toBe('INVALID_TRUSTED_CONTEXT');

      await transition(alert.id, { to: 'acknowledged', context: context({ iat: now - 120, exp: now - 60 }) }).expect(401);
      await transition(alert.id, { to: 'acknowledged', context: signTrustedContext({ sub: USER_A, perms: [], fn: [], aud: 'ai', iat: now, exp: now + 60, cid: 'x' }, 'the-wrong-secret-entirely-0000000000000') }).expect(401);

      // Even a nonexistent alert answers 401, not 404, when the context is bad.
      await transition(USER_A, { to: 'acknowledged', context: tampered }).expect(401);

      expect((await service.getById(alert.id)).status).toBe('open');
    });

    it('validates the body shape before anything else', async () => {
      const { alert } = await service.recordSignal(signal());
      const res = await transition(alert.id, { to: 'reopened', context: context() }).expect(422);
      expect(res.body.error.details).toHaveProperty('to');
    });
  });
});
