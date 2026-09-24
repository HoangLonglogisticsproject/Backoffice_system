import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { AlertModule } from './core/alert/alert.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { HealthModule } from './infrastructure/health/health.module';
import { SchedulerModule } from './infrastructure/scheduler/scheduler.module';
import { ServiceAuthModule } from './infrastructure/service-auth/service-auth.module';

/**
 * THE COMPOSITION ROOT of the AI Platform — the only file that knows the
 * whole service. Same shape as the backend's: configuration and technology
 * adapters first, then the bounded contexts that consume the ports they
 * register.
 *
 * `SchedulerModule` (Phase 1b) carries the detectors, the backend client and
 * the scan engine. It decides at boot whether to arm, so this list does not
 * change with configuration.
 *
 * What is NOT here, on purpose: no knowledge, retrieval or model module.
 * Each arrives with the phase that implements it.
 */
@Module({
  imports: [ConfigModule, DatabaseModule, ServiceAuthModule, HealthModule, AlertModule, SchedulerModule],
})
export class AppModule {}
