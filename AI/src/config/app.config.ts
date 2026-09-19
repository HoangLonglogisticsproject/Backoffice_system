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

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
