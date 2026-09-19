import { z } from 'zod';
import { SCHEMA_NAME_PATTERN } from '../common/database/schema-name';

/**
 * The deployment's environment, validated once at boot.
 *
 * Fail-closed, like the backend's: a missing or malformed variable stops the
 * process instead of letting it start with a guessed value. Every secret below
 * is validated for SHAPE only — its value is never logged, echoed or compared
 * anywhere except inside a constant-time check.
 */

/**
 * A shared secret that is genuinely a secret. 32 characters is the floor at
 * which `openssl rand -hex 32` output (64 chars) and a base64 32-byte value
 * both pass, and a value somebody typed by hand does not.
 */
const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters — generate it, never type it`);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** 3100 by default so a developer can run the backend on :3000 beside it. */
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),

  /**
   * The SAME database as the backend, a DIFFERENT role. Validated by parsing,
   * not by prefix — a `startsWith` check accepts a URL with no host.
   */
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .superRefine((value, ctx) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATABASE_URL must be a valid URL' });
        return;
      }

      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `DATABASE_URL must be a PostgreSQL URL (postgres:// or postgresql://), got "${url.protocol}//"`,
        });
      }

      if (url.hostname.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATABASE_URL must include a host' });
      }

      if (url.pathname.replace(/^\//, '').length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATABASE_URL must name a database' });
      }
    }),

  /**
   * The schema every AI-owned table lives in. `ai` in every real deployment;
   * only integration tests point it elsewhere, at a schema they create and
   * drop themselves.
   *
   * ★ AN IDENTIFIER, NEVER A SQL FRAGMENT. This value ends up in `search_path`
   * and in `CREATE SCHEMA`, both of which take an identifier that cannot be a
   * bound parameter. The only defence is to refuse anything that is not a
   * plain lowercase identifier BEFORE it is ever spliced into a statement —
   * see `schema-name.ts`, which is the single definition of that shape.
   */
  DB_SCHEMA: z
    .string()
    .default('ai')
    .refine((value) => SCHEMA_NAME_PATTERN.test(value), {
      message: 'DB_SCHEMA must be a plain lowercase identifier: ^[a-z_][a-z0-9_]*$ (max 63)',
    }),

  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  /**
   * What the BACKEND presents as `Authorization: Bearer …` when it calls
   * `/internal/v1/*`. One direction only — the credential the AI will present
   * to the backend is a different secret, held by the backend's env schema as
   * `SERVICE_TOKEN_AI_TO_BACKEND`. Two secrets, so that leaking one side's
   * caller credential does not hand out the other side's.
   *
   * REQUIRED, not defaulted: an AI service without it would either accept
   * nobody (useless) or everybody (worse). Refusing to boot is the honest
   * third option.
   */
  SERVICE_TOKEN_BACKEND_TO_AI: secret('SERVICE_TOKEN_BACKEND_TO_AI'),

  /**
   * The HMAC-SHA256 key the backend signs a user's trusted context with, and
   * the AI verifies it with. Separate from BOTH bearer secrets: a bearer token
   * says "this is the backend"; this key says "and the backend vouches for
   * this person, with these permissions, for the next minute".
   */
  TRUSTED_CONTEXT_SECRET: secret('TRUSTED_CONTEXT_SECRET'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Used by ConfigModule. Throws with every problem listed at once rather than
 * one per restart.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}\n\nSee .env.example.`);
  }

  return result.data;
}
