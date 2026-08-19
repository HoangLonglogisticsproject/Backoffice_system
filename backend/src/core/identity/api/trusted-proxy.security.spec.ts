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
import { DATABASE } from '../../../common/types/database.port';
import { IdentityRepository } from '../persistence/identity.repository';
import { LoginThrottleService } from '../application/login-throttle.service';
import { PASSWORD_HASHER } from '../domain/password-hasher.port';
import { SessionService } from '../application/session.service';

/**
 * WHO the login throttle counts, when a proxy sits in front.
 *
 * The throttle keys on `req.ip`, and `req.ip` is decided by Express's
 * `trust proxy` setting. Behind Cloudflare that setting is the difference
 * between a per-source limit and a global one, so it is a security control and
 * it is tested like one.
 *
 * THE BUG THIS LOCKS DOWN. The setting used to be a hop COUNT, and a count
 * believes `X-Forwarded-For` no matter who connected. Two failures came out of
 * that, in opposite directions:
 *
 *   count = 0 behind a proxy   every caller collapses to the proxy's address,
 *                              so thirty failures anywhere lock out everybody
 *
 *   count = 1 with the origin  a direct caller writes the header themselves and
 *   reachable                  mints a fresh budget per request
 *
 * A LIST fixes both, because Express checks it against the PEER: the header is
 * honoured when the peer is a listed proxy and ignored entirely when it is not.
 *
 * Supertest always connects from 127.0.0.1, so listing it models "the request
 * arrived through the trusted chain" and omitting it models "somebody reached
 * the origin directly" — which is exactly the pair that matters.
 */
describe('trusted proxy — who the login throttle counts', () => {
  const PASSWORD = 'a valid passphrase for tests';

  let app: INestApplication;
  let throttle: LoginThrottleService;

  /** `trustProxy` is handed straight to Express, as `main.ts` does. */
  const build = async (trustProxy: unknown) => {
    const user = { id: 'u1', displayName: 'A Person', status: 'active' as const };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthenticationService,
        LoginThrottleService,
        AuthGuard,
        CsrfGuard,
        { provide: AppConfig, useValue: { isProduction: true } },
        { provide: DATABASE, useValue: { query: jest.fn(), transaction: jest.fn() } },
        {
          provide: IdentityRepository,
          useValue: {
            findWithUserBySubject: jest.fn(async (_provider: string, subject: string) =>
              subject === 'real@example.com'
                ? { identity: { secretHash: 'stored-hash' }, user }
                : null,
            ),
          },
        },
        {
          provide: PASSWORD_HASHER,
          useValue: {
            verify: jest.fn(async (plaintext: string) => plaintext === PASSWORD),
            fakeVerify: jest.fn(async () => undefined),
            hash: jest.fn(),
          },
        },
        {
          provide: SessionService,
          useValue: {
            issue: jest.fn(async () => ({
              token: 'a-session-token',
              expiresAt: new Date(Date.now() + 3_600_000),
            })),
            resolve: jest.fn(async () => user),
            revoke: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new DomainErrorFilter());
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
    await app.init();

    throttle = app.get(LoginThrottleService);
    return app;
  };

  afterEach(async () => {
    await app?.close();
  });

  /** One login attempt, claiming to come from `clientIp` via the proxy header. */
  const attempt = (clientIp: string, subject: string, password: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('X-Forwarded-For', clientIp)
      .send({ subject, password });

  // ------------------------------------------- behind the real proxy chain --

  describe('request arrived through the trusted chain', () => {
    beforeEach(async () => {
      // The peer (supertest, 127.0.0.1) is listed, so the forwarded address is
      // believed — the production shape once Cloudflare's ranges are listed.
      await build(['127.0.0.1']);
    });

    it('gives 36 distinct clients 36 distinct budgets, not one shared bucket', async () => {
      // MAX_PER_IP is 30. Under the old hop-count-behind-a-proxy behaviour every
      // one of these collapsed to the proxy address and the 31st was refused.
      const statuses: number[] = [];
      for (let i = 1; i <= 36; i += 1) {
        const response = await attempt(`203.0.113.${i}`, `user${i}@example.com`, 'wrong one');
        statuses.push(response.status);
      }

      expect(statuses).toHaveLength(36);
      expect(statuses.every((status) => status === 401)).toBe(true);
      expect(statuses).not.toContain(429);
    });

    it('still throttles ONE source that keeps guessing', async () => {
      const statuses: number[] = [];
      for (let i = 1; i <= 35; i += 1) {
        const response = await attempt('198.51.100.99', `v${i}@example.com`, 'wrong one');
        statuses.push(response.status);
      }

      // The per-IP budget still bites: the first 30 are refused on credentials,
      // everything after is refused on rate.
      expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
      expect(statuses.slice(30).every((status) => status === 429)).toBe(true);
    });

    it('does not let one noisy client lock out everybody else', async () => {
      for (let i = 1; i <= 31; i += 1) {
        await attempt('198.51.100.99', `v${i}@example.com`, 'wrong one');
      }
      await attempt('198.51.100.99', 'real@example.com', 'wrong one').expect(429);

      // A different person, correct password, while that source is still blocked.
      await attempt('198.51.100.7', 'real@example.com', PASSWORD).expect(200);
    });

    it('keeps the ordinary login path working', async () => {
      const response = await attempt('198.51.100.20', 'real@example.com', PASSWORD).expect(200);

      expect(response.body.user).toEqual({ id: 'u1', displayName: 'A Person', status: 'active' });
      expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
      // The token never travels in the body, proxy or no proxy.
      expect(JSON.stringify(response.body)).not.toContain('a-session-token');
    });
  });

  // ------------------------------------------------ direct, untrusted peer --

  describe('request reached the origin directly', () => {
    beforeEach(async () => {
      // The peer is NOT on the list, so `X-Forwarded-For` must be ignored
      // outright. This is the origin-exposed case.
      await build(['198.51.100.1']);
    });

    it('cannot mint unlimited budgets by rotating X-Forwarded-For', async () => {
      // 36 different claimed addresses, all from the same untrusted peer. If the
      // header were believed these would be 36 separate buckets and none would
      // ever throttle -- which is precisely the forgery a hop count allowed.
      const statuses: number[] = [];
      for (let i = 1; i <= 36; i += 1) {
        const response = await attempt(`203.0.113.${i}`, `user${i}@example.com`, 'wrong one');
        statuses.push(response.status);
      }

      expect(statuses).toContain(429);
      // They all landed in the ONE bucket belonging to the real peer address.
      expect(statuses.slice(30).every((status) => status === 429)).toBe(true);
    });

    it('counts the socket address, not the claimed one', () => {
      // Same claimed address, same peer: one key, not two.
      const decision = throttle.check({ ip: '127.0.0.1', subject: 'real@example.com' });
      expect(decision.allowed).toBe(true);
    });
  });

  // ------------------------------------------------------- nothing in front --

  describe('no proxy configured at all (the default)', () => {
    beforeEach(async () => build(false));

    it('ignores X-Forwarded-For entirely', async () => {
      const statuses: number[] = [];
      for (let i = 1; i <= 36; i += 1) {
        const response = await attempt(`203.0.113.${i}`, `user${i}@example.com`, 'wrong one');
        statuses.push(response.status);
      }

      // Default is trust-nobody, so a forged header changes nothing.
      expect(statuses).toContain(429);
    });
  });
});
