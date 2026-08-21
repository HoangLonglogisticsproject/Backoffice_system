/**
 * The shapes the backend actually returns, per the integration contract.
 *
 * There is deliberately NO `access_token` anywhere in this file. The session is
 * an HttpOnly cookie (§1) — JavaScript cannot read it, there is nothing to
 * store, and a type that named a token would invite somebody to look for one.
 */

/** Contract §14. `MEMBER` is the absence of an elevated role, not a stored row. */
export type Role = 'SUPERADMIN' | 'DEPARTMENT_HEAD' | 'MEMBER';

/** Contract §14. Render hints only — the server re-decides on every request. */
export type PermissionKey =
  | 'unit.read'
  | 'unit.write'
  | 'unit.member.read'
  | 'unit.member.write'
  | 'role.assign'
  | 'user.write';

export type UserStatus = 'active' | 'disabled';

/** `GET /auth/me` (§1). Identity only — no permissions. */
export interface Identity {
  id: string;
  displayName: string;
  status: UserStatus;
}

/** `POST /auth/login` (§1). `expiresAt` is for warning before expiry. */
export interface LoginResult {
  user: Identity;
  expiresAt: string;
}

/**
 * `GET /authorization/me` (§3).
 *
 * `departmentIds` holds AT MOST ONE id — an active person belongs to exactly
 * one department, and it is empty for SUPERADMIN, who sits above departments.
 * Do not build multi-department UI on it; that state cannot exist.
 */
export interface AuthorizationMe {
  userId: string;
  /**
   * Local part of the login email, derived by the server. Display only — never
   * an authorization input (§0), and never parsed out of an email here.
   *
   * ★ NULLABLE, because the server says so. `AuthorizationMeResponse` declares
   * `string | null` and returns null whenever the account has no local subject.
   * This type used to claim `string`, so TypeScript never made anyone handle
   * the null — and the first thing to read it crashed on `undefined`.
   */
  username: string | null;
  role: Role;
  departmentIds: string[];
  permissions: PermissionKey[];
}
