import { BASE_URL, requireBossCredentials } from './integration-credentials';

/**
 * Completes the bootstrapped SuperAdmin's FIRST LOGIN, once, before the suite.
 *
 * ★ THIS IS THE OPERATOR'S FIRST STEP, not a workaround. `user:create` mints a
 * credential that must be replaced — the password was typed on a command line
 * and is in shell history — so until it is replaced `/authorization/me` answers
 * 403 PASSWORD_CHANGE_REQUIRED and every guarded route with it. Exactly what a
 * real deployment does to a real operator.
 *
 * ★ AND IT REPLACES IT WITH A DIFFERENT STRING, because the backend refuses a
 * change that changes nothing. An earlier version of this file submitted the
 * same password back, which cleared the flag while leaving the leaked
 * credential live; closing that hole is what `BOSS_BOOTSTRAP_PASSWORD` is for.
 * The account is created with one password and signs in with another, which is
 * the same two-step a person goes through.
 *
 * ★ THE GATE IS NOT PROVEN HERE. `session.integration.spec.ts` walks it end to
 * end on an account it provisions inside the test — 403, change, old session
 * dead, new password works. This function only removes a fixture obstacle for
 * the other suites, and must never be mistaken for the evidence.
 *
 * Idempotent: it asks what state the account is in before touching it, so a
 * re-run against a database that survived is a no-op.
 */
export default async function settleBootstrapLogin(): Promise<void> {
  const { email, password, bootstrapPassword } = requireBossCredentials();

  const signIn = (secret: string) =>
    fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ subject: email, password: secret }),
    });

  const cookieOf = (response: Response): string | undefined =>
    (response.headers.getSetCookie?.() ?? [])
      .find((value) => value.startsWith('bo_session='))
      ?.split(';')[0];

  // Already settled? Then the suite's password is the live one and there is
  // nothing to do. Checked first so a surviving database costs one request.
  const settled = await signIn(password);
  if (settled.status === 200) {
    const cookie = cookieOf(settled);
    if (cookie === undefined) throw new Error('Login succeeded but issued no session cookie.');

    const state = await fetch(`${BASE_URL}/authorization/me`, { headers: { Cookie: cookie } });
    if (state.status === 200) return;

    throw new Error(
      `Signed in with BOSS_PASSWORD but /authorization/me answered ${state.status}. ` +
        'The account is in a state this setup does not know how to finish.',
    );
  }

  const first = await signIn(bootstrapPassword);
  if (first.status !== 200) {
    throw new Error(
      `Could not sign in as ${email} with either password ` +
        `(BOSS_PASSWORD ${settled.status}, BOSS_BOOTSTRAP_PASSWORD ${first.status}). ` +
        'Bootstrap a SuperAdmin with BOSS_BOOTSTRAP_PASSWORD first.',
    );
  }

  const cookie = cookieOf(first);
  if (cookie === undefined) throw new Error('Login succeeded but issued no session cookie.');

  const changed = await fetch(`${BASE_URL}/auth/password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookie,
    },
    body: JSON.stringify({ currentPassword: bootstrapPassword, newPassword: password }),
  });

  if (changed.status !== 204) {
    throw new Error(
      `The bootstrap account requires a password change and it failed (${changed.status}). ` +
        'Every guarded route answers 403 until it succeeds, so the suite cannot run. ' +
        'BOSS_PASSWORD must differ from BOSS_BOOTSTRAP_PASSWORD and meet the password policy.',
    );
  }
}
