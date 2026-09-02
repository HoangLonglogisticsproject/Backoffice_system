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
  | 'user.write'
  // The trip schedule (§21). The only permissions here that ask nothing about a
  // department: dispatch is company-wide data, so `trip.read` and `trip.create`
  // appear for every signed-in caller, including one who is between departments.
  // `trip.write` — correcting somebody else's row — stays global.
  | 'trip.read'
  | 'trip.create'
  | 'trip.write'
  // The money on a trip (§21). Separate keys from `trip.*` on purpose: the
  // board is read by everybody and the amounts on it are not, so a caller
  // without `cost.read` is never sent a figure at all. All three are GLOBAL
  // today — a fail-closed placeholder until role mapping is designed.
  | 'cost.read'
  | 'cost.create'
  | 'cost.void'
  // ★ CLOSING A TRIP, AND DELIBERATELY NOT `trip.write`. A dispatcher
  // correcting a delivery address and a reviewer closing a trip's books are
  // different acts with different consequences — approval is irreversible —
  // so sharing a key would mean the narrower one could never be granted
  // without the wider. GLOBAL, because the contract reserves it to one actor.
  | 'trip.complete.review';

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
  /**
   * True when the credential just used is the temporary one provisioning hands
   * out (§12). Declared because the server returns it — NOT what the app routes
   * on: `/authorization/me` answering 403 PASSWORD_CHANGE_REQUIRED is the
   * authority, and that answer stays true on every later request rather than
   * only on the one that signed in.
   */
  mustChangePassword: boolean;
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
