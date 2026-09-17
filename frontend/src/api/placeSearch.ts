import { httpClient } from './client';

/**
 * Finding a place by typing its address, so a location gets the coordinates
 * the driver's arrival is measured against.
 *
 * ★ FROM OUR OWN API, NOT FROM THE SOURCE. The server proxies and caches the
 * upstream behind `/places`. The browser never learns which service that is —
 * so the provider's key stays on the server, the office's monthly allowance is
 * spent once rather than once per dispatcher, and swapping the provider is a
 * server-side change. This is the same shape as `vnAdministrative.ts`, for the
 * same reasons plus one: the previous provider's key shipped INSIDE the bundle.
 *
 * ★ TWO CALLS, BECAUSE A SUGGESTION CARRIES NO POINT. `searchPlaces` is what
 * somebody sees while typing; `resolvePlace` turns the one row they chose into
 * coordinates. Resolving all eight so the browser could pick would be eight
 * lookups to discard seven, against an allowance counted in requests.
 */

/** One row in the suggestion list. */
export interface PlaceSuggestion {
  /** The provider's id. Opaque here; it only ever goes back to them. */
  id: string;
  /** The bold line: `Vincom Center Đồng Khởi`. */
  primary: string;
  /** The quiet line under it. Empty when the provider offered no split. */
  secondary: string;
}

/** One chosen place, with the thing we came for. */
export interface ResolvedPlace {
  /** The provider's tidy form of the address. `null` when they did not say. */
  address: string | null;
  latitude: number;
  longitude: number;
}

/** What to offer somebody who has typed part of an address. */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const { data } = await httpClient.get<PlaceSuggestion[]>('/places', { params: { q: query } });
  return data;
}

/**
 * The point behind an address as it was WRITTEN — nobody picks a row.
 *
 * ★ THIS IS WHAT MAKES THE POSITION APPEAR BY ITSELF. `searchPlaces` needs the
 * operator to choose; this takes what is already in the address box. `null`
 * means "nothing matches that", which is an ordinary answer while somebody is
 * still halfway through typing — not an error.
 */
export async function geocodeAddress(query: string): Promise<ResolvedPlace | null> {
  const { data } = await httpClient.get<ResolvedPlace | null>('/geocode', { params: { q: query } });
  return data;
}

/** The coordinates behind one chosen suggestion. */
export async function resolvePlace(id: string): Promise<ResolvedPlace> {
  const { data } = await httpClient.get<ResolvedPlace>(`/places/${encodeURIComponent(id)}`);
  return data;
}
