import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { ServiceAuthGuard } from '../../../infrastructure/service-auth/service-auth.guard';
import { AiReadModelService } from '../application/ai-read-model.service';
import { AiReadModelController } from './ai-read-model.controller';

/**
 * What a caller can reach on the internal read models, and what a caller
 * cannot. These routes carry NO human guard at all — the only credential
 * that opens them is the AI's service token — so the absence of a session
 * check has to be asserted as a deliberate property, not assumed.
 */
describe('AI read-model HTTP security', () => {
  const TOKEN = 'ai-to-backend-service-token-for-unit-0000';
  const OTHER_DIRECTION = 'backend-to-ai-service-token-for-unit-0000';
  const BEFORE = '2026-09-24T08:00:00.000Z';

  let app: INestApplication;
  let readModel: {
    unassignedTrips: jest.Mock;
    unstartedAssignments: jest.Mock;
    pendingCompletions: jest.Mock;
    lookup: jest.Mock;
  };

  const emptyPage = { items: [], nextCursor: null, hasMore: false };

  beforeEach(async () => {
    readModel = {
      unassignedTrips: jest.fn().mockResolvedValue(emptyPage),
      unstartedAssignments: jest.fn().mockResolvedValue(emptyPage),
      pendingCompletions: jest.fn().mockResolvedValue(emptyPage),
      lookup: jest.fn().mockResolvedValue({ trips: [], assignments: [], completionRequests: [] }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AiReadModelController],
      providers: [
        { provide: AiReadModelService, useValue: readModel },
        { provide: AppConfig, useValue: { serviceTokenAiToBackend: TOKEN } },
        ServiceAuthGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const lists = [
    '/internal/v1/read-models/dispatch/unassigned-trips',
    '/internal/v1/read-models/dispatch/unstarted-assignments',
    '/internal/v1/read-models/dispatch/pending-completions',
  ];
  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${TOKEN}`);

  describe('service authentication', () => {
    it.each(lists)('%s refuses a request with no token', async (path) => {
      const response = await request(app.getHttpServer()).get(`${path}?before=${BEFORE}`).expect(401);
      expect(response.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Service authentication required.' } });
    });

    it('the lookup refuses a request with no token', async () => {
      await request(app.getHttpServer())
        .post('/internal/v1/read-models/dispatch/subjects/lookup')
        .send({ tripIds: [] })
        .expect(401);
      expect(readModel.lookup).not.toHaveBeenCalled();
    });

    it('refuses a wrong token, and never echoes it', async () => {
      const wrong = 'LEAK-ME-IF-YOU-DARE-00000000000000000000';
      const response = await request(app.getHttpServer())
        .get(`${lists[0]}?before=${BEFORE}`)
        .set('Authorization', `Bearer ${wrong}`)
        .expect(401);
      expect(JSON.stringify(response.body)).not.toContain(wrong);
    });

    it("refuses the OTHER direction's token — two secrets, two doors", async () => {
      await request(app.getHttpServer())
        .get(`${lists[0]}?before=${BEFORE}`)
        .set('Authorization', `Bearer ${OTHER_DIRECTION}`)
        .expect(401);
    });

    it('is not opened by a session cookie — there is no human path in here', async () => {
      await request(app.getHttpServer())
        .get(`${lists[0]}?before=${BEFORE}`)
        .set('Cookie', 'bo_session=a-perfectly-good-looking-token')
        .expect(401);
      expect(readModel.unassignedTrips).not.toHaveBeenCalled();
    });
  });

  describe('request validation', () => {
    it.each(lists)('%s requires a parsable `before` instant', async (path) => {
      const missing = await authed(request(app.getHttpServer()).get(path)).expect(422);
      expect(missing.body.error.code).toBe('VALIDATION_FAILED');
      expect(missing.body.error.details).toHaveProperty('before');

      await authed(request(app.getHttpServer()).get(`${path}?before=whenever`)).expect(422);
    });

    it('refuses a limit above the contract maximum rather than clamping it', async () => {
      await authed(request(app.getHttpServer()).get(`${lists[0]}?before=${BEFORE}&limit=201`)).expect(422);
      await authed(request(app.getHttpServer()).get(`${lists[0]}?before=${BEFORE}&limit=0`)).expect(422);
    });

    it('passes the optional `after` bound through, so a caller can walk one band at a time', async () => {
      const after = '2026-09-24T06:00:00.000Z';
      await authed(request(app.getHttpServer()).get(`${lists[0]}?before=${BEFORE}&after=${after}`)).expect(200);
      expect(readModel.unassignedTrips).toHaveBeenCalledWith({
        before: new Date(BEFORE),
        after: new Date(after),
        limit: 50,
        cursor: undefined,
      });
    });

    it('refuses a band that could never contain anything', async () => {
      const notBefore = '2026-09-24T09:00:00.000Z';
      const response = await authed(
        request(app.getHttpServer()).get(`${lists[0]}?before=${BEFORE}&after=${notBefore}`),
      ).expect(422);
      expect(response.body.error.details).toHaveProperty('after');
      expect(readModel.unassignedTrips).not.toHaveBeenCalled();
    });

    it('refuses an unparsable `after`', async () => {
      await authed(request(app.getHttpServer()).get(`${lists[0]}?before=${BEFORE}&after=whenever`)).expect(422);
    });

    it('passes the window, the limit and the cursor through untouched', async () => {
      await authed(request(app.getHttpServer()).get(`${lists[1]}?before=${BEFORE}&limit=7&cursor=abc`)).expect(200);
      expect(readModel.unstartedAssignments).toHaveBeenCalledWith({
        before: new Date(BEFORE),
        limit: 7,
        cursor: 'abc',
      });
    });

    it('defaults the page size and treats an empty cursor as absent', async () => {
      await authed(request(app.getHttpServer()).get(`${lists[2]}?before=${BEFORE}&cursor=`)).expect(200);
      expect(readModel.pendingCompletions).toHaveBeenCalledWith({
        before: new Date(BEFORE),
        limit: 50,
        cursor: undefined,
      });
    });

    it('refuses a lookup id that is not a UUID', async () => {
      const response = await authed(
        request(app.getHttpServer()).post('/internal/v1/read-models/dispatch/subjects/lookup'),
      )
        .send({ tripIds: ['not-a-uuid'] })
        .expect(422);
      // The array form: the key IS `tripIds.0`, and the string form would
      // read the dot as a path into a nested object.
      expect(response.body.error.details).toHaveProperty(['tripIds.0']);
      expect(readModel.lookup).not.toHaveBeenCalled();
    });

    it('defaults the three id lists so a partial body is still well-formed', async () => {
      await authed(request(app.getHttpServer()).post('/internal/v1/read-models/dispatch/subjects/lookup'))
        .send({ tripIds: ['11111111-1111-4111-8111-111111111111'] })
        .expect(200);
      expect(readModel.lookup).toHaveBeenCalledWith({
        tripIds: ['11111111-1111-4111-8111-111111111111'],
        assignmentIds: [],
        completionRequestIds: [],
      });
    });
  });
});
