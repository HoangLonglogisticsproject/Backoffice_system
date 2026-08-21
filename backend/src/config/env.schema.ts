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
   * WHICH peers may be believed when they send `X-Forwarded-For`.
   * Comma-separated IPs, CIDR blocks, or the presets Express understands
   * (`loopback`, `linklocal`, `uniquelocal`). DEFAULT EMPTY — trust nobody.
   *
   * This replaced a hop COUNT, and the difference is the whole point.
   *
   * `X-Forwarded-For` is a request header, so anyone who can reach this app
   * directly can write whatever they like in it. A hop count believes the
   * header no matter WHO connected — so with a count configured and the origin
   * reachable, an attacker rotates the header and mints a fresh throttle budget
   * per request. Measured, not theorised: with `trust proxy = 1`, a request
   * from an untrusted peer carrying `X-Forwarded-For: 203.0.113.9` yields
   * `req.ip = 203.0.113.9`.
   *
   * A LIST is checked against the peer instead. Express walks the forwarded
   * chain from the right, discarding addresses that are on this list, and stops
   * at the first one that is not — the real client. If the immediate peer is
   * not on the list, the header is ignored ENTIRELY and `req.ip` stays the
   * socket address. So a forged header from a direct connection buys nothing.
   *
   * It also removes the question a hop count forces you to answer. Listing the
   * Cloudflare ranges AND the local nginx address is correct whether the chain
   * is `CF → node` or `CF → nginx → node`; nobody has to count, and adding a
   * proxy later does not silently shift the meaning of a number.
   *
   * The login throttle keys on `req.ip`, so this variable decides whether that
   * value is a fact or a caller's suggestion.
   *
   * PRODUCTION behind Cloudflare: list Cloudflare's published ranges from
   * https://www.cloudflare.com/ips/ — and restrict the origin so only
   * Cloudflare can reach it, because this setting alone cannot do that.
   */
  TRUSTED_PROXIES: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .superRefine((entries, ctx) => {
      // Validated at BOOT, because a typo here fails open in the worst way: the
      // entry never matches, the peer is never trusted, every caller collapses
      // to the proxy's address and the per-IP throttle becomes global — which
      // looks like working software right up until it locks everybody out.
      const preset = /^(loopback|linklocal|uniquelocal)$/;
      const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
      const ipv6 = /^[0-9a-fA-F:]+(\/\d{1,3})?$/;

      for (const entry of entries) {
        if (preset.test(entry) || ipv4.test(entry) || ipv6.test(entry)) continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `TRUSTED_PROXIES entry "${entry}" is not an IP, a CIDR block, or one of loopback|linklocal|uniquelocal`,
        });
      }
    }),

  /**
   * Email domains an account may be provisioned under, comma-separated.
   *
   * DEFAULTS TO THE COMPANY DOMAIN, and that default is the enforcement.
   *
   * This used to default to empty, meaning "no restriction", so a clone of this
   * foundation could boot without first learning about a variable only one
   * customer needed. Hoàng Long has since made the domain a product rule: every
   * employee account is `<local-part>@hoanglonglti.com`. A rule that lives only
   * in a `.env` is not a rule — `.env` is gitignored, so a forgotten variable
   * fails OPEN and the deployment silently accepts `someone@gmail.com`.
   *
   * Putting the domain here inverts that: forget the variable and the policy
   * still holds. Another deployment overrides it by setting the variable, which
   * is one line of environment rather than a code change.
   *
   * ⚠ NOT a mailbox check. Nothing here talks to Google Workspace, resolves MX
   * records or proves the address receives mail — see `docs/backend/company-email-policy.md`.
   * This is an application-level rule about which addresses may become accounts.
   *
   * Applied ONLY when provisioning an account. Never at login — see
   * `authentication.service`: refusing a login for a domain reason would tell
   * an attacker which domains exist.
   */
  ALLOWED_EMAIL_DOMAINS: z
    .string()
    .default('hoanglonglti.com')
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
