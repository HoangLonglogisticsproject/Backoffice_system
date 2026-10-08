import { Readable } from 'node:stream';
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
import { FuelEvidenceService } from '../application/fuel-evidence.service';
import { TRANSPORT_LIMIT_BYTES } from '../domain/fuel-evidence';
import { FuelEvidenceController } from './fuel-evidence.controller';

/**
 * Evidence images over HTTP (0037): staged and served by `cost.import`,
 * retired by `cost.void` alone; the file is never read for a caller the
 * guards refuse; images go out private, uncached and named by id.
 */
describe('fuel-evidence HTTP security', () => {
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const IMAGE = '99999999-9999-9999-9999-999999999999';
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  let app: INestApplication;
  let context: AuthorizationContext;
  const evidence = { stage: jest.fn(), staged: jest.fn(), discard: jest.fn(), content: jest.fn(), retire: jest.fn() };

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: ['11111111-1111-1111-1111-111111111111'],
    functions: ['accounting'],
    mustChangeSecret: false,
    ...over,
  });

  beforeEach(async () => {
    context = asContext();
    evidence.stage.mockReset().mockResolvedValue({ id: IMAGE });
    evidence.discard.mockReset().mockResolvedValue(undefined);
    evidence.retire.mockReset().mockResolvedValue({ id: IMAGE });
    evidence.content.mockReset().mockImplementation(async () => ({
      stream: Readable.from([JPEG]),
      mimeType: 'image/jpeg',
      byteSize: JPEG.length,
      filename: `${IMAGE}.jpg`,
    }));

    const moduleRef = await Test.createTestingModule({
      controllers: [FuelEvidenceController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: FuelEvidenceService, useValue: evidence },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: { resolve: jest.fn().mockResolvedValue({ id: ACTOR, displayName: 'Kế Toán', status: 'active' }) },
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

  it('★ stages a multipart image for the accounting function, with its bytes and device name', async () => {
    await authed('post', '/fuel-evidence').attach('file', JPEG, 'IMG_0042.JPG').expect(201);
    const [file, actor] = evidence.stage.mock.calls[0];
    expect(Buffer.compare(file.buffer, JPEG)).toBe(0);
    expect(file.originalname).toBe('IMG_0042.JPG');
    expect(actor).toBe(ACTOR);
  });

  it('★ refuses a caller without cost.import before the file is read', async () => {
    context = asContext({ functions: ['sales'] });
    const response = await authed('post', '/fuel-evidence').attach('file', JPEG, 'a.jpg');
    expect(response.status).toBe(403);
    expect(evidence.stage).not.toHaveBeenCalled();
  });

  it('refuses an upload without a session or without the CSRF header', async () => {
    expect((await request(app.getHttpServer()).post('/fuel-evidence').attach('file', JPEG, 'a.jpg')).status).toBe(401);
    const noCsrf = await request(app.getHttpServer())
      .post('/fuel-evidence')
      .set('Cookie', `${SESSION_COOKIE}=token`)
      .attach('file', JPEG, 'a.jpg');
    expect(noCsrf.status).toBe(403);
    expect(evidence.stage).not.toHaveBeenCalled();
  });

  it('answers 422 when no file is attached', async () => {
    const response = await authed('post', '/fuel-evidence').send({});
    expect(response.status).toBe(422);
    expect(response.body.error.details).toEqual({ file: 'REQUIRED' });
  });

  it('answers 413 above the transport ceiling, before the service sees anything', async () => {
    const response = await authed('post', '/fuel-evidence').attach('file', Buffer.alloc(TRANSPORT_LIMIT_BYTES + 1), 'big.jpg');
    expect(response.status).toBe(413);
    expect(evidence.stage).not.toHaveBeenCalled();
  });

  it('★ serves an image private, uncached and named by its id — the type its bytes proved', async () => {
    const response = await authed('get', `/fuel-evidence/${IMAGE}/content`).expect(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toBe(`inline; filename="${IMAGE}.jpg"`);
    expect(Buffer.compare(response.body as Buffer, JPEG)).toBe(0);
    expect(evidence.content).toHaveBeenCalledWith(IMAGE, ACTOR);
  });

  it('★ lists the CALLER’s own waiting images — a returning uploader finds them again', async () => {
    evidence.staged.mockResolvedValue([]);
    await authed('get', '/fuel-evidence/staged').expect(200);
    expect(evidence.staged).toHaveBeenCalledWith(ACTOR);
    expect((await request(app.getHttpServer()).get('/fuel-evidence/staged')).status).toBe(401);
    context = asContext({ functions: ['sales'] });
    expect((await authed('get', '/fuel-evidence/staged')).status).toBe(403);
    expect(evidence.staged).toHaveBeenCalledTimes(1);
  });

  it('lets the uploader discard a staged image', async () => {
    await authed('post', `/fuel-evidence/${IMAGE}/discard`).expect(204);
    expect(evidence.discard).toHaveBeenCalledWith(IMAGE, ACTOR);
  });

  it('★ keeps retiring evidence the SuperAdmin’s — accounting may not', async () => {
    expect((await authed('post', `/fuel-evidence/${IMAGE}/retire`).send({ reason: 'ảnh nhầm' })).status).toBe(403);
    context = asContext({ global: true, memberOf: [], functions: [] });
    await authed('post', `/fuel-evidence/${IMAGE}/retire`).send({ reason: 'ảnh nhầm' }).expect(200);
    expect(evidence.retire).toHaveBeenCalledWith(IMAGE, 'ảnh nhầm', ACTOR);
    expect((await authed('post', `/fuel-evidence/${IMAGE}/retire`).send({ reason: '  ' })).status).toBe(422);
  });

  it('refuses a malformed id as the repo does (422) before anything is asked', async () => {
    expect((await authed('get', '/fuel-evidence/not-a-uuid/content')).status).toBe(422);
    expect(evidence.content).not.toHaveBeenCalled();
  });
});
