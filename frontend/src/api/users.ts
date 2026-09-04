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
 * ★ NOT A SIMPLE STATUS FLIP. The server also revokes every role, kills every
 * session and ends the active membership, in one transaction — which is why
 * anything that calls this must RE-READ rather than patch the row on screen.
 */
export async function disableUser(userId: string): Promise<void> {
  await httpClient.patch(`/users/${encodeURIComponent(userId)}/status`, { status: 'disabled' });
}

/**
 * Puts a DRIVER account back into service.
 *
 * ★ DRIVERS ONLY, AND THE SERVER IS WHAT MAKES IT SO. Re-enabling an employee
 * asks "into which department", because an active employee belonging nowhere is
 * the one state the model forbids — and that answer has still not been decided.
 * A driver belongs to no unit BY DESIGN, so there is nothing to ask: the server
 * checks `account_type` and answers 409 for anybody else.
 *
 * ⚠ IT IS NOT THE UNDO OF `disableUser`. Roles and sessions are not restored —
 * they were deliberately taken away, and granting them again is a separate act.
 * A driver holds neither, which is why this is a whole operation for them and
 * only half of one for anybody else.
 */
export async function enableDriverAccount(userId: string): Promise<void> {
  await httpClient.patch(`/users/${encodeURIComponent(userId)}/status`, { status: 'active' });
}
