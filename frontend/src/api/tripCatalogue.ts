import { httpClient } from './client';
import type {
  TripCustomer,
  TripLocation,
  TripLocationListing,
  TripVehicle,
} from '@/types/trip';

/**
 * The vehicle and customer catalogues (contract §21).
 *
 * ★ NEITHER LIST IS PAGINATED, and neither should be treated as if it were.
 * They return BARE ARRAYS — no envelope, no cursor, no total — for the same
 * reason `GET /departments` does: both are bounded small, and both sort by a
 * column that can be edited, which a cursor cannot survive.
 *
 * ★ ANY SIGNED-IN CALLER MAY ADD TO THEM. That asymmetry (`trip.create` to add,
 * `trip.write` to rename or retire) is deliberate: a dispatcher who cannot add
 * the customer in front of them will put the name in the cargo note instead,
 * and the catalogue gets bypassed on exactly the rows it exists to discipline.
 */

export interface CreateVehicleInput {
  plate: string;
  note?: string | null;
}

export interface UpdateVehicleInput {
  plate?: string;
  note?: string | null;
}

export interface CreateCustomerInput {
  name: string;
  note?: string | null;
}

export interface LocationInput {
  name: string;
  address: string;
  contact?: string | null;
  note?: string | null;
  /** Tỉnh/thành · quận/huyện · phường/xã. Free text; `null` is "not recorded". */
  province?: string | null;
  district?: string | null;
  ward?: string | null;
  /** Both or neither. The server refuses half a point. */
  latitude?: number | null;
  longitude?: number | null;
}

export interface UpdateCustomerInput {
  name?: string;
  note?: string | null;
}

/**
 * `includeArchived` is sent as the literal string the server accepts.
 *
 * Only `'true'` and `'false'` are valid; anything else is a 422. It is left
 * unsent when false so the default path carries no parameter at all.
 */
const archivedParam = (includeArchived: boolean) =>
  includeArchived ? { includeArchived: 'true' } : {};

export async function fetchTripVehicles(includeArchived = false): Promise<TripVehicle[]> {
  const { data } = await httpClient.get<TripVehicle[]>('/trip-vehicles', {
    params: archivedParam(includeArchived),
  });
  return data;
}

/**
 * Adds a truck.
 *
 * A plate that normalises onto an existing one answers **409**, with a message
 * naming the spelling already in the catalogue. That is the case worth showing
 * verbatim: the user typed `51D 65233` and the fleet already knows it as
 * `51D.65233`, and only the message says which.
 */
export async function createTripVehicle(input: CreateVehicleInput): Promise<TripVehicle> {
  const { data } = await httpClient.post<TripVehicle>('/trip-vehicles', input);
  return data;
}

export async function updateTripVehicle(
  vehicleId: string,
  input: UpdateVehicleInput,
): Promise<TripVehicle> {
  const { data } = await httpClient.patch<TripVehicle>(
    `/trip-vehicles/${encodeURIComponent(vehicleId)}`,
    input,
  );
  return data;
}

/**
 * Retires a truck.
 *
 * Trips that already name it keep showing its plate; what changes is that it
 * stops being offered when somebody enters a new trip. The UI must not call
 * this "delete".
 */
export async function archiveTripVehicle(vehicleId: string): Promise<TripVehicle> {
  const { data } = await httpClient.post<TripVehicle>(
    `/trip-vehicles/${encodeURIComponent(vehicleId)}/archive`,
  );
  return data;
}

export async function fetchTripCustomers(includeArchived = false): Promise<TripCustomer[]> {
  const { data } = await httpClient.get<TripCustomer[]>('/trip-customers', {
    params: archivedParam(includeArchived),
  });
  return data;
}

export async function createTripCustomer(input: CreateCustomerInput): Promise<TripCustomer> {
  const { data } = await httpClient.post<TripCustomer>('/trip-customers', input);
  return data;
}

export async function updateTripCustomer(
  customerId: string,
  input: UpdateCustomerInput,
): Promise<TripCustomer> {
  const { data } = await httpClient.patch<TripCustomer>(
    `/trip-customers/${encodeURIComponent(customerId)}`,
    input,
  );
  return data;
}

export async function archiveTripCustomer(customerId: string): Promise<TripCustomer> {
  const { data } = await httpClient.post<TripCustomer>(
    `/trip-customers/${encodeURIComponent(customerId)}/archive`,
  );
  return data;
}

// ------------------------------------------------------------- locations ----
//
// ★ TWO GROUPS OF CALLS, ONE TABLE.
//
//   under a customer   `/trip-customers/:id/locations` — that customer's own
//                      places. The server holds each id to the customer named
//                      in the path; somebody else's answers 404.
//   the catalogue      `/trip-locations` — every place with its owner
//                      resolved, creating SHARED ones, and correcting or
//                      retiring any row by id.
//
// The customer segment is routing, not authorisation: both groups need the same
// permissions over the same deployment-wide catalogue.

const locationsPath = (customerId: string) =>
  `/trip-customers/${encodeURIComponent(customerId)}/locations`;

const locationPath = (locationId: string) => `/trip-locations/${encodeURIComponent(locationId)}`;

/** Every place, shared first, each carrying `customerName`. */
export async function fetchAllTripLocations(
  includeArchived = false,
): Promise<TripLocationListing[]> {
  const { data } = await httpClient.get<TripLocationListing[]>('/trip-locations', {
    params: archivedParam(includeArchived),
  });
  return data;
}

/**
 * Adds a SHARED place — one belonging to no customer.
 *
 * A name that normalises onto an existing shared place answers **409** naming
 * the spelling already there, exactly as the vehicle catalogue does. A
 * customer's own place with the same name is not a clash: the two populations
 * have separate unique indexes.
 */
export async function createSharedTripLocation(input: LocationInput): Promise<TripLocation> {
  const { data } = await httpClient.post<TripLocation>('/trip-locations', input);
  return data;
}

/** Corrects any place by id — shared or a customer's. The catalogue's edit. */
export async function updateTripLocationById(
  locationId: string,
  input: Partial<LocationInput>,
): Promise<TripLocation> {
  const { data } = await httpClient.patch<TripLocation>(locationPath(locationId), input);
  return data;
}

export async function archiveTripLocationById(locationId: string): Promise<TripLocation> {
  const { data } = await httpClient.post<TripLocation>(`${locationPath(locationId)}/archive`);
  return data;
}

export async function fetchTripLocations(
  customerId: string,
  includeArchived = false,
): Promise<TripLocation[]> {
  const { data } = await httpClient.get<TripLocation[]>(locationsPath(customerId), {
    params: archivedParam(includeArchived),
  });
  return data;
}

export async function createTripLocation(
  customerId: string,
  input: LocationInput,
): Promise<TripLocation> {
  const { data } = await httpClient.post<TripLocation>(locationsPath(customerId), input);
  return data;
}

export async function updateTripLocation(
  customerId: string,
  locationId: string,
  input: Partial<LocationInput>,
): Promise<TripLocation> {
  const { data } = await httpClient.patch<TripLocation>(
    `${locationsPath(customerId)}/${encodeURIComponent(locationId)}`,
    input,
  );
  return data;
}

export async function archiveTripLocation(
  customerId: string,
  locationId: string,
): Promise<TripLocation> {
  const { data } = await httpClient.post<TripLocation>(
    `${locationsPath(customerId)}/${encodeURIComponent(locationId)}/archive`,
  );
  return data;
}
