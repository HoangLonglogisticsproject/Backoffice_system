import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfig } from '../../config/app.config';
import { DatabaseService } from '../database/database.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  environment: string;
  checks: { database: 'up' | 'down' };
}

/**
 * Liveness and readiness in one endpoint: 503 when the database is down, so
 * a compose healthcheck or a release gate reads the status code. Unguarded,
 * because a probe that needs a token cannot run before the service is ready.
 *
 * Detector freshness is NOT reported here yet — there are no detectors in
 * Phase 1a, and a health line that describes something that does not exist
 * would be a fabrication. Phase 1b extends `checks`.
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
