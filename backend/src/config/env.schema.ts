import { z } from 'zod';

/**
 * The deployment's environment, validated once at boot.
 *
 * Fail-closed on purpose: a missing or malformed variable stops the process
 * instead of letting it start with a guessed default. A backoffice that boots
 * pointing at the wrong database is worse than one that refuses to boot.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

  /**
   * One deployment, one database. That is the isolation boundary — there is no
   * tenant column and no tenant resolver anywhere in this codebase.
   */
  /**
   * Validated by parsing, not by prefix.
   *
   * A `startsWith` check passes `postgres://` with no host at all, and the
   * failure then arrives later as a connection error that reads like the
   * database is down rather than like the URL is wrong.
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
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL must include a host',
        });
      }

      if (url.pathname.replace(/^\//, '').length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL must name a database',
        });
      }
    }),

  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  /**
   * Comma-separated origins allowed to call this API from a browser.
   *
   * EMPTY BY DEFAULT, which disables CORS entirely — the secure default, and
   * the right one for the production model this foundation targets: the client
   * is served from the same origin as the API, behind one reverse proxy.
   *
   * Development is the exception: the Angular dev server runs on :4200 while
   * the API runs on :3000, so a local `.env` allowlists it explicitly.
   *
   * Never `*`. A wildcard cannot be combined with credentials, and this API
   * authenticates with a cookie — a browser would refuse the response, and if
   * it did not, any site could read authenticated data.
   *
   * A customer's production domain belongs in that deployment's environment,
   * never in this file.
   */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .refine((origins) => !origins.includes('*'), {
      message: 'CORS_ORIGINS must list explicit origins; "*" is refused with credentials.',
    }),

  /**
   * How many reverse proxies sit in front of this app. DEFAULT 0 — trust none.
   *
   * `X-Forwarded-For` is a request header, so a client that reaches the app
   * directly can write whatever it likes in it. With a hop count configured,
   * Express takes the client address from that header — which means trusting it
   * when nothing is actually in front turns the login throttle's per-IP budget
   * into a formality: an attacker mints a new "address" per request.
   *
   * So this must be a deployment fact, not a default. Behind one nginx or one
   * load balancer, set 1.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  /**
   * Email domains an account may be provisioned under, comma-separated.
   *
   * EMPTY MEANS NO RESTRICTION, and that is a deliberate choice rather than an
   * oversight. This foundation has to be clonable: a different deployment must
   * boot and create its first account without first learning about a variable
   * that only one customer needed. The opposite default — empty refuses
   * everything — turns a forgotten variable into "no account can be created",
   * and that symptom points nowhere near its cause.
   *
   * The accepted cost: a deployment that MEANT to restrict and forgot will
   * accept outside addresses. Which is why the value belongs in `.env.example`
   * and in the deployment checklist, not in a default here.
   *
   * Applied ONLY when provisioning an account. Never at login — see
   * `authentication.service`: refusing a login for a domain reason would tell
   * an attacker which domains exist.
   */
  ALLOWED_EMAIL_DOMAINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0),
    ),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Used by ConfigModule. Throws with every problem listed at once rather than
 * one per restart — a developer setting this up for the first time should see
 * the whole list.
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
