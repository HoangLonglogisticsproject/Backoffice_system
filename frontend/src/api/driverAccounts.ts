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

export interface DriverAccountRequest {
  id: string;
  email: string;
  displayName: string;
  status: DriverRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  /** Present on a rejection. The one thing that says what to fix. */
  decisionReason: string | null;
  requester: { id: string; displayName: string };
  decider: { id: string; displayName: string } | null;
}

/** `POST /driver-accounts` → 201. Global administrators only. */
export async function createDriver(input: CreateDriverInput): Promise<ProvisionedDriver> {
  const { data } = await httpClient.post<ProvisionedDriver>('/driver-accounts', input);
  return data;
}

/** `POST /driver-account-requests` → 201. Department heads. Creates nothing. */
export async function requestDriver(input: RequestDriverInput): Promise<DriverAccountRequest> {
  const { data } = await httpClient.post<DriverAccountRequest>('/driver-account-requests', input);
  return data;
}

/** `GET /driver-account-requests` — the reviewer's queue. */
export async function fetchPendingDriverRequests(): Promise<DriverAccountRequest[]> {
  const { data } = await httpClient.get<DriverAccountRequest[]>('/driver-account-requests');
  return data;
}

/** `GET /driver-account-requests/mine` — scoped to the session, not a parameter. */
export async function fetchMyDriverRequests(): Promise<DriverAccountRequest[]> {
  const { data } = await httpClient.get<DriverAccountRequest[]>('/driver-account-requests/mine');
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
