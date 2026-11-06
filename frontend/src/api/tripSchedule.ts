import { httpClient } from './client';
import type {
  TripAssignmentFilter,
  TripEntryMode,
  TripExportScope,
  TripLifecycle,
  TripSchedule,
  TripScheduleWithRefs,
  TripStatus,
} from '@/types/trip';
import type { OffsetPage, OffsetPageRequest } from '@/types/pagination';
import type { SortDirection, TripBoardRow, TripBoardSort, TripExportRow } from '@/types/tripBoard';

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
  /**
   * `YYYY-MM-DD` — the planned pickup date, "Ngày lấy hàng". Always known;
   * `pickupAt`, when there is one, is an hour ON this day and the server
   * refuses the two disagreeing (422).
   */
  scheduledOn?: string;
  customerId?: string | null;
  cargoInfo?: string | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  pickupContact?: string | null;
  deliveryContact?: string | null;
  /**
   * ISO instants, or null. Delivery must be strictly after pickup — the
   * server refuses anything else with a 422, whichever route sent it.
   */
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
  /**
   * ★ NOT A CONTROL. The lifecycle is the server's: a booking opens `pending`,
   * the driver's first milestone starts it, approval closes it. The server
   * accepts this key only as the status the trip already holds (Lịch sử
   * chuyến's correction re-sends its frozen `finished`) and answers 422
   * `STATUS_SET_BY_SERVER` to anything else. Lịch xe never sends it.
   */
  status?: TripStatus;
  /**
   * ★ WHY THE TRIP IS ENTERED — the create intent, never a status. "Thêm
   * chuyến" sends `operational`; "Nhập chuyến cũ" sends `historical`, and the
   * SERVER then records the trip finished. Same route, same `trip.create`.
   */
  entryMode?: TripEntryMode;
  /**
   * The lorries and drivers a RECORDED run went out with (`historical` only;
   * needs `dispatch.write`). A booking is crewed through the dispatch routes.
   */
  crew?: { vehicleId: string; driverUserId: string }[];
}

/**
 * A patch.
 *
 * ⚠ OMITTING A KEY AND SENDING `null` MEAN DIFFERENT THINGS. Absent leaves the
 * field alone; `null` clears it. A form that builds this object with
 * `field || undefined` can therefore never empty a field the user has cleared —
 * send `null` for that, and omit only what the user did not touch.
 */
export type UpdateTripInput = Omit<Partial<CreateTripInput>, 'entryMode' | 'crew'>;

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
  /** Lịch xe or Lịch sử chuyến. Omitted, the server reads Lịch xe. */
  lifecycle?: TripLifecycle;
  /**
   * The server's order, never a sort applied here: a page is not the result
   * set, so sorting it in the browser would reorder twenty rows of a list of
   * hundreds. Omitted, the server orders by run day, newest first.
   */
  sort?: TripBoardSort;
  direction?: SortDirection;
  /**
   * Narrows the board to customers whose name contains this, case-insensitively.
   *
   * ★ A REAL FILTER, APPLIED BY THE SERVER. Narrowing a PAGE in the browser
   * would hide rows while the total beside them described others — "20 of 137"
   * printed over four. Omitted or empty, the server reads every customer.
   */
  customer?: string;
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

/** One page of the board. Its cost figures follow `cost.read`. */
export async function fetchTripSchedules(request: TripScheduleQuery = {}): Promise<OffsetPage<TripBoardRow>> {
  const { data } = await httpClient.get<OffsetPage<Wire<TripBoardRow>>>('/trip-schedules', {
    // axios drops `undefined` params, so an unset filter simply is not sent and
    // the server applies its own default — the current month, and the whole
    // board rather than one of its halves.
    params: {
      from: request.from,
      to: request.to,
      page: request.page,
      limit: request.limit,
      assignment: request.assignment,
      lifecycle: request.lifecycle,
      sort: request.sort,
      direction: request.direction,
      /**
       * ⚠ THIS WHITELIST IS THE LAST GATE, AND A PARAMETER MISSING FROM IT IS
       * INVISIBLE EVERYWHERE ELSE. `customer` was built into the request object,
       * carried through the cache key, and asserted in three tests that mock
       * `fetchTripSchedules` — and still never left the browser, because this
       * list did not mention it. Anything added to `TripScheduleQuery` has to be
       * added here too; `tripSchedule.api.spec` is what now says so out loud.
       */
      customer: request.customer,
    },
  });
  return { ...data, items: data.items.map(fromWire) };
}

/** What one Excel file is asked for: the range and the APPLIED customer search, and which screen(s). */
export interface TripExportRequest {
  from: string;
  to: string;
  /** `''` for every customer. */
  customer: string;
  scope: TripExportScope;
}

/** Every row one Excel file holds, and when the server began reading them. */
export interface TripExportSnapshot {
  items: TripExportRow[];
  /** The server's clock when the snapshot read began, ISO 8601. */
  readAt: string;
}

/** Unzips the gzip file the export route answers with, in the browser. */
const gunzipText = (bytes: ArrayBuffer): Promise<string> =>
  new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))).text();

/**
 * Every trip one Excel file holds — one screen or both — read by the server as
 * ONE consistent snapshot (`GET /trip-schedules/export-snapshot`).
 *
 * ★ ONE REQUEST, NOT A WALK. Pages read one request at a time are read at
 * different instants: a trip archived between two of them shifts every later
 * offset and another trip is never read — with the count unchanged and no id
 * twice. The server reads the whole filtered range in one transaction instead,
 * and its costs follow `cost.export` (DL-117) exactly as the paged route did.
 *
 * ★ THERE IS NO FALLBACK TO THE PAGED `/export`, ON PURPOSE. A server that does
 * not have this route yet must fail the export, not quietly produce a file from
 * a walk this build no longer trusts.
 *
 * ★ THE ANSWER IS A GZIP FILE (`application/gzip`) holding `{ items, readAt }`,
 * unzipped here with the browser's own `DecompressionStream`. Compressed by the
 * server rather than with `Content-Encoding`, so every hop between — the edge
 * proxy included — passes the bytes through untouched and ~25× smaller.
 * A refusal (`EXPORT_BUSY`, `EXPORT_TOO_LARGE`, 403…) is still JSON, decoded
 * below so the shared interceptor reads its code and details as usual.
 *
 * ★ NO SNAPSHOT, NO FILE. An answer that is not that file, or holds no rows or
 * no `readAt` — an older server, a proxy's HTML page served with a 200 — is
 * refused here, before anything is written.
 */
export async function fetchTripExportSnapshot({ from, to, customer, scope }: TripExportRequest): Promise<TripExportSnapshot> {
  const { data, headers } = await httpClient.get<ArrayBuffer>('/trip-schedules/export-snapshot', {
    params: { from, to, lifecycle: scope, assignment: 'all', customer },
    responseType: 'arraybuffer',
    transformResponse: (raw: ArrayBuffer, answer?: Record<string, unknown>) =>
      String(answer?.['content-type'] ?? '').includes('application/json')
        ? JSON.parse(new TextDecoder().decode(raw))
        : raw,
  });
  // The tag, not `instanceof`: an ArrayBuffer from another realm (a test's
  // Node buffer under jsdom) is still the bytes this expects.
  const isBytes = Object.prototype.toString.call(data) === '[object ArrayBuffer]';
  if (!String(headers['content-type'] ?? '').startsWith('application/gzip') || !isBytes) {
    throw new TypeError('The export answer carried no snapshot.');
  }
  let body: { items?: unknown; readAt?: unknown };
  try {
    body = JSON.parse(await gunzipText(data));
  } catch {
    throw new TypeError('The export answer carried no snapshot.');
  }
  if (!Array.isArray(body?.items) || typeof body.readAt !== 'string' || Number.isNaN(Date.parse(body.readAt))) {
    throw new TypeError('The export answer carried no snapshot.');
  }
  return { items: body.items as TripExportRow[], readAt: body.readAt };
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
