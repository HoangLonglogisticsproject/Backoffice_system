import { httpClient } from '../http/client';
import { ApiError } from '../http/apiError';
import type { AuthorizationMe, Identity, LoginResult } from '../type/auth';

/**
 * The four identity endpoints, exactly as contract §1 describes them.
 *
 * Nothing here stores anything. The session lives in an HttpOnly cookie the
 * browser manages, so there is no token to keep, no refresh to schedule and no
 * storage to clear on logout.
 */

/**
 * ⚠ THE FIELD IS `subject`, NOT `email` (contract §1).
 *
 * The value IS an email — it is the only login identifier — but the field keeps
 * the identity-provider's name. Sending `email` is a 422, and it is the single
 * most common way this integration is got wrong, so the mapping happens here
 * once rather than at every caller.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const { data } = await httpClient.post<LoginResult>('/auth/login', {
    subject: email,
    password,
  });
  return data;
}

/** Identity only, no permissions. Works even on a temporary credential (§1). */
export async function fetchIdentity(): Promise<Identity> {
  const { data } = await httpClient.get<Identity>('/auth/me');
  return data;
}

/**
 * The render contract for the whole app (§3).
 *
 * 401 when anonymous, 403 PASSWORD_CHANGE_REQUIRED on a temporary credential.
 * Both are session states rather than errors — `sessionRepository.current()`
 * is the one place that reads them that way.
 */
export async function fetchAuthorization(): Promise<AuthorizationMe> {
  const { data } = await httpClient.get<unknown>('/authorization/me');

  // ★ A 200 IS NOT PROOF THE BODY IS OURS, and the generic on `get<T>` is a
  // compile-time assertion that checks nothing at runtime.
  //
  // When `VITE_API_URL` is unset the client falls back to same-origin, which in
  // development is the Vite dev server rather than the API. Vite answers an
  // unknown path with `index.html` and a 200, so this function used to return a
  // string of HTML typed as `AuthorizationMe`, `current()` wrapped it as a
  // READY session, and the first screen to read `.username` off it crashed.
  //
  // Refusing here turns a misconfiguration into the session state it actually
  // is — not signed in — so the normal login redirect happens instead of a
  // half-rendered shell.
  if (!isAuthorizationMe(data)) {
    throw new ApiError(
      0,
      undefined,
      'The authorization endpoint did not return a session. Check VITE_API_URL.',
    );
  }

  return data;
}

const ROLES = new Set<string>(['SUPERADMIN', 'DEPARTMENT_HEAD', 'MEMBER']);

/**
 * Is this actually the shape the contract promises?
 *
 * Deliberately checks the fields the app depends on rather than every field:
 * the point is to reject a response that is not ours at all, not to re-specify
 * the contract on the client.
 */
function isAuthorizationMe(value: unknown): value is AuthorizationMe {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.userId === 'string' &&
    (typeof candidate.username === 'string' || candidate.username === null) &&
    typeof candidate.role === 'string' &&
    ROLES.has(candidate.role) &&
    Array.isArray(candidate.departmentIds) &&
    Array.isArray(candidate.permissions)
  );
}

export async function logout(): Promise<void> {
  await httpClient.post('/auth/logout');
}

/**
 * Changes the password, and ends every session including this one (§1).
 *
 * `currentPassword` is required even though a session exists: it is what stops
 * a stolen cookie becoming a permanent takeover. The caller must send the user
 * back to login afterwards — there is no session left to continue.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await httpClient.post('/auth/password', { currentPassword, newPassword });
}
