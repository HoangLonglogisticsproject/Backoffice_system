/**
 * Refuses to run the integration suite anywhere but an approved disposable
 * database.
 *
 * ★ THESE SPECS ARE DESTRUCTIVE. They TRUNCATE tables and one of them drops the
 * `public` schema outright. So "is there a database" is the wrong question; the
 * question is "is it THIS database, and did somebody say so on purpose".
 *
 * A substring test is not an answer to that. `/test/i` accepts
 * `production_test`, `customer-testing` and `latest_backup` — three names a
 * tired operator could plausibly have exported five minutes earlier.
 *
 * ★ THREE CONDITIONS, ALL REQUIRED. Each one alone is defeatable:
 *
 *   1. OPT-IN     `ALLOW_DESTRUCTIVE_DB_TESTS=1` — a variable whose only purpose
 *                 is to be typed deliberately. An inherited `DATABASE_URL_TEST`
 *                 from another shell cannot supply it.
 *   2. LOOPBACK   the host must be this machine. A remote database is never a
 *                 legitimate target for a suite that truncates, however it is
 *                 named, so this is what actually rules out staging.
 *   3. IDENTITY   the database name must be one of an EXACT allowlist, not a
 *                 pattern. Adding a name is a visible edit to this file.
 *
 * Runs as `globalSetup`, so it fails before a single spec is collected. Jest
 * puts `globalSetup` through the configured transform, so this is TypeScript
 * like everything else here — verified by running it, not assumed.
 */

/**
 * The disposable databases this repository owns.
 *
 *   backoffice_itest  what CI creates and drops per run (`PGDATABASE_TEST` in
 *                     .github/workflows/ci.yml) and what backend/README.md
 *                     documents for local use.
 *   backoffice_test   a second disposable name, so a developer can keep a local
 *                     backend running on `backoffice_itest` while this suite
 *                     wipes its own database.
 *
 * Anything else — including a name containing "test" — is refused.
 */
const ALLOWED_DATABASES = new Set(['backoffice_itest', 'backoffice_test']);

/** `URL` reports IPv6 hosts bracketed; both spellings are the same machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const OPT_IN = 'ALLOW_DESTRUCTIVE_DB_TESTS';

/**
 * The whole rule, as a pure function so it can be tested without a database.
 *
 * Throws with the reason; returns the database name when the target is
 * approved.
 */
export function assertDisposableDatabase(url: string | undefined, optIn: string | undefined): string {
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set, so the integration suite has no database to run against.\n' +
        `Point it at a disposable database and opt in explicitly:\n` +
        `  ${OPT_IN}=1 DATABASE_URL_TEST=postgres://backoffice@localhost:5432/backoffice_itest npm run test:integration`,
    );
  }

  if (optIn !== '1') {
    throw new Error(
      `${OPT_IN} is not set to "1".\n` +
        'This suite TRUNCATES tables and drops schemas, so it refuses to run without an\n' +
        'explicit statement that the target database is disposable.',
    );
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // A malformed URL is refused rather than guessed at: every check below
    // depends on reading the host and the path correctly.
    throw new Error('DATABASE_URL_TEST is not a valid URL, so its target cannot be verified.');
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `DATABASE_URL_TEST points at host "${parsed.hostname}", which is not this machine.\n` +
        'A suite that truncates tables never has a legitimate reason to reach a remote\n' +
        'database — staging and production included.',
    );
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!ALLOWED_DATABASES.has(name)) {
    throw new Error(
      `DATABASE_URL_TEST points at database "${name}", which is not an approved disposable database.\n` +
        `Approved: ${[...ALLOWED_DATABASES].join(', ')}.\n` +
        'A name merely CONTAINING "test" is deliberately not enough — add a name here if a\n' +
        'new disposable database is genuinely needed.',
    );
  }

  return name;
}

export default function requireDatabase(): void {
  assertDisposableDatabase(process.env['DATABASE_URL_TEST'], process.env[OPT_IN]);
}

export { ALLOWED_DATABASES };
