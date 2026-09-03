import { httpClient } from './client';
import type { UserSummary } from '@/types/organization';

/**
 * Who drives a trip. Backoffice routes, behind `trip.write` on the server.
 *
 * ★ THE DRIVER IS NAMED BY ID AND NOTHING ELSE. Whether that account is a
 * driver, is live, and whether the trip is still open are decided on the
 * server under its lock; a 409 here means the board moved — refetch it.
 */

export interface DriverAssignment {
  id: string;
  tripId: string;
  driverUserId: string;
  driverUser: UserSummary;
  state: 'active' | 'ended';
  assignedBy: string;
  assignedAt: string;
  endedBy: string | null;
  endedAt: string | null;
  endReason: string | null;
}

const path = (tripId: string) => `/trip-schedules/${encodeURIComponent(tripId)}/driver-assignments`;

/** Every live driver account, id and name. */
export async function fetchEligibleDrivers(): Promise<UserSummary[]> {
  const { data } = await httpClient.get<UserSummary[]>('/trip-drivers');
  return data;
}

export async function fetchDriverAssignments(tripId: string): Promise<DriverAssignment[]> {
  const { data } = await httpClient.get<DriverAssignment[]>(path(tripId));
  return data;
}

export async function assignDriver(tripId: string, driverUserId: string): Promise<DriverAssignment> {
  const { data } = await httpClient.post<DriverAssignment>(path(tripId), { driverUserId });
  return data;
}

export async function replaceDriver(
  tripId: string,
  input: { driverUserId: string; reason: string },
): Promise<DriverAssignment> {
  const { data } = await httpClient.post<DriverAssignment>(`${path(tripId)}/replace`, input);
  return data;
}

export async function endDriverAssignment(tripId: string, reason: string): Promise<DriverAssignment> {
  const { data } = await httpClient.post<DriverAssignment>(`${path(tripId)}/end`, { reason });
  return data;
}
