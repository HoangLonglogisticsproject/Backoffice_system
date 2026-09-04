import { httpClient } from './client';
import type { UserSummary } from '@/types/organization';
import type { Page, PageRequest } from '@/types/pagination';
import type { TripStatus } from '@/types/trip';

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

/**
 * One turn, read from the DRIVER's side.
 *
 * ★ THE SAME ROWS AS `DriverAssignment`, ASKED THE OTHER WAY ROUND. That shape
 * names the person, because its question is "who has driven this trip". This one
 * names the trip, because its question is "what has this person driven" — and
 * repeating the driver on every row of a list the caller opened BY driver would
 * be printing back the thing they already knew.
 *
 * ⚠ AND IT CARRIES NO MONEY. The server joins neither cost table, so there is no
 * amount in this shape for a screen to reach for.
 */
export interface DriverTripHistoryRow {
  /** The assignment's id — what makes each row unique, not the trip's. */
  id: string;
  state: 'active' | 'ended';
  assignedAt: string;
  endedAt: string | null;
  endReason: string | null;
  trip: {
    id: string;
    /** `YYYY-MM-DD`. A string — parsing it into a `Date` moves the day. */
    scheduledOn: string;
    status: TripStatus;
    vehicle: { id: string; plate: string } | null;
    customer: { id: string; name: string } | null;
  };
}

const path = (tripId: string) => `/trip-schedules/${encodeURIComponent(tripId)}/driver-assignments`;

/** Every live driver account, id and name. */
export async function fetchEligibleDrivers(): Promise<UserSummary[]> {
  const { data } = await httpClient.get<UserSummary[]>('/trip-drivers');
  return data;
}

/**
 * `GET /trip-drivers/:driverUserId/trips` — what one driver has been given.
 *
 * ★ ENDED TURNS INCLUDED. The trip somebody was taken off is a fact about them;
 * a history that showed only the live work would just be the assignment dropdown
 * again. Archived trips are out, as they are from every read of the board.
 *
 * `trip.read` on the server — the same key as one trip's assignment history,
 * which is the same rows asked from the other end.
 */
export async function fetchDriverTrips(
  driverUserId: string,
  page: PageRequest = {},
): Promise<Page<DriverTripHistoryRow>> {
  const { data } = await httpClient.get<Page<DriverTripHistoryRow>>(
    `/trip-drivers/${encodeURIComponent(driverUserId)}/trips`,
    { params: { limit: page.limit, cursor: page.cursor } },
  );
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
