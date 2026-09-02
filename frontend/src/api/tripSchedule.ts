import { httpClient } from './client';
import type { TripSchedule, TripScheduleWithRefs, TripStatus } from '@/types/trip';
import type { OffsetPage, OffsetPageRequest } from '@/types/pagination';

/**
 * The dispatch board (contract §21).
 *
 * ★ THIS RESOURCE HAS NO DEPARTMENT ON ITS ROUTE, and that is not an omission
 * to be corrected. Trips belong to the company: the truck is the company's, the
 * customer is the company's, and dispatch is not a unit anybody is a member of.
 * Do not look for a department id to interpolate here.
 *
 * ★ AND IT IS THE ONE LIST THAT RETURNS `OffsetPage`, not `Page`. See
 * `types/pagination.ts` for why, and do not generalise a reader over both.
 */

/**
 * What a caller may send when adding a trip.
 *
 * Payload types live in the api module rather than in `types/`, following the
 * existing convention: `types/` holds what the server IS, this holds what one
 * endpoint ACCEPTS.
 */
export interface CreateTripInput {
  /** `YYYY-MM-DD`. The only required field. */
  scheduledOn: string;
  vehicleId?: string | null;
  customerId?: string | null;
  cargoInfo?: string | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  pickupContact?: string | null;
  deliveryContact?: string | null;
  /** ISO instant, or null. May land on a later day than `scheduledOn`. */
  pickupAt?: string | null;
  deliveryAt?: string | null;
  /** Both halves of a pair or neither; the server refuses half a point. */
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  note?: string | null;
  status?: TripStatus;
}

/**
 * A patch.
 *
 * ⚠ OMITTING A KEY AND SENDING `null` MEAN DIFFERENT THINGS. Absent leaves the
 * field alone; `null` clears it. A form that builds this object with
 * `field || undefined` can therefore never empty a field the user has cleared —
 * send `null` for that, and omit only what the user did not touch.
 */
export type UpdateTripInput = Partial<CreateTripInput>;

export async function fetchTripSchedules(
  request: OffsetPageRequest = {},
): Promise<OffsetPage<TripScheduleWithRefs>> {
  const { data } = await httpClient.get<OffsetPage<TripScheduleWithRefs>>('/trip-schedules', {
    // axios drops `undefined` params, so an unset filter simply is not sent and
    // the server applies its own default — the current month.
    params: {
      from: request.from,
      to: request.to,
      page: request.page,
      limit: request.limit,
    },
  });
  return data;
}

export async function fetchTripSchedule(tripId: string): Promise<TripScheduleWithRefs> {
  const { data } = await httpClient.get<TripScheduleWithRefs>(
    `/trip-schedules/${encodeURIComponent(tripId)}`,
  );
  return data;
}

/**
 * Adds a row. Any signed-in caller may.
 *
 * No `createdBy` argument, deliberately: the server reads the author from the
 * session cookie, and an argument for it would be a value the client picks and
 * the server ignores — which reads like it does something.
 */
export async function createTripSchedule(input: CreateTripInput): Promise<TripSchedule> {
  const { data } = await httpClient.post<TripSchedule>('/trip-schedules', input);
  return data;
}

/** Corrects a row. GLOBAL only — an ordinary member gets 403 here. */
export async function updateTripSchedule(
  tripId: string,
  input: UpdateTripInput,
): Promise<TripSchedule> {
  const { data } = await httpClient.patch<TripSchedule>(
    `/trip-schedules/${encodeURIComponent(tripId)}`,
    input,
  );
  return data;
}

/** Moves a row along the board. Its own endpoint, its own permission. */
export async function updateTripStatus(
  tripId: string,
  status: TripStatus,
): Promise<TripSchedule> {
  const { data } = await httpClient.patch<TripSchedule>(
    `/trip-schedules/${encodeURIComponent(tripId)}/status`,
    { status },
  );
  return data;
}

/**
 * Takes a row off the board.
 *
 * POST and "archive", not DELETE: the row survives, keeps its author, and stops
 * appearing in lists. Copy in the UI must say so — a button labelled "Xoá" over
 * an operation that preserves the record is a description of something else.
 */
export async function archiveTripSchedule(tripId: string): Promise<TripSchedule> {
  const { data } = await httpClient.post<TripSchedule>(
    `/trip-schedules/${encodeURIComponent(tripId)}/archive`,
  );
  return data;
}
