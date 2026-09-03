import { httpClient } from './client';

/**
 * Driver accounts — created outright, or proposed and then decided.
 *
 * ★ TWO ENDPOINTS BECAUSE THERE ARE TWO AUTHORITIES, not because there are two
 * screens. A global administrator creates a driver; a department head can only
 * propose one. Which call a screen makes is decided by what the caller holds,
 * and the server refuses the other either way — nothing here checks, because a
 * check on this side would be a second, weaker copy of the real rule.
 *
 * ★ AND THE TWO SHAPES DIFFER ON PURPOSE. Direct creation carries a temporary
 * password because the administrator chose it and it is used at once. A request
 * carries none and must not: a pending request can wait days, and the password
 * for one that is approved is generated at approval and shown once.
 */

export interface CreateDriverInput {
  displayName: string;
  email: string;
  initialPassword: string;
}

export interface RequestDriverInput {
  displayName: string;
  email: string;
}

export interface ProvisionedDriver {
  userId: string;
  displayName: string;
  /** Derived by the server from the email's local part. Not chosen by anyone. */
  username: string;
  /** Present only on approval, where the SERVER generated it. Shown once. */
  temporaryPassword?: string;
}

export type DriverRequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * ★ TWO SHAPES, BECAUSE THE SERVER SENDS TWO — verified against the controller
 * rather than assumed from what a screen happens to need.
 *
 * A MUTATION answers with the row it just wrote: ids and nothing else, because
 * resolving a name costs a join the write path has no reason to pay. A LIST
 * answers with the people resolved, because a screen cannot print a UUID.
 *
 * Declaring one type for both was a lie the compiler could not catch: reading
 * `requester.displayName` off a create response would have been `undefined` at
 * runtime while typechecking cleanly. The fix is to name what each endpoint
 * actually returns — not to cast, and not to widen the server's response so the
 * client can stop thinking about it.
 */
export interface DriverAccountRequest {
  id: string;
  email: string;
  displayName: string;
  status: DriverRequestStatus;
  /** A user id. The mutation responses carry ids, never resolved people. */
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Present on a rejection. The one thing that says what to fix. */
  decisionReason: string | null;
  /** Set exactly when approved. */
  createdUserId: string | null;
}

/** What the LIST endpoints add: the two people, resolved to names. */
export interface DriverAccountRequestWithUsers extends DriverAccountRequest {
  requester: { id: string; displayName: string };
  decider: { id: string; displayName: string } | null;
}

// ------------------------------------------------------ driver management --

export type DriverAccountStatus = 'active' | 'disabled';

/**
 * A driver account as the administrator's screen may know it.
 *
 * ★ SIX FIELDS, AND NO ROOM FOR A SEVENTH. This is what `GET /driver-accounts`
 * returns — a projection of `users` with the sign-in name derived. There is
 * no password, no hash, no session and no temporary credential on it, and a
 * screen that shows "everything about the driver" shows exactly this.
 */
export interface DriverAccount {
  id: string;
  displayName: string;
  /** Local part of the sign-in address; `null` when there is no local identity. */
  username: string | null;
  accountType: 'driver';
  status: DriverAccountStatus;
  createdAt: string;
}

/** `GET /driver-accounts` — every driver account, retired ones included. Global only. */
export async function fetchDrivers(): Promise<DriverAccount[]> {
  const { data } = await httpClient.get<DriverAccount[]>('/driver-accounts');
  return data;
}

/** `GET /driver-accounts/:id`. An employee's id is 404 here, by design. */
export async function fetchDriver(userId: string): Promise<DriverAccount> {
  const { data } = await httpClient.get<DriverAccount>(
    `/driver-accounts/${encodeURIComponent(userId)}`,
  );
  return data;
}

/**
 * `PATCH /driver-accounts/:id/status` — disable or re-enable. ACCOUNT STATUS
 * ONLY: the server revokes sessions on disable, and touches no trip
 * assignment in either direction. Whether a trip still needs a driver is
 * Operations' question, answered through the assignment flow.
 */
export async function setDriverStatus(
  userId: string,
  status: DriverAccountStatus,
): Promise<{ id: string; status: DriverAccountStatus }> {
  const { data } = await httpClient.patch<{ id: string; status: DriverAccountStatus }>(
    `/driver-accounts/${encodeURIComponent(userId)}/status`,
    { status },
  );
  return data;
}

/** `POST /driver-accounts` → 201. Global administrators only. */
export async function createDriver(input: CreateDriverInput): Promise<ProvisionedDriver> {
  const { data } = await httpClient.post<ProvisionedDriver>('/driver-accounts', input);
  return data;
}

/** `POST /driver-account-requests` → 201. Department heads. Creates nothing. */
export async function requestDriver(input: RequestDriverInput): Promise<DriverAccountRequest> {
  // Raw: the write path returns the row it inserted, with ids and no join.
  const { data } = await httpClient.post<DriverAccountRequest>('/driver-account-requests', input);
  return data;
}

/** `GET /driver-account-requests` — the reviewer's queue. */
export async function fetchPendingDriverRequests(): Promise<DriverAccountRequestWithUsers[]> {
  const { data } = await httpClient.get<DriverAccountRequestWithUsers[]>('/driver-account-requests');
  return data;
}

/** `GET /driver-account-requests/mine` — scoped to the session, not a parameter. */
export async function fetchMyDriverRequests(): Promise<DriverAccountRequestWithUsers[]> {
  const { data } = await httpClient.get<DriverAccountRequestWithUsers[]>(
    '/driver-account-requests/mine',
  );
  return data;
}

export async function approveDriverRequest(
  requestId: string,
): Promise<{ request: DriverAccountRequest; driver: ProvisionedDriver }> {
  const { data } = await httpClient.post<{
    request: DriverAccountRequest;
    driver: ProvisionedDriver;
  }>(`/driver-account-requests/${requestId}/approve`);
  return data;
}

/** The reason is REQUIRED — the server refuses a blank one with 422. */
export async function rejectDriverRequest(
  requestId: string,
  reason: string,
): Promise<DriverAccountRequest> {
  const { data } = await httpClient.post<DriverAccountRequest>(
    `/driver-account-requests/${requestId}/reject`,
    { reason },
  );
  return data;
}
