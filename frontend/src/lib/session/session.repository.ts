import { fetchAuthorization, fetchIdentity } from '../api/auth.repository';
import { isApiError } from '../http/apiError';
import type { AuthorizationMe, Identity } from '../type/auth';

/**
 * The one place that answers "what is the current session".
 *
 * Contract §3b: the answer has THREE values, not two, and the third is where
 * integrations go wrong. Modelling it as a union means a caller cannot forget
 * the middle case — there is no boolean to be half-right about.
 */
export type SessionState =
  | { status: 'anonymous' }
  | { status: 'password-change-required'; identity: Identity }
  | { status: 'ready'; authorization: AuthorizationMe };

/**
 * Resolves the session by asking the only endpoint that knows (§3).
 *
 *   200                            → ready
 *   401 UNAUTHORIZED               → anonymous
 *   403 PASSWORD_CHANGE_REQUIRED   → still signed in, must change password
 *
 * ⚠ THE 403 IS NOT A LOGOUT. The cookie is alive, `/auth/me` still answers, and
 * `POST /auth/password` still works — that endpoint is the only way out of the
 * state. Treating this 403 like the 401 produces the loop §3b describes: log
 * in, get bounced, log in again, forever, because the exit is behind the screen
 * the redirect never reaches.
 *
 * Anything else is not a session state and is rethrown, so a 500 or a network
 * failure surfaces as an error instead of quietly logging somebody out.
 */
export async function current(): Promise<SessionState> {
  try {
    return { status: 'ready', authorization: await fetchAuthorization() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.status === 401) return { status: 'anonymous' };

    if (error.status === 403 && error.is('PASSWORD_CHANGE_REQUIRED')) {
      // The session still resolves an identity, which the change-password
      // screen needs in order to show who is being changed.
      return { status: 'password-change-required', identity: await fetchIdentity() };
    }

    // A plain 403 lands here on purpose: it means "not allowed to do that",
    // which is not a statement about the session at all.
    throw error;
  }
}
