import { httpClient } from './client';
import type { BookingExport } from '@/types/bookingExport';

const READ_TIMEOUT_MS = 10_000;

/**
 * The booking document's data (contract §30). Read-only; the image is drawn in
 * the browser from exactly this, and nothing is sent anywhere else.
 */
export async function fetchBookingExport(tripId: string): Promise<BookingExport> {
  const { data } = await httpClient.get<BookingExport>(
    `/trip-schedules/${encodeURIComponent(tripId)}/booking-export`,
    { timeout: READ_TIMEOUT_MS },
  );
  return data;
}
