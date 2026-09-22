import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { DomainErrorFilter } from './common/http/domain-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const config = app.get(AppConfig);
  app.useLogger([config.logLevel]);

  // Lets OnApplicationShutdown run, so the pool closes cleanly.
  app.enableShutdownHooks();

  app.getHttpAdapter().getInstance().disable('x-powered-by');

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // No CORS, no cookies, no trust-proxy: this service has no browser callers
  // and no public listener. The backend reaches it over the compose network.

  app.useGlobalFilters(new DomainErrorFilter());

  await app.listen(config.port);

  new Logger('Bootstrap').log(`AI Platform listening on :${config.port} (${config.nodeEnv})`);
}

void bootstrap();
