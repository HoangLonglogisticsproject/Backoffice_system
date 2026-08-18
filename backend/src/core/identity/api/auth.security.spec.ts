import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthenticationService } from '../application/authentication.service';
import { CsrfGuard } from './csrf.guard';
import { SESSION_COOKIE } from './session.cookie';
import { SessionService } from '../application/session.service';

/**
 * The observable security contract of the HTTP surface.
 *
 * These assert what an attacker or a browser can SEE — cookie attributes, what
 * is and is not in a response body, which requests are refused — rather than
 * how any of it is implemented.
 */
describe('auth HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const user = { id: 'u1', displayName: 'A Person', status: 'active' as const };

  let app: INestApplication;
  let auth: { login: jest.Mock; logout: jest.Mock };
  let sessions: { resolve: jest.Mock };
  let isProduction: boolean;

  const build = async () => {
    auth = {
      login: jest.fn().mockResolvedValue({
        session: { token: TOKEN, expiresAt: new Date(Date.now() + 3_600_000) },
        user,
      }),
      logout: jest.fn(),
    };
    sessions = { resolve: jest.fn().mockResolvedValue(user) };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthenticationService, useValue: auth },
        { provide: SessionService, useValue: sessions },
        { provide: AppConfig, useValue: { isProduction } },
        AuthGuard,
        CsrfGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  };

  beforeEach(async () => {
    isProduction = true;
    await build();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = () =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ subject: 'a@example.com', password: 'a valid passphrase' });

  describe('session transport', () => {
    it('never puts the token in the response body', async () => {
      const response = await login().expect(200);

      // The whole point of the cookie: no client can store this, because no
      // client is ever given it.
      expect(JSON.stringify(response.body)).not.toContain(TOKEN);
      expect(response.body.token).toBeUndefined();
      expect(response.body.user).toEqual(user);
    });

    it('sets the session cookie HttpOnly, Secure and SameSite=Strict', async () => {
      const response = await login().expect(200);
      const cookie = (response.headers['set-cookie'] as unknown as string[])[0];

      expect(cookie).toContain(`${SESSION_COOKIE}=`);
      expect(cookie).toMatch(/HttpOnly/i); // unreadable by script → XSS cannot steal it
      expect(cookie).toMatch(/Secure/i); // HTTPS only
      expect(cookie).toMatch(/SameSite=Strict/i); // not sent cross-site at all
      expect(cookie).toMatch(/Path=\//i);
    });

    it('omits Secure outside production, or the cookie never arrives on localhost', async () => {
      await app.close();
      isProduction = false;
      await build();

      const cookie = (
        (await login().expect(200)).headers['set-cookie'] as unknown as string[]
      )[0];

      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).not.toMatch(/Secure/i);
    });
  });

  describe('CSRF', () => {
    it('refuses a state-changing request without the custom header', async () => {
      // A cross-origin form or <img> can aim at this endpoint, but neither can
      // set a custom header without a preflight this API does not answer.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ subject: 'a@example.com', password: 'a valid passphrase' })
        .expect(403);

      expect(auth.login).not.toHaveBeenCalled();
    });

    it('allows a read-only request without it', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`${SESSION_COOKIE}=${TOKEN}`])
        .expect(200);

      // The status alone would also be produced by a guard that let the request
      // through and a handler that never ran. The body proves it reached the
      // handler, which is the actual claim.
      expect(response.body).toEqual(user);
    });
  });

  describe('authentication', () => {
    it('answers 401 — not 403 — with no cookie', async () => {
      // 401 tells the client to log in again; 403 would send an expired
      // session to a dead end.
      const response = await request(app.getHttpServer()).get('/auth/me').expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
      // No cookie means no lookup: an unauthenticated caller must not be able
      // to make this endpoint touch the session store at all.
      expect(sessions.resolve).not.toHaveBeenCalled();
    });

    it('answers 401 when the session no longer resolves', async () => {
      sessions.resolve.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`${SESSION_COOKIE}=stale`])
        .expect(401);

      // Same code and message as "no cookie": a stale token must not be
      // distinguishable from an absent one.
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(sessions.resolve).toHaveBeenCalledWith('stale');
    });

    it('ignores an Authorization header — the cookie is the only transport', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(401);

      expect(sessions.resolve).not.toHaveBeenCalled();
    });

    it('returns the current user for a valid session', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`${SESSION_COOKIE}=${TOKEN}`])
        .expect(200);

      expect(response.body).toEqual(user);
    });
  });

  describe('logout', () => {
    it('revokes server-side AND clears the cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [`${SESSION_COOKIE}=${TOKEN}`])
        .expect(204);

      // Server side first: clearing only the cookie would leave a token that
      // still works for anyone who captured it.
      expect(auth.logout).toHaveBeenCalledWith(TOKEN);

      const cleared = (response.headers['set-cookie'] as unknown as string[])[0];
      expect(cleared).toContain(`${SESSION_COOKIE}=;`);
    });

    it('requires authentication, so it cannot be used to probe', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
      // The point of the guard: an anonymous caller must not be able to reach
      // the revoke path at all. Otherwise logout becomes an oracle for whether
      // a guessed token is live.
      expect(auth.logout).not.toHaveBeenCalled();
    });
  });

  describe('response hygiene', () => {
    it('reports validation problems without echoing the password', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ subject: '', password: 'secret-value-here' })
        .expect(422);

      expect(JSON.stringify(response.body)).not.toContain('secret-value-here');
    });
  });
});
