import { httpClient } from './client';
import type { DriverAssignmentRequest, DriverOpenBookingItem } from '@/types/openBooking';

/**
 * The driver's open bookings and their own asks (0035).
 *
 * ★ NO PARAMETER NAMES A DRIVER. The scope is the session: the list is what is
 * open, the asks are the caller's, and an ask is made as the caller.
 */

const READ_TIMEOUT_MS = 10_000;

export async function fetchOpenBookings(): Promise<DriverOpenBookingItem[]> {
  const { data } = await httpClient.get<DriverOpenBookingItem[]>('/driver/open-bookings', { timeout: READ_TIMEOUT_MS });
  return data;
}

export async function fetchMyAssignmentRequests(): Promise<DriverAssignmentRequest[]> {
  const { data } = await httpClient.get<DriverAssignmentRequest[]>('/driver/assignment-requests', {
    timeout: READ_TIMEOUT_MS,
  });
  return data;
}

/** "Xin nhận chuyến". A retry or double tap gets the SAME request back. */
export async function requestOpenBooking(tripId: string): Promise<DriverAssignmentRequest> {
  const { data } = await httpClient.post<DriverAssignmentRequest>(
    `/driver/open-bookings/${encodeURIComponent(tripId)}/requests`,
    {},
  );
  return data;
}

/** Takes back a PENDING ask. A decided one answers 409. */
export async function withdrawAssignmentRequest(requestId: string): Promise<DriverAssignmentRequest> {
  const { data } = await httpClient.post<DriverAssignmentRequest>(
    `/driver/assignment-requests/${encodeURIComponent(requestId)}/withdraw`,
    {},
  );
  return data;
}
