import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { fetchTripCustomers, fetchTripLocations, fetchTripVehicles } from '@/api/tripCatalogue';
import { useSession } from '@/contexts/SessionProvider';
import { ApiError, isApiError } from '@/utils/errors';
import type { TripCustomer, TripLocation, TripVehicle } from '@/types/trip';
import { tripKeys } from './keys';

/**
 * One catalogue.
 *
 * `items` is the same list as `data`, defaulted to `[]`, so a caller that only
 * wants to render rows never repeats `?? []` and never has to decide what a
 * null list means. `data` stays available for the caller that must tell "not
 * loaded yet" from "loaded and empty" apart.
 */
export interface CatalogueList<T> {
  data: T[] | null;
  items: T[];
  error: ApiError | null;
  loading: boolean;
  forbidden: boolean;
  notFound: boolean;
}

export interface TripCatalogue {
  vehicles: CatalogueList<TripVehicle>;
  customers: CatalogueList<TripCustomer>;
  /** True while EITHER list is still in flight. */
  loading: boolean;
  /** Drop both from the cache — after adding, renaming or retiring a row. */
  reload: () => void;
}

/**
 * How long a catalogue stays fresh: five minutes.
 *
 * ★ MUCH LONGER THAN THE APP DEFAULT (one minute), because these two lists are
 * the least volatile data on the screen. A truck joins the fleet a few times a
 * year; the trip list beside it changes several times an hour. Re-reading both
 * catalogues on every navigation was two requests buying nothing — and they are
 * on the critical path of the trip form, which cannot be filled in until they
 * arrive.
 *
 * Correctness does not rest on the window: every mutation calls `reload`, which
 * invalidates regardless of age. This only decides how long an UNCHANGED list
 * is trusted.
 */
const CATALOGUE_STALE_MS = 5 * 60 * 1000;

/**
 * The vehicle and customer catalogues, read together and reloaded together.
 *
 * ★ THE TWO READS ARE INDEPENDENT, NOT A `Promise.all`. They are separate
 * endpoints with separate outcomes: combining them would mean one 403 blanks
 * both lists, so a working customer list would disappear because the vehicle
 * one refused. Each list carries its own `error`/`forbidden`, and the screen
 * that shows one tab at a time reads only the tab it is showing.
 *
 * ★ AND THEY ARE SHARED. Both trip screens mount this hook, keyed the same way,
 * so moving between the dispatch board and the master data screen serves them
 * from cache instead of re-reading — and two components mounting it in the same
 * render are ONE request, not two.
 *
 * @param includeArchived retired rows included. Off for the trip form's
 * dropdowns — an archived truck must not be offered for a NEW trip — and on
 * only where somebody is administering the catalogue itself. It is part of the
 * cache key, so the two variants never overwrite each other.
 */
export function useTripCatalogue(includeArchived = false): TripCatalogue {
  const queryClient = useQueryClient();
  const { state, loading: sessionLoading } = useSession();
  const enabled = state?.status === 'ready';

  const vehicles = useQuery({
    queryKey: tripKeys.vehicles(includeArchived),
    queryFn: () => fetchTripVehicles(includeArchived),
    enabled,
    staleTime: CATALOGUE_STALE_MS,
  });

  const customers = useQuery({
    queryKey: tripKeys.customers(includeArchived),
    queryFn: () => fetchTripCustomers(includeArchived),
    enabled,
    staleTime: CATALOGUE_STALE_MS,
  });

  const reload = useCallback(() => {
    // One prefix for both lists AND both `includeArchived` variants: a plate
    // renamed on the master data screen is the same row the trip form offers,
    // and leaving the other variant cached would show the old spelling there.
    void queryClient.invalidateQueries({ queryKey: tripKeys.catalogues() });
  }, [queryClient]);

  const vehicleList = useCatalogueList(vehicles, sessionLoading);
  const customerList = useCatalogueList(customers, sessionLoading);

  return {
    vehicles: vehicleList,
    customers: customerList,
    loading: vehicleList.loading || customerList.loading,
    reload,
  };
}

/**
 * ONE customer's places, or nothing while no customer is chosen.
 *
 * ★ KEYED BY THE CUSTOMER. Switching customer switches the cache entry, so a
 * list for customer A can never be shown under customer B; the trip form
 * additionally drops a selected place the moment it stops belonging to the
 * customer on the form.
 */
export function useTripLocations(
  customerId: string | null,
  includeArchived = false,
): CatalogueList<TripLocation> & { reload: () => void } {
  const queryClient = useQueryClient();
  const { state, loading: sessionLoading } = useSession();
  const enabled = state?.status === 'ready' && customerId !== null;

  const query = useQuery({
    queryKey: tripKeys.locations(customerId ?? '', includeArchived),
    queryFn: () => fetchTripLocations(customerId as string, includeArchived),
    enabled,
    staleTime: CATALOGUE_STALE_MS,
  });

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: tripKeys.catalogues() });
  }, [queryClient]);

  const list = useCatalogueList(query, sessionLoading);
  // No customer: an empty, settled list — not a loading one.
  return customerId === null
    ? { data: [], items: [], error: null, loading: false, forbidden: false, notFound: false, reload }
    : { ...list, reload };
}

/** The query's own shape, as the four states a screen actually branches on. */
function useCatalogueList<T>(
  query: UseQueryResult<T[], Error>,
  sessionLoading: boolean,
): CatalogueList<T> {
  const error = useMemo(() => {
    if (!query.error) return null;
    return isApiError(query.error) ? query.error : new ApiError(0, undefined, 'Unexpected error.');
  }, [query.error]);

  return {
    data: query.data ?? null,
    items: query.data ?? [],
    error,
    // `isFetching`, not `isLoading`: a background revalidation of a cached list
    // is a request in flight, and the pagination and empty states both key off
    // this. It is false when the session gate is closed, because then nothing
    // is being fetched at all.
    loading: sessionLoading || query.isFetching,
    forbidden: error?.status === 403,
    notFound: error?.status === 404,
  };
}
