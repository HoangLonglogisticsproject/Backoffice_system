import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

/** The evidence store, as the environment configured it. Credentials: never log. */
export interface ObjectStorageConfig {
  driver: Env['OBJECT_STORAGE_DRIVER'];
  root: string;
  r2: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };
}

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

  /** Live notification sockets one account may hold. */
  get realtimeMaxConnectionsPerUser(): number {
    return this.config.get('REALTIME_MAX_CONNECTIONS_PER_USER', { infer: true });
  }

  /** Live notification sockets the whole process may hold. */
  get realtimeMaxConnections(): number {
    return this.config.get('REALTIME_MAX_CONNECTIONS', { infer: true });
  }

  /** What the AI Platform must present on internal routes. Empty = closed. Never log it. */
  get serviceTokenAiToBackend(): string {
    return this.config.get('SERVICE_TOKEN_AI_TO_BACKEND', { infer: true });
  }

  /** The key trusted user contexts are signed with. Empty = the signer refuses. Never log it. */
  get trustedContextSecret(): string {
    return this.config.get('TRUSTED_CONTEXT_SECRET', { infer: true });
  }

  /** Which evidence store this deployment has — `none` answers 503 on file routes. */
  get objectStorage(): ObjectStorageConfig {
    return {
      driver: this.config.get('OBJECT_STORAGE_DRIVER', { infer: true }),
      root: this.config.get('OBJECT_STORAGE_ROOT', { infer: true }),
      r2: {
        accountId: this.config.get('R2_ACCOUNT_ID', { infer: true }),
        bucket: this.config.get('R2_BUCKET', { infer: true }),
        accessKeyId: this.config.get('R2_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: this.config.get('R2_SECRET_ACCESS_KEY', { infer: true }),
      },
    };
  }

  /**
   * Credentials gửi Web Push, hoặc `null` khi deployment này chưa có.
   *
   * `null` chứ không phải một object rỗng: nơi gọi phải xử lý trường hợp
   * "không có" một cách rõ ràng, và `if (!credentials)` nói điều đó tốt hơn ba
   * phép so sánh chuỗi rỗng. Schema đã bảo đảm ba biến hoặc cùng có hoặc cùng
   * trống, nên kiểm tra một biến là đủ.
   */
  get firebase(): { projectId: string; clientEmail: string; privateKey: string } | null {
    const projectId = this.config.get('FIREBASE_PROJECT_ID', { infer: true });
    if (projectId.trim() === '') return null;
    return {
      projectId,
      clientEmail: this.config.get('FIREBASE_CLIENT_EMAIL', { infer: true }),
      privateKey: this.config.get('FIREBASE_PRIVATE_KEY', { infer: true }),
    };
  }

  /** Tiến trình này có chạy cron gửi Web Push không. */
  get pushWorkerEnabled(): boolean {
    return this.config.get('PUSH_WORKER_ENABLED', { infer: true });
  }

  /** Origin công khai của frontend, cho link tuyệt đối trong thông báo. Trống = bỏ qua. */
  get pushAppBaseUrl(): string {
    return this.config.get('PUSH_APP_BASE_URL', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
