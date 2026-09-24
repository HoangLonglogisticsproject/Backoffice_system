import { z } from 'zod';
import { SCHEMA_NAME_PATTERN } from '../common/database/schema-name';
import { duration } from './duration';

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

  // ------------------------------------------------------------ Phase 1b --
  //
  // The scan engine. Everything below is OPTIONAL and closed when absent:
  // this service must still boot to serve the Alert API when no scanning is
  // configured, and a half-configured engine must not run rather than run on
  // invented values.

  /**
   * Where the backend's internal read models live, reached over the compose
   * network (`http://backend:3000`). Empty = the engine has nowhere to read
   * from, so the scheduler does not arm.
   */
  BACKEND_INTERNAL_URL: z
    .string()
    .default('')
    .superRefine((value, ctx) => {
      if (value.length === 0) return;
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BACKEND_INTERNAL_URL must be a valid URL' });
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BACKEND_INTERNAL_URL must be http or https' });
      }
    }),

  /**
   * The bearer secret THIS service presents to the backend. The other
   * direction's secret is `SERVICE_TOKEN_BACKEND_TO_AI` above; they are never
   * the same value. Empty = the engine cannot authenticate, so it does not run.
   */
  SERVICE_TOKEN_AI_TO_BACKEND: z
    .string()
    .default('')
    .refine((value) => value.length === 0 || value.length >= 32, {
      message: 'SERVICE_TOKEN_AI_TO_BACKEND must be at least 32 characters when set — generate it, never type it',
    }),

  /** How long one read-model request may take before it is a failed scan. */
  BACKEND_TIMEOUT: duration('BACKEND_TIMEOUT').default('10s'),

  /**
   * ★ NOT APPROVED, SO NOT DEFAULTED. How often the engine scans is a
   * business decision nobody has taken. Unset = the scheduler does not arm
   * and says so at boot; the Alert API still serves.
   */
  SCAN_INTERVAL: duration('SCAN_INTERVAL').optional(),

  /**
   * How long after boot the first tick fires. Defaulted to `0s` because that
   * is the ABSENCE of a delay rather than a chosen one — the lock makes an
   * immediate tick safe even while another replica is mid-deploy.
   */
  SCAN_INITIAL_DELAY: duration('SCAN_INITIAL_DELAY').default('0s'),

  /** D1 — CEO-approved (2026-09-19): two hours before pickup. */
  DETECTOR_UNASSIGNED_TRIP_WARNING_LEAD: duration('DETECTOR_UNASSIGNED_TRIP_WARNING_LEAD').default('2h'),
  /** D1 HIGH band — TBD. Unset = this detector never raises `high`. */
  DETECTOR_UNASSIGNED_TRIP_HIGH_LEAD: duration('DETECTOR_UNASSIGNED_TRIP_HIGH_LEAD').optional(),

  /**
   * D2 — NOT APPROVED. How long after pickup an unstarted assignment is a
   * problem. Unset = D2 is DISABLED, which is not the same as a zero grace.
   */
  DETECTOR_STALE_START_GRACE: duration('DETECTOR_STALE_START_GRACE').optional(),
  /** D2 HIGH band — TBD. */
  DETECTOR_STALE_START_HIGH_AFTER: duration('DETECTOR_STALE_START_HIGH_AFTER').optional(),

  /** D3 — CEO-approved (2026-09-19): twelve hours pending. */
  DETECTOR_COMPLETION_REVIEW_WARNING_AFTER: duration('DETECTOR_COMPLETION_REVIEW_WARNING_AFTER').default('12h'),
  /** D3 HIGH band — TBD. */
  DETECTOR_COMPLETION_REVIEW_HIGH_AFTER: duration('DETECTOR_COMPLETION_REVIEW_HIGH_AFTER').optional(),

  /**
   * Technical sizes, not policy: how big a read-model page is and how many
   * ids one resolution lookup carries. The backend refuses a lookup above
   * 200, so this stays at or under that.
   */
  READ_MODEL_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(100),
  RESOLUTION_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(100),
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
