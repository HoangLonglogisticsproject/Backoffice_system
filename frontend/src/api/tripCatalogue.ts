import { httpClient } from './client';
import type { TripCustomer, TripLocation, TripVehicle } from '@/types/trip';

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
// ★ ALWAYS UNDER A CUSTOMER. Every call names the customer in the path; there
// is no `/trip-locations`, and the server holds each id to its customer.

const locationsPath = (customerId: string) =>
  `/trip-customers/${encodeURIComponent(customerId)}/locations`;

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
