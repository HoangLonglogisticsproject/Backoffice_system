/**
 * Refuses to run the integration suite anywhere but an approved disposable
 * database — the backend's rule, copied (ADR-0007: doctrine shared, code not).
 *
 * ★ THESE SPECS ARE DESTRUCTIVE. They drop schemas and, in the privilege
 * suite, drop and recreate CLUSTER-LEVEL ROLES. Three conditions, all
 * required: the opt-in variable, a loopback host, and a database name on an
 * exact allowlist.
 */

const ALLOWED_DATABASES = new Set(['backoffice_itest', 'backoffice_test']);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const OPT_IN = 'ALLOW_DESTRUCTIVE_DB_TESTS';

export function assertDisposableDatabase(url: string | undefined, optIn: string | undefined): string {
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set, so the integration suite has no database to run against.\n' +
        'Point it at a disposable database and opt in explicitly:\n' +
        `  ${OPT_IN}=1 DATABASE_URL_TEST=postgres://backoffice@localhost:5432/backoffice_itest npm run test:integration`,
    );
  }

  if (optIn !== '1') {
    throw new Error(
      `${OPT_IN} is not set to "1".\n` +
        'This suite drops schemas and recreates roles, so it refuses to run without an\n' +
        'explicit statement that the target database is disposable.',
    );
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL_TEST is not a valid URL, so its target cannot be verified.');
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `DATABASE_URL_TEST points at host "${parsed.hostname}", which is not this machine.\n` +
        'A destructive suite never has a legitimate reason to reach a remote database.',
    );
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!ALLOWED_DATABASES.has(name)) {
    throw new Error(
      `DATABASE_URL_TEST points at database "${name}", which is not an approved disposable database.\n` +
        `Approved: ${[...ALLOWED_DATABASES].join(', ')}.`,
    );
  }

  return name;
}

export default function requireDatabase(): void {
  assertDisposableDatabase(process.env['DATABASE_URL_TEST'], process.env[OPT_IN]);
}

export { ALLOWED_DATABASES };
