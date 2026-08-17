import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { DomainErrorFilter } from './common/http/domain-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const config = app.get(AppConfig);
  app.useLogger([config.logLevel]);

  // Lets OnApplicationShutdown run, so the pool closes instead of leaving
  // connections for PostgreSQL to time out.
  app.enableShutdownHooks();

  // The session cookie is the only credential transport, so parsing cookies is
  // not optional plumbing here.
  app.use(cookieParser());

  // Stops advertising the framework and version — free reconnaissance otherwise.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  /**
   * Headers the APPLICATION owns, because they are true of this API wherever
   * it is deployed. HSTS and CSP are deliberately NOT here — see below.
   */
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // Never let a browser guess a response is HTML and execute it.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A JSON API has no reason to be framed.
    res.setHeader('X-Frame-Options', 'DENY');
    // Do not leak the path (which can contain ids) to third parties.
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  /**
   * HSTS and CSP belong to the DEPLOYMENT, not here.
   *
   * HSTS is a property of the TLS terminator: setting it from an app that may
   * be reached over plain HTTP in development either does nothing or locks a
   * developer out of localhost for months.
   *
   * CSP describes where the *frontend's* scripts, styles and fonts come from.
   * This API serves none of them and cannot know. The reverse proxy that serves
   * the client owns that header.
   */

  /**
   * CORS is OFF unless a deployment names origins.
   *
   * Off is the production shape: client and API behind one origin. Development
   * allowlists http://localhost:4200 in its own .env.
   *
   * When it IS on, the CSRF layering still holds: an attacker's origin is not
   * in the allowlist, so its preflight fails and it cannot set the header the
   * CsrfGuard requires. And SameSite=strict is unaffected by port, so a cookie
   * still travels between :4200 and :3000 — both are the same *site*.
   */
  const origins = config.corsOrigins;
  if (origins.length > 0) {
    app.enableCors({
      origin: [...origins],
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }

  /**
   * Whether to believe X-Forwarded-For, and for how many hops. DEFAULT 0.
   *
   * The login throttle keys on `req.ip`, so this decides whether that value is
   * a fact or a request header the caller chose. Hardcoding a hop count assumes
   * a proxy is always in front; when one is not — a container reached directly,
   * a port exposed for debugging — the caller supplies their own address and
   * gets a fresh throttle budget per request.
   *
   * A deployment that terminates behind nginx sets TRUST_PROXY_HOPS=1.
   */
  app.set('trust proxy', config.trustProxyHops);

  app.useGlobalFilters(new DomainErrorFilter());

  // No request-validation pipe yet, on purpose: Phase 0 has no endpoint that
  // accepts a body, so a global ValidationPipe would validate nothing while
  // pulling in class-validator and class-transformer. The first endpoint that
  // takes input decides — and `zod` is already here for the environment, so
  // one validation library is the likely answer rather than a second.

  await app.listen(config.port);

  new Logger('Bootstrap').log(
    `Backoffice Foundation listening on :${config.port} (${config.nodeEnv})`,
  );
}

void bootstrap();
