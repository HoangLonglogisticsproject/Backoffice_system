import { randomBytes } from 'node:crypto';

/**
 * Credentials for the integration suite. NOTHING HERE HAS A DEFAULT.
 *
 * There are two different kinds of password in these specs, and only one of
 * them was ever a problem:
 *
 *   THE BOOTSTRAP CREDENTIAL — `BOSS_EMAIL` / `BOSS_PASSWORD`. It signs in to a
 *   deployment that already exists. A fallback for it is a real password the
 *   moment somebody points `API_BASE_URL` at a real server, and it is one that
 *   lives in git, gets copied into the next spec, and outlives everyone who
 *   remembers it was meant to be a placeholder. It comes from the environment
 *   or the suite refuses to run.
 *
 *   FIXTURE PASSWORDS — the ones a spec chooses for an account it provisions
 *   itself, seconds earlier, in a disposable database. These authenticate
 *   nothing that outlives the run. They were still written out as literals, so
 *   `grep` could not tell them apart from the one above; `fixturePassword`
 *   generates them instead. That is not a secret being invented — nothing
 *   stores it, and a fresh one per call is strictly better than a constant,
 *   because a flow that only works with one particular string is a flow with a
 *   bug in it.
 *
 * Required in CI (see `.github/workflows/ci.yml`, which mints and masks a
 * throwaway credential per run) and locally:
 *
 *   API_BASE_URL             default http://localhost:3000
 *   BOSS_EMAIL               the bootstrapped SuperAdmin
 *   BOSS_BOOTSTRAP_PASSWORD  what `user:create` was given
 *   BOSS_PASSWORD            what it becomes at first login — and it must DIFFER
 *
 * Two of them, because a bootstrapped credential must be REPLACED before the
 * account works, and a replacement that equals the original is refused. That is
 * the product rule, not a test detail: the password `user:create` was given
 * travelled through a command line, and the gate exists to retire it.
 */

export const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

export interface BossCredentials {
  email: string;
  /** What the suite signs in with — the password AFTER the first login. */
  password: string;
  /**
   * What `user:create` was given. A bootstrapped account must replace its
   * credential before anything works, and the replacement has to be a DIFFERENT
   * string — so the harness needs both halves, exactly as an operator does.
   */
  bootstrapPassword: string;
}

const read = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
};

/**
 * The bootstrap credential, or a failure that NAMES what is missing.
 *
 * Call it from `beforeAll`. The alternative — reading the variables at module
 * scope and letting `undefined` reach the login — surfaces as a puzzling 401
 * from a request that was never given anything to sign in with.
 */
export function requireBossCredentials(): BossCredentials {
  const email = read('BOSS_EMAIL');
  const password = read('BOSS_PASSWORD');
  const bootstrapPassword = read('BOSS_BOOTSTRAP_PASSWORD');

  const missing = [
    ['BOSS_EMAIL', email],
    ['BOSS_PASSWORD', password],
    ['BOSS_BOOTSTRAP_PASSWORD', bootstrapPassword],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (
    missing.length > 0 ||
    email === undefined ||
    password === undefined ||
    bootstrapPassword === undefined
  ) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'The integration suite runs against a real deployment and has no default ' +
        'credential by design — set them to the bootstrapped SuperAdmin. ' +
        'CI mints a throwaway one per run; see .github/workflows/ci.yml.',
    );
  }

  return { email, password, bootstrapPassword };
}

/**
 * A password for an account this run creates and throws away.
 *
 * Long enough for the permanent floor (`PASSWORD_POLICY.minLength`, 12) as well
 * as the temporary one (8), so one generator covers both uses. `label` is there
 * to keep a failure readable — seeing `fixture-temporary-…` in an error beats
 * seeing base64 and wondering which of the four passwords it was.
 */
export function fixturePassword(label: string): string {
  return `fixture-${label}-${randomBytes(18).toString('base64url')}`;
}
