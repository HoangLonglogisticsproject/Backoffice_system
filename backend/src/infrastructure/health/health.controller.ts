import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { AppConfig } from '../../config/app.config';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  environment: string;
  checks: { database: 'up' | 'down' };
}

/**
 * Liveness and readiness in one endpoint.
 *
 * It returns **503 when a dependency is down**, not 200 with a sad body — a
 * load balancer reads the status code, not the JSON, and an endpoint that
 * always answers 200 is an endpoint that never removes a broken instance from
 * rotation.
 *
 * This lives in `infrastructure/` because that is precisely what it reports on:
 * the technology this deployment depends on. It knows nothing about users,
 * units or permissions, and it must never require authentication — a health
 * probe that needs a token cannot run before the app is healthy.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const databaseUp = await this.database.isReachable();

    response.status(databaseUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: databaseUp ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      environment: this.config.nodeEnv,
      checks: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
