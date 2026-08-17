import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

/**
 * Typed access to the validated environment.
 *
 * Callers write `config.databaseUrl`, not `configService.get('DATABASE_URL')` —
 * the second form loses the type and scatters string keys through the codebase.
 *
 * This is the only place that reads configuration. Nothing else touches
 * `process.env`: one door in, one place to audit.
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

  get logLevel(): Env['LOG_LEVEL'] {
    return this.config.get('LOG_LEVEL', { infer: true });
  }

  /** Empty means CORS stays off — same-origin only. */
  get corsOrigins(): readonly string[] {
    return this.config.get('CORS_ORIGINS', { infer: true });
  }

  /** 0 means no proxy is trusted, so X-Forwarded-For is ignored. */
  get trustProxyHops(): number {
    return this.config.get('TRUST_PROXY_HOPS', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
