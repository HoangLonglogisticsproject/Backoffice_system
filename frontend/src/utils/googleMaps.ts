/**
 * Google Maps Platform, for AUTHORING a place — and for nothing else.
 *
 * ★ THE ONLY FILE THAT KNOWS GOOGLE EXISTS. Everything else works with an
 * address and a pair of numbers. The Driver Portal never imports this: the
 * phone's own Geolocation API produces the reading, and the server's haversine
 * produces the verdict. Google here helps an operator find a warehouse, and the
 * coordinates that come back with the place they pick are what `trip_locations`
 * stores.
 *
 * ⚠ THE MAP HALF CURRENTLY HAS NO CALLER. `loadGoogleMaps` and the `maps` /
 * `marker` types below served `LocationMap`, the draggable-pin dialog, which was
 * removed with the location form's position section. Only `searchPlaces` and
 * `resolvePlace` are reached today. They are kept because restoring a pin is a
 * UI decision, not an adapter one — and because `importLibrary` is how this
 * file would load anything from Google again.
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

/**
 * One piece of a structured address, as Places (New) returns it.
 *
 * `longText` is the spelled-out name (`Thành phố Hồ Chí Minh`), `shortText` the
 * abbreviated one; `types` is what the piece IS, and a single component
 * routinely carries several.
 */
interface AddressComponent {
  longText: string | null | undefined;
  shortText: string | null | undefined;
  types: string[];
}

interface Place {
  location: LatLng | null | undefined;
  formattedAddress: string | null | undefined;
  addressComponents: AddressComponent[] | null | undefined;
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

/**
 * Vietnam's two administrative levels, as a place carries them.
 *
 * Every field is independently absent: Google says what it knows about the
 * place it was asked about, and for a warehouse on a provincial road that is
 * routinely the province and nothing else. `null` means GOOGLE DID NOT SAY —
 * never "this place has no ward" — which is why nothing downstream treats one
 * as an error and the form leaves all three editable.
 */
export interface AdminArea {
  /** Tỉnh / thành phố trực thuộc trung ương. */
  province: string | null;
  /** Phường / xã / đặc khu. */
  ward: string | null;
}

/** What a chosen place gives the form: the two numbers, and an address to offer. */
export interface ResolvedPlace extends AdminArea {
  address: string | null;
  latitude: number;
  longitude: number;
}

/**
 * ★ THE TYPES ARE TRIED IN ORDER, AND THE ORDER IS THE WHOLE OF THIS MAPPING.
 *
 * Google has no "ward" — it has a ladder of `administrative_area_level_N` plus
 * a `sublocality` family, and which rung a Vietnamese ward lands on depends on
 * the place. A commune outside a city usually comes back as
 * `administrative_area_level_3`; a ward inside one is frequently only a
 * `sublocality_level_1`. Taking the first type that is present, in this order,
 * gets the specific answer where there is one and the general answer where
 * there is not.
 *
 * ⚠ AND THE WARD IS A HINT, NOT AN ANSWER. Vietnam merged and renamed its
 * communes wholesale in 2025, and Google's data for a given place often still
 * names the unit that existed before. The location form therefore does NOT
 * auto-select a ward from this — it offers the official list instead. What is
 * here is kept because the PROVINCE survives the reform intact and is worth
 * pre-selecting, and because a hint is cheap when nothing depends on it.
 */
const ADMIN_AREA_TYPES: Record<keyof AdminArea, readonly string[]> = {
  province: ['administrative_area_level_1'],
  ward: ['administrative_area_level_3', 'sublocality_level_1', 'sublocality'],
};

const adminAreaOf = (components: AddressComponent[] | null | undefined): AdminArea => {
  const pick = (types: readonly string[]): string | null => {
    for (const type of types) {
      const match = components?.find((component) => component.types.includes(type));
      // The spelled-out form: `Thành phố Hồ Chí Minh`, not `HCM`. This is read
      // by a person on a list, and the short form saves nothing worth the
      // ambiguity.
      const text = match?.longText ?? match?.shortText ?? null;
      if (text) return text;
    }
    return null;
  };

  return {
    province: pick(ADMIN_AREA_TYPES.province),
    ward: pick(ADMIN_AREA_TYPES.ward),
  };
};

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
  // ★ ALL THREE IN ONE FETCH, NOT A SECOND CALL. The session token makes
  // search-then-select ONE billable session; asking for the components
  // separately afterwards would start a second one for the same place.
  await place.fetchFields({ fields: ['location', 'formattedAddress', 'addressComponents'] });
  session = null;

  const location = place.location;
  if (!location) throw new Error('That place has no coordinates.');

  return {
    address: place.formattedAddress ?? null,
    latitude: location.lat(),
    longitude: location.lng(),
    ...adminAreaOf(place.addressComponents),
  };
}
