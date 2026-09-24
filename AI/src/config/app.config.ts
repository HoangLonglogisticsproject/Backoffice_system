import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

/**
 * Typed access to the validated environment — the only place that reads
 * configuration. Nothing else touches `process.env` (boundary rule A6).
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  /** Already validated as a plain identifier by the schema. */
  get dbSchema(): string {
    return this.config.get('DB_SCHEMA', { infer: true });
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.config.get('LOG_LEVEL', { infer: true });
  }

  /** The bearer secret the backend must present. Never log it. */
  get serviceTokenBackendToAi(): string {
    return this.config.get('SERVICE_TOKEN_BACKEND_TO_AI', { infer: true });
  }

  /** The HMAC key trusted user contexts are verified with. Never log it. */
  get trustedContextSecret(): string {
    return this.config.get('TRUSTED_CONTEXT_SECRET', { infer: true });
  }

  // ------------------------------------------------------------ Phase 1b --

  /** Empty when no backend is configured — the engine then does not run. */
  get backendInternalUrl(): string {
    return this.config.get('BACKEND_INTERNAL_URL', { infer: true });
  }

  /** The bearer secret this service presents to the backend. Never log it. */
  get serviceTokenAiToBackend(): string {
    return this.config.get('SERVICE_TOKEN_AI_TO_BACKEND', { infer: true });
  }

  get backendTimeoutMs(): number {
    return this.config.get('BACKEND_TIMEOUT', { infer: true });
  }

  /** `undefined` when nobody has chosen an interval — the scheduler stays disarmed. */
  get scanIntervalMs(): number | undefined {
    return this.config.get('SCAN_INTERVAL', { infer: true });
  }

  get scanInitialDelayMs(): number {
    return this.config.get('SCAN_INITIAL_DELAY', { infer: true });
  }

  get unassignedTripWarningLeadMs(): number {
    return this.config.get('DETECTOR_UNASSIGNED_TRIP_WARNING_LEAD', { infer: true });
  }

  get unassignedTripHighLeadMs(): number | null {
    return this.config.get('DETECTOR_UNASSIGNED_TRIP_HIGH_LEAD', { infer: true }) ?? null;
  }

  /** `null` disables D2. It does NOT mean a zero grace. */
  get staleStartGraceMs(): number | null {
    return this.config.get('DETECTOR_STALE_START_GRACE', { infer: true }) ?? null;
  }

  get staleStartHighMs(): number | null {
    return this.config.get('DETECTOR_STALE_START_HIGH_AFTER', { infer: true }) ?? null;
  }

  get completionReviewWarningAfterMs(): number {
    return this.config.get('DETECTOR_COMPLETION_REVIEW_WARNING_AFTER', { infer: true });
  }

  get completionReviewHighAfterMs(): number | null {
    return this.config.get('DETECTOR_COMPLETION_REVIEW_HIGH_AFTER', { infer: true }) ?? null;
  }

  get readModelPageSize(): number {
    return this.config.get('READ_MODEL_PAGE_SIZE', { infer: true });
  }

  get resolutionBatchSize(): number {
    return this.config.get('RESOLUTION_BATCH_SIZE', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
