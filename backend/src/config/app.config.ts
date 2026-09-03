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

  /**
   * Defaults to the company domain, so the policy holds even when nothing sets
   * the variable — see the schema. Setting it explicitly empty is the documented
   * escape hatch and means any domain may be provisioned.
   */
  get allowedEmailDomains(): readonly string[] {
    return this.config.get('ALLOWED_EMAIL_DOMAINS', { infer: true });
  }

  /**
   * Peers whose `X-Forwarded-For` may be believed. Empty means none, so the
   * header is ignored and `req.ip` is always the socket address.
   */
  get trustedProxies(): readonly string[] {
    return this.config.get('TRUSTED_PROXIES', { infer: true });
  }

  /** Live notification streams one account may hold. */
  get sseMaxConnectionsPerUser(): number {
    return this.config.get('SSE_MAX_CONNECTIONS_PER_USER', { infer: true });
  }

  /** Live notification streams the whole process may hold. */
  get sseMaxConnections(): number {
    return this.config.get('SSE_MAX_CONNECTIONS', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
