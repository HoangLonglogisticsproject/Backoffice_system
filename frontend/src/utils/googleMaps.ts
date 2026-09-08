/**
 * Google Maps Platform, for AUTHORING a place — and for nothing else.
 *
 * ★ THE ONLY FILE THAT KNOWS GOOGLE EXISTS, together with `LocationMap`.
 * Everything else works with an address and a pair of numbers. The Driver
 * Portal never imports this: the phone's own Geolocation API produces the
 * reading, and the server's haversine produces the verdict. Google here helps
 * an operator find a warehouse and put a pin on its gate — the pin's final
 * position is what `trip_locations` stores, and that is the business truth.
 *
 * ★ TWO PRODUCTS, LOADED ONCE, ONLY WHEN THE LOCATION FORM OPENS.
 *
 *   Maps JavaScript API   the map, the draggable marker, the radius circle
 *   Places API (New)      autocomplete suggestions, then ONE details fetch
 *
 * No Geocoding API, no Map ID, no Advanced Markers. The script tag is injected
 * on first use and never on app start, so a deployment without a key — and
 * every page a driver opens — loads nothing from Google at all.
 *
 * ★ COST. Suggestions and the details fetch share a SESSION TOKEN, so one
 * search-then-select is billed as one session rather than a request per
 * keystroke; the caller debounces on top of that. The token is renewed after
 * each selection, as the API requires.
 *
 * ★ THE KEY IS A BROWSER KEY, AND IT IS NOT A SECRET IN THE SERVER'S SENSE.
 * It ships in the bundle by design — every Maps JavaScript integration does —
 * and is protected in the Google console by HTTP-referrer restriction to this
 * deployment's origin and by API restriction to the two products above. It is
 * read from `VITE_GOOGLE_MAPS_API_KEY`, the same convention as `VITE_API_URL`,
 * and never committed: `.env.example` documents it, `.env` is ignored.
 */

// ---------------------------------------------------------------- types ----
//
// ★ A NARROW HAND-WRITTEN SURFACE, NOT `@types/google.maps`. These are the
// handful of members this integration touches, typed exactly as used. It keeps
// the boundary visible — anything Google-shaped that is not declared here is
// not used anywhere — and adds no dependency for a few dozen lines.

export interface Coordinates {
  latitude: number;
  longitude: number;
}

interface LatLngLiteral {
  lat: number;
  lng: number;
}

interface LatLng {
  lat(): number;
  lng(): number;
}

interface Listener {
  remove(): void;
}

export interface GoogleMap {
  panTo(position: LatLngLiteral): void;
  setZoom(zoom: number): void;
  addListener(event: 'click', handler: (event: { latLng: LatLng | null }) => void): Listener;
}

export interface GoogleMarker {
  setMap(map: GoogleMap | null): void;
  setPosition(position: LatLngLiteral): void;
  getPosition(): LatLng | null | undefined;
  addListener(event: 'dragend', handler: () => void): Listener;
}

export interface GoogleCircle {
  setMap(map: GoogleMap | null): void;
  setCenter(center: LatLngLiteral): void;
}

export interface MapsLibrary {
  Map: new (host: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Circle: new (options: Record<string, unknown>) => GoogleCircle;
}

export interface MarkerLibrary {
  /**
   * ponytail: the classic `Marker`, deprecated in favour of
   * `AdvancedMarkerElement` but still served and still the only one that
   * needs no Map ID. Move to advanced markers the day a Map ID is provisioned,
   * and not before — it is a second console setting for no operator benefit.
   */
  Marker: new (options: Record<string, unknown>) => GoogleMarker;
}

interface PlacePrediction {
  placeId: string;
  text: { text: string };
  mainText: { text: string } | null;
  secondaryText: { text: string } | null;
  toPlace(): Place;
}

interface Place {
  location: LatLng | null | undefined;
  formattedAddress: string | null | undefined;
  fetchFields(request: { fields: string[] }): Promise<unknown>;
}

interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: Record<string, unknown>): Promise<{
      suggestions: ReadonlyArray<{ placePrediction: PlacePrediction | null }>;
    }>;
  };
}

interface GoogleMapsApi {
  importLibrary(name: 'maps'): Promise<MapsLibrary>;
  importLibrary(name: 'marker'): Promise<MarkerLibrary>;
  importLibrary(name: 'places'): Promise<PlacesLibrary>;
}

declare global {
  interface Window {
    google?: { maps?: GoogleMapsApi };
    /** The script's ready callback. Namespaced so it collides with nothing. */
    __hoangLongMapsReady?: () => void;
  }
}

// -------------------------------------------------------------- loading ----

const apiKey = (): string =>
  ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim();

/** Whether this deployment can offer the map at all. Absent key: manual entry. */
export const isMapsConfigured = (): boolean => apiKey() !== '';

let loading: Promise<GoogleMapsApi> | null = null;

/**
 * The SDK, loaded once per page. Concurrent callers share the promise; a
 * failed load is forgotten so the next open can try again.
 */
export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  const present = window.google?.maps;
  if (present) return Promise.resolve(present);
  if (loading) return loading;

  loading = new Promise<GoogleMapsApi>((resolve, reject) => {
    const fail = (reason: string) => {
      loading = null;
      delete window.__hoangLongMapsReady;
      reject(new Error(reason));
    };
    if (!isMapsConfigured()) {
      fail('Google Maps is not configured: VITE_GOOGLE_MAPS_API_KEY is empty.');
      return;
    }

    window.__hoangLongMapsReady = () => {
      delete window.__hoangLongMapsReady;
      const api = window.google?.maps;
      if (api) resolve(api);
      else fail('Google Maps loaded without exposing its API.');
    };

    const params = new URLSearchParams({
      key: apiKey(),
      v: 'weekly',
      loading: 'async',
      callback: '__hoangLongMapsReady',
      // Addresses are Vietnamese addresses whichever language the office
      // has the interface in; the stored address should read as the place
      // itself is written.
      language: 'vi',
      region: 'VN',
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => fail('Google Maps script could not be loaded.');
    document.head.append(script);
  });

  return loading;
}

// --------------------------------------------------------------- places ----

/** One row in the search dropdown. Google's ids never leave this module's callers as anything else. */
export interface PlaceSuggestion {
  id: string;
  /** The place's own name or street line. */
  primary: string;
  /** The district and city behind it. */
  secondary: string;
}

/** What a chosen place gives the form: the two numbers, and an address to offer. */
export interface ResolvedPlace {
  address: string | null;
  latitude: number;
  longitude: number;
}

let session: object | null = null;

/**
 * ★ THE PREDICTION TRAVELS WITH ITS OWN SUGGESTION, NOT IN A SHARED MAP.
 *
 * Two searches overlap whenever a debounce fires while the previous request
 * is still in flight. A module-level map keyed by place id was rewritten by
 * whichever request finished LAST — so a suggestion still on screen from the
 * newer search could point at nothing, and clicking it failed. Keying on the
 * suggestion OBJECT the caller renders makes each row resolvable for as long
 * as it exists, whatever else has completed since; a `WeakMap` keeps the
 * Google object out of the public shape and lets it go with the row.
 */
const predictionOf = new WeakMap<PlaceSuggestion, PlacePrediction>();

export async function searchPlaces(input: string): Promise<PlaceSuggestion[]> {
  const places = await (await loadGoogleMaps()).importLibrary('places');
  session ??= new places.AutocompleteSessionToken();

  const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: session,
    language: 'vi',
    region: 'vn',
  });

  return suggestions.flatMap(({ placePrediction }) => {
    if (!placePrediction) return [];
    const suggestion: PlaceSuggestion = {
      id: placePrediction.placeId,
      primary: placePrediction.mainText?.text ?? placePrediction.text.text,
      secondary: placePrediction.secondaryText?.text ?? '',
    };
    predictionOf.set(suggestion, placePrediction);
    return [suggestion];
  });
}

/**
 * The coordinates and address behind one suggestion, as `searchPlaces`
 * returned it. `toPlace()` on the prediction carries the session token into
 * the details fetch, which is what makes search-then-select one billable
 * session; the session ends here, and the next search starts a fresh one.
 */
export async function resolvePlace(suggestion: PlaceSuggestion): Promise<ResolvedPlace> {
  const prediction = predictionOf.get(suggestion);
  if (!prediction) throw new Error('That suggestion is no longer available. Search again.');

  const place = prediction.toPlace();
  await place.fetchFields({ fields: ['location', 'formattedAddress'] });
  session = null;

  const location = place.location;
  if (!location) throw new Error('That place has no coordinates.');

  return {
    address: place.formattedAddress ?? null,
    latitude: location.lat(),
    longitude: location.lng(),
  };
}
