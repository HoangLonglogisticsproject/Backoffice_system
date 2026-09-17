/**
 * The shapes the backend actually returns, per the integration contract.
 *
 * There is deliberately NO `access_token` anywhere in this file. The session is
 * an HttpOnly cookie (§1) — JavaScript cannot read it, there is nothing to
 * store, and a type that named a token would invite somebody to look for one.
 */

/** Contract §14. `MEMBER` is the absence of an elevated role, not a stored row. */
export type Role = 'SUPERADMIN' | 'DEPARTMENT_HEAD' | 'MEMBER';

/**
 * Which application an account belongs in. A `driver` is refused every
 * Backoffice route by the server whatever its permissions list, so this is
 * what the client routes SHELLS on — see `SessionGuard`.
 */
export const ACCOUNT_TYPES = ['employee', 'driver'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Contract §14. Render hints only — the server re-decides on every request. */
export type PermissionKey =
  | 'unit.read'
  | 'unit.write'
  | 'unit.member.read'
  | 'unit.member.write'
  | 'role.assign'
  | 'user.write'
  // The trip schedule (§21). Trip data belongs to the sales, accounting and
  // dispatch functions and to the superadmin (2026-09-17): `trip.read` and
  // `trip.create` appear for those callers and for nobody else — an HR member
  // or head sees no board at all, and the DISPATCH menu is drawn only when
  // `trip.read` is present. `trip.write` — correcting somebody else's row —
  // is the superadmin or a head WITHIN one of those three functions.
  | 'trip.read'
  | 'trip.create'
  | 'trip.write'
  /**
   * ★ DISPATCHING — a lorry and its driver onto a trip, swapping, ending, and
   * the driver list to choose from. Held by the superadmin and by every member
   * of a department whose FUNCTION is dispatch (0032); a head of any other
   * department does not hold it, however senior. Deliberately not `trip.write`.
   */
  | 'dispatch.write'
  /**
   * ★ SEEING THE TWO PRICES ON A TRIP ROW — what it is sold for and what it is
   * bought for. The superadmin and everybody — head or member alike — in a
   * sales, accounting or dispatch department; nobody else, however senior.
   * Read only: the columns are drawn, the form shows the figures, nothing is
   * typed.
   */
  | 'trip.price.read'
  /**
   * ★ SETTING THEM. The superadmin and the dispatch function (0032).
   *
   * ★ THE ONLY RENDER HINT ON THIS LIST THAT ALSO DECIDES WHETHER A FIELD IS
   * COMPULSORY, AND WHICH KEYS ARE SENT. The server REFUSES a body that
   * carries either price key from a caller without it — so this is not the
   * usual "hide a button somebody could still POST to". A caller who holds it
   * must give a selling price when creating a trip; one who does not creates
   * the trip unpriced, and dispatch prices it later.
   */
  | 'trip.price.write'
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
  | 'trip.complete.review'
  /**
   * ★ PROPOSE A DRIVER ACCOUNT, AND NOTHING MORE. Tier `head-anywhere` on the
   * server: any department head holds it. It does not create an account —
   * approving is `user.write`, which is global.
   */
  | 'driver.account.request';

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
  /** Selects the shell (`/driver` or the Backoffice). Never an authorization input. */
  accountType: AccountType;
  role: Role;
  departmentIds: string[];
  permissions: PermissionKey[];
}
