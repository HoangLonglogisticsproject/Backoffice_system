import { BASE_URL, requireBossCredentials } from './integration-credentials';

/**
 * Completes the bootstrapped SuperAdmin's FIRST LOGIN, once, before the suite.
 *
 * ★ THIS IS THE OPERATOR'S FIRST STEP, not a workaround. `user:create` now mints
 * a credential that must be replaced — the password was typed on a command line
 * and is in shell history, so it gets somebody in once and then stops meaning
 * anything. Until it is replaced, `/authorization/me` answers 403
 * PASSWORD_CHANGE_REQUIRED and every guarded route with it, which is exactly
 * what a real deployment does to a real operator.
 *
 * The specs are about departments, invitations and approvals; they need an
 * account that has finished being provisioned. Doing it here rather than in
 * five `beforeAll`s means it happens once, in the right order, and no spec
 * carries a step that is not what it is testing.
 *
 * ★ THE GATE ITSELF IS STILL TESTED — `session.integration.spec.ts` §12 walks
 * it end to end on an account it provisions for the purpose. Settling the
 * bootstrap account here removes a fixture obstacle, not the coverage.
 *
 * Idempotent by construction: it looks at the session state first and does
 * nothing when the account is already settled, so a re-run against a database
 * that survived is a no-op rather than a second password change.
 */
export default async function settleBootstrapLogin(): Promise<void> {
  const { email, password } = requireBossCredentials();

  const login = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ subject: email, password }),
  });

  if (login.status !== 200) {
    throw new Error(
      `Could not sign in as ${email} (${login.status}). Bootstrap a SuperAdmin first.`,
    );
  }

  const cookie = (login.headers.getSetCookie?.() ?? [])
    .find((value) => value.startsWith('bo_session='))
    ?.split(';')[0];

  if (cookie === undefined) {
    throw new Error('Login succeeded but issued no session cookie.');
  }

  const state = await fetch(`${BASE_URL}/authorization/me`, { headers: { Cookie: cookie } });
  if (state.status !== 403) return;

  // ★ TO THE SAME VALUE, deliberately. The suite is handed one credential
  // through the environment and every spec signs in with it; inventing a second
  // one here would mean the value the caller gave us stops working halfway
  // through the run. Nothing in the password policy forbids it — what the flag
  // records is "this has been through a change", not "this is a new string".
  const changed = await fetch(`${BASE_URL}/auth/password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookie,
    },
    body: JSON.stringify({ currentPassword: password, newPassword: password }),
  });

  if (changed.status !== 204) {
    throw new Error(
      `The bootstrap account requires a password change and it failed (${changed.status}). ` +
        'Every guarded route answers 403 until it succeeds, so the suite cannot run.',
    );
  }
}
