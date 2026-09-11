import { httpClient } from './client';
import type {
  TripAssignmentFilter,
  TripSchedule,
  TripScheduleWithRefs,
  TripStatus,
} from '@/types/trip';
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
  customerId?: string | null;
  cargoInfo?: string | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  pickupContact?: string | null;
  deliveryContact?: string | null;
  /** ISO instant, or null. May land on a later day than `scheduledOn`. */
  pickupAt?: string | null;
  deliveryAt?: string | null;
  /**
   * ★ THE CUSTOMER'S PLACE FOR EACH END, never a coordinate. The server copies
   * the place's address, contact and coordinates onto the trip; there is no
   * field on this body through which a coordinate could be typed.
   */
  pickupLocationId?: string | null;
  deliveryLocationId?: string | null;
  /**
   * What the customer is charged and what the carrier is paid.
   *
   * ★ STRINGS, e.g. `"4500000"` — the same rule every amount in `tripCost.ts`
   * follows, and for the same reason. A JSON number is float64, so
   * `4500000.01` would arrive as something a little else; the server refuses a
   * number outright, and refuses a third decimal place too, because
   * `NUMERIC(14,2)` would ROUND that rather than reject it.
   *
   * `null` clears one. Zero is refused — a trip charged nothing and a trip not
   * yet priced are different rows and must not render alike.
   *
   * ⚠ OMIT BOTH KEYS UNLESS THE CALLER HOLDS `trip.price.read`. The server
   * answers 403 to a body carrying either from anybody else — it does not
   * strip them, because silently dropping a figure somebody typed and
   * answering 201 would say the trip is priced when it is not. And when the
   * caller DOES hold it, `sellPrice` is compulsory on create: the server
   * answers 422 without one.
   */
  sellPrice?: string | null;
  purchasePrice?: string | null;
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

/**
 * What narrows the board, on top of the range and the page.
 *
 * ★ `assignment` GOES TO THE SERVER, and that is the whole point of it being
 * here rather than in a `.filter()` on the result. A page is not the result
 * set: dropping the crewed rows in the browser would leave `total`,
 * `totalPages` and the `STT` column all describing a list nobody is looking at.
 */
export interface TripScheduleQuery extends OffsetPageRequest {
  assignment?: TripAssignmentFilter;
}

/**
 * A trip exactly as the server sends it.
 *
 * ★ THE LEGACY COLUMN KEEPS ITS LEGACY NAME ON THE WIRE. `vehicle_id` has had
 * no writer since 0027, but the endpoint still returns it and this client still
 * needs it for a trip booked with a lorry and never crewed. Renaming it HERE
 * rather than asking for an API change keeps the two compatible and gives every
 * line above this boundary a name that says what the value is.
 */
type Wire<T> = Omit<T, 'legacyVehicleId'> & { vehicleId: string | null };

/**
 * The ONE place `vehicle_id` is read. Above it the field is `legacyVehicleId`
 * and nothing else; below it is the server's vocabulary, not ours.
 *
 * The cast is the one TypeScript cannot prove: `Omit<T, k> & { k2 }` is
 * structurally T for every trip shape we have, but the compiler will not derive
 * that for an unresolved generic.
 */
const fromWire = <T extends { legacyVehicleId: string | null }>(row: Wire<T>): T => {
  const { vehicleId, ...rest } = row;
  return { ...rest, legacyVehicleId: vehicleId } as unknown as T;
};

export async function fetchTripSchedules(
  request: TripScheduleQuery = {},
): Promise<OffsetPage<TripScheduleWithRefs>> {
  const { data } = await httpClient.get<OffsetPage<Wire<TripScheduleWithRefs>>>('/trip-schedules', {
    // axios drops `undefined` params, so an unset filter simply is not sent and
    // the server applies its own default — the current month, and the whole
    // board rather than one of its halves.
    params: {
      from: request.from,
      to: request.to,
      page: request.page,
      limit: request.limit,
      assignment: request.assignment,
    },
  });
  return { ...data, items: data.items.map(fromWire) };
}

/**
 * The API's ceiling on one page — `MAX_LIMIT` in the backend's `cursor.ts`.
 *
 * Asking for more is refused rather than clamped, on purpose, so this constant
 * has to match. It is the page size for the walk below and nothing else: the
 * board on screen keeps its own, smaller one.
 */
const MAX_PAGE_SIZE = 200;

/**
 * Every trip matching a filter, across every page.
 *
 * ★ THIS IS NOT THE READER THE BOARD USES, AND MUST NOT BECOME IT. The screen
 * pages deliberately — see the header of `types/pagination.ts` — and the whole
 * argument for offset pagination here is that a mandatory date range keeps the
 * result set small. This walk leans on the SAME bound rather than escaping it:
 * a range is at most 366 days, so the loop is bounded by something the server
 * enforces, not by the caller's good manners.
 *
 * It exists for the Excel export, which is the one operation whose subject
 * genuinely IS the result set rather than a page of it. Rendering these rows in
 * a table would put the app back where the workbook was.
 *
 * ★ SEQUENTIAL, NOT CONCURRENT. `totalPages` comes from the first response, so
 * the pages after it could be fetched at once — but firing fifty requests at a
 * server sized for a dispatch office trades a progress bar nobody watches for a
 * spike everybody feels. In order, one at a time, reporting as it goes.
 *
 * ⚠ AND IT IS A SNAPSHOT ACROSS SEVERAL READS, not one consistent query. A trip
 * added while the walk runs can shift rows between pages. For an export of a
 * past range — what this is for — that cannot happen; for today's board it can,
 * and the fix would be a server-side export, not a smarter loop here.
 */
export async function fetchAllTripSchedules(
  request: Omit<TripScheduleQuery, 'page' | 'limit'> = {},
  onProgress?: (loaded: number, total: number) => void,
): Promise<TripScheduleWithRefs[]> {
  const first = await fetchTripSchedules({ ...request, page: 1, limit: MAX_PAGE_SIZE });

  const rows = [...first.items];
  onProgress?.(rows.length, first.total);

  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await fetchTripSchedules({ ...request, page, limit: MAX_PAGE_SIZE });
    rows.push(...next.items);
    onProgress?.(rows.length, first.total);
  }

  return rows;
}

export async function fetchTripSchedule(tripId: string): Promise<TripScheduleWithRefs> {
  const { data } = await httpClient.get<Wire<TripScheduleWithRefs>>(
    `/trip-schedules/${encodeURIComponent(tripId)}`,
  );
  return fromWire(data);
}

/**
 * Adds a row. Any signed-in caller may.
 *
 * No `createdBy` argument, deliberately: the server reads the author from the
 * session cookie, and an argument for it would be a value the client picks and
 * the server ignores — which reads like it does something.
 */
export async function createTripSchedule(input: CreateTripInput): Promise<TripSchedule> {
  const { data } = await httpClient.post<Wire<TripSchedule>>('/trip-schedules', input);
  return fromWire(data);
}

/** Corrects a row. GLOBAL only — an ordinary member gets 403 here. */
export async function updateTripSchedule(
  tripId: string,
  input: UpdateTripInput,
): Promise<TripSchedule> {
  const { data } = await httpClient.patch<Wire<TripSchedule>>(
    `/trip-schedules/${encodeURIComponent(tripId)}`,
    input,
  );
  return fromWire(data);
}

/** Moves a row along the board. Its own endpoint, its own permission. */
export async function updateTripStatus(
  tripId: string,
  status: TripStatus,
): Promise<TripSchedule> {
  const { data } = await httpClient.patch<Wire<TripSchedule>>(
    `/trip-schedules/${encodeURIComponent(tripId)}/status`,
    { status },
  );
  return fromWire(data);
}

/**
 * Takes a row off the board.
 *
 * POST and "archive", not DELETE: the row survives, keeps its author, and stops
 * appearing in lists. Copy in the UI must say so — a button labelled "Xoá" over
 * an operation that preserves the record is a description of something else.
 */
export async function archiveTripSchedule(tripId: string): Promise<TripSchedule> {
  const { data } = await httpClient.post<Wire<TripSchedule>>(
    `/trip-schedules/${encodeURIComponent(tripId)}/archive`,
  );
  return fromWire(data);
}
