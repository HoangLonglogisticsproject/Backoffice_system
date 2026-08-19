import { httpClient } from '../http/client';
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
  const { data } = await httpClient.get<AuthorizationMe>('/authorization/me');
  return data;
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
