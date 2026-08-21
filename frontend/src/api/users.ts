import { httpClient } from './client';

/**
 * Creating an account directly (contract §4).
 *
 * ★ GLOBAL ONLY, AND THAT IS THE WHOLE DIFFERENCE FROM THE INVITATION FLOW. A
 * department head cannot reach this route; they raise an account invitation and
 * an administrator decides it. Two audiences, two endpoints, two shapes — see
 * `account-invitation.repository`.
 *
 * Nothing here checks who is calling. The session cookie says that and the
 * server enforces it; a check on this side would be a second, weaker copy of a
 * rule that already exists, and the only thing it could achieve is disagreeing
 * with the real one.
 */

export interface CreateUserInput {
  displayName: string;
  email: string;
  /**
   * The password the person signs in with ONCE.
   *
   * The server marks the credential as temporary, so their first sign-in is
   * answered with `PASSWORD_CHANGE_REQUIRED` and they must choose their own
   * before anything else works (§12).
   */
  initialPassword: string;
  departmentId: string;
}

export interface CreatedUser {
  id: string;
  displayName: string;
  /** Derived by the server from the email's local part. Not chosen by anyone. */
  username: string;
  status: string;
  departmentId: string;
}

/** `POST /users` → 201. */
export async function createUser(input: CreateUserInput): Promise<CreatedUser> {
  const { data } = await httpClient.post<CreatedUser>('/users', input);
  return data;
}

/**
 * Disables an account (contract §4).
 *
 * `disabled` is the only status this phase accepts. Re-enabling asks "into
 * which department", because an active user belonging nowhere is the one state
 * the model forbids — so it is not a status flip and has no endpoint yet.
 */
export async function disableUser(userId: string): Promise<void> {
  await httpClient.patch(`/users/${encodeURIComponent(userId)}/status`, { status: 'disabled' });
}
