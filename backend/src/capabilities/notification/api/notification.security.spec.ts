import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import { NotificationStream } from '../application/notification-stream';
import { NotificationService } from '../application/notification.service';
import { NotificationRepository } from '../persistence/notification.repository';
import { NotificationController } from './notification.controller';

/**
 * Notifications over HTTP: only ever your own.
 *
 * ★ THE PROPERTY: no route takes a user, so the only person whose rows can be
 * reached is the one the cookie resolved to. These cases pin that the id the
 * repository is asked about is the SESSION's, whatever a caller writes.
 */
describe('notification HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const ME = '33333333-3333-3333-3333-333333333333';
  const NOTE = '88888888-8888-4888-8888-888888888888';

  let app: INestApplication;
  let rows: { listForUser: jest.Mock; countUnread: jest.Mock; markRead: jest.Mock; record: jest.Mock };
  let stream: NotificationStream;

  beforeEach(async () => {
    rows = {
      listForUser: jest.fn().mockResolvedValue([{ id: NOTE, recipientUserId: ME }]),
      countUnread: jest.fn().mockResolvedValue(1),
      markRead: jest.fn().mockImplementation(async (id: string, userId: string) =>
        userId === ME && id === NOTE ? { id, recipientUserId: ME, readAt: new Date() } : null,
      ),
      record: jest.fn(),
    };
    // One stream per account, so the HTTP refusal can be exercised below.
    stream = new NotificationStream({ perUser: 1, total: 10 });

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        AuthGuard,
        CsrfGuard,
        NotificationService,
        { provide: NotificationStream, useValue: stream },
        { provide: NotificationRepository, useValue: rows },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ id: ME, displayName: 'Tài Xế', status: 'active', accountType: 'driver' }),
          },
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

  const authed = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  describe('without authentication', () => {
    it.each([
      ['get', '/notifications'],
      ['get', '/notifications/stream'],
      ['post', `/notifications/${NOTE}/read`],
    ] as const)('refuses %s %s with 401', async (method, path) => {
      const response = await request(app.getHttpServer())[method](path).set('X-Requested-With', 'XMLHttpRequest');
      expect(response.status).toBe(401);
      expect(rows.listForUser).not.toHaveBeenCalled();
      expect(rows.markRead).not.toHaveBeenCalled();
    });
  });

  describe('the list', () => {
    it('★ is the session user’s, and there is no parameter to widen it', async () => {
      const response = await authed('get', '/notifications?userId=somebody-else').expect(200);

      expect(rows.listForUser).toHaveBeenCalledWith(ME);
      expect(rows.countUnread).toHaveBeenCalledWith(ME);
      expect(response.body).toEqual({ items: [{ id: NOTE, recipientUserId: ME }], unreadCount: 1 });
    });
  });

  describe('marking read', () => {
    it('marks the caller’s own', async () => {
      await authed('post', `/notifications/${NOTE}/read`).expect(200);
      expect(rows.markRead).toHaveBeenCalledWith(NOTE, ME, expect.any(Date));
    });

    it('★ answers somebody else’s id as not found — never as forbidden, never as read', async () => {
      const OTHERS = '99999999-9999-4999-8999-999999999999';
      const response = await authed('post', `/notifications/${OTHERS}/read`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('★ ignores a recipient named in the body', async () => {
      await authed('post', `/notifications/${NOTE}/read`)
        .send({ recipientUserId: 'somebody-else', userId: 'somebody-else' })
        .expect(200);
      expect(rows.markRead).toHaveBeenCalledWith(NOTE, ME, expect.any(Date));
    });

    it('refuses without the CSRF header', async () => {
      const response = await request(app.getHttpServer())
        .post(`/notifications/${NOTE}/read`)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
      expect(response.status).toBe(403);
      expect(rows.markRead).not.toHaveBeenCalled();
    });

    it('refuses an id that is not a UUID', async () => {
      const response = await authed('post', '/notifications/stream/read');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      // Refused by the pipe: nothing reaches the repository, so nothing is stamped.
      expect(rows.markRead).not.toHaveBeenCalled();
    });
  });

  describe('the stream', () => {
    /**
     * Called as the router would after `AuthGuard`, rather than over a
     * socket that never ends: the handler takes the SESSION user and a
     * response, and nothing else — there is no parameter through which a
     * caller could name another channel, which is the property.
     */
    it('★ subscribes the SESSION user, so a caller cannot name another channel', () => {
      const controller = app.get(NotificationController);
      const setHeader = jest.fn();

      const events = controller.stream(
        { id: ME, displayName: 'Tài Xế', status: 'active', accountType: 'driver' },
        { setHeader } as never,
      );
      const subscription = events.subscribe();

      expect(stream.connections(ME)).toBe(1);
      expect(stream.connections('somebody-else')).toBe(0);
      // nginx must pass each event through rather than buffer the response.
      expect(setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');

      subscription.unsubscribe();
      expect(stream.connections(ME)).toBe(0);
    });

    it('★ answers 429 with a Retry-After once the account holds its ceiling, registering nothing', async () => {
      const held = stream.subscribe(ME).subscribe();

      const response = await authed('get', '/notifications/stream');

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('TOO_MANY_CONNECTIONS');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(stream.connections(ME)).toBe(1);
      held.unsubscribe();
    });

    it('is refused without a session, like every other route', async () => {
      await request(app.getHttpServer()).get('/notifications/stream').expect(401);
      expect(stream.connections(ME)).toBe(0);
    });
  });
});
