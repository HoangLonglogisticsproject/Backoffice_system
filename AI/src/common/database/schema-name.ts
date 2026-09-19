/**
 * The one definition of what a schema name may look like.
 *
 * ★ A SCHEMA NAME IS AN IDENTIFIER, AND AN IDENTIFIER CANNOT BE A BOUND
 * PARAMETER. `SET search_path TO $1` and `CREATE SCHEMA $1` are not valid SQL,
 * so wherever this value is used it is spliced into the statement text. That
 * makes it the only string in this service that could carry SQL, and the only
 * defence is to make sure it cannot: a plain lowercase identifier and nothing
 * else — no quotes, no semicolons, no spaces, no commas, no dots.
 *
 * Deliberately narrower than PostgreSQL allows (no uppercase, no unicode): the
 * production value is `ai` and a test value is `ai_itest_<something>`; nothing
 * legitimate needs more, and every character admitted here is a character an
 * attacker can also use.
 */
export const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Throws on anything the pattern refuses; returns the name unchanged otherwise. */
export function assertSchemaName(value: unknown): string {
  if (typeof value !== 'string' || !SCHEMA_NAME_PATTERN.test(value)) {
    throw new Error(
      `Refusing schema name ${JSON.stringify(value)}: must match ^[a-z_][a-z0-9_]*$ (max 63 chars).`,
    );
  }
  return value;
}

/**
 * The validated name as a quoted identifier, for the two statements that need
 * one. Quoting after validation is belt and braces: the pattern already rules
 * out every character that quoting exists to escape.
 */
export function quotedSchema(value: unknown): string {
  return `"${assertSchemaName(value)}"`;
}
