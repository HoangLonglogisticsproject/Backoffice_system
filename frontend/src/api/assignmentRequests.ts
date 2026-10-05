import { httpClient } from './client';
import type { DispatchAssignmentRequest } from '@/types/openBooking';

/**
 * Dispatch reviewing drivers' asks (0035) — `dispatch.write` on every call.
 *
 * ★ APPROVING IS ASSIGNING. The server crews the asking driver with the lorry
 * named here through the same path a direct assignment takes, and supersedes
 * every other pending ask on the booking. No body names the approver.
 */

const tripPath = (tripId: string) => `/trip-schedules/${encodeURIComponent(tripId)}/assignment-requests`;

/** Every pending ask — bounded: a pending ask means an open booking. */
export async function fetchAssignmentRequestQueue(): Promise<DispatchAssignmentRequest[]> {
  const { data } = await httpClient.get<DispatchAssignmentRequest[]>('/assignment-request-queue');
  return data;
}

/** Every ask on one trip, decided ones included. */
export async function fetchTripAssignmentRequests(tripId: string): Promise<DispatchAssignmentRequest[]> {
  const { data } = await httpClient.get<DispatchAssignmentRequest[]>(tripPath(tripId));
  return data;
}

/** Resolves when the server has committed; the screen then re-reads, it never guesses. */
export async function approveAssignmentRequest(tripId: string, requestId: string, vehicleId: string): Promise<void> {
  await httpClient.post(`${tripPath(tripId)}/${encodeURIComponent(requestId)}/approve`, { vehicleId });
}

export async function rejectAssignmentRequest(tripId: string, requestId: string, reason: string | null): Promise<void> {
  await httpClient.post(`${tripPath(tripId)}/${encodeURIComponent(requestId)}/reject`, { reason });
}
