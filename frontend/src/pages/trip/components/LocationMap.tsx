import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchTileStyle, TILE_URL_TEMPLATE, type TileStyle } from '@/api/mapTiles';
// The same `{ latitude, longitude }` the driver portal reports and the server
// stores — one definition, so the pair the operator places and the pair the
// geofence measures against can never drift into two shapes.
import type { Coordinates } from '@/types/driver';

/**
 * A map with one pin on it, for the operator to put where the lorry must go.
 *
 * ★ THE PIN IS THE ANSWER, NOT THE SEARCH RESULT. A geocoder returns the centre
 * of a warehouse's parcel; the driver has to reach its gate. Cảng Cát Lái is
 * about 160 ha and 1.3 km across, so its centre can be the better part of a
 * kilometre from the gate a lorry actually queues at — well outside the 300 m
 * the server confirms within. So the pin is draggable, a click on the map moves
 * it, and whatever the operator leaves it on is what the form saves. Nothing
 * here decides anything: `onMove` hands the pair up and the form owns them.
 *
 * ★ THE TILES COME FROM OUR OWN API, AND THAT IS A REPAIR, NOT A PREFERENCE.
 * This used to name `tile.openstreetmap.org` directly, and in production the
 * map went grey: Leaflet initialised perfectly — zoom controls, the circle and
 * the pin all drew — and only the tile images never arrived. The bundle was
 * correct, this stylesheet was correct, and there was no Content-Security-Policy
 * anywhere; the browser simply could not complete the request, while the same
 * URL from a developer's machine returned a 38 KB tile.
 *
 * Which network did it is the wrong question — an ISP, a captive network and a
 * tile server declining an office's shared egress address all look identical
 * from here and are all outside this codebase. What is inside it is the choice
 * of WHO fetches: the page already talks to its own origin for everything else,
 * and a tile arriving on that same connection cannot be blocked separately from
 * the application around it. The server fetches the real tile and caches it,
 * which is the shape `placeSearch.ts` already uses next door — there to keep a
 * key off the page, here to keep the map reachable.
 *
 * ★ STILL OPENSTREETMAP BY DEFAULT, AND STILL FREE. Moving the fetch was the
 * whole fix; the backend reaches OSM fine. `MAP_TILES_URL`/`MAP_TILES_KEY` on
 * the server upgrade to a provider that sells tiles without touching this file.
 *
 * ★ THE ATTRIBUTION IS A LICENCE TERM, AND IT IS SERVED, NOT WRITTEN HERE.
 * OSM's data is ODbL; naming the contributors is the condition of using it, and
 * a paid provider imposes its own line. Because the provider is now a
 * server-side setting, a copy of that line compiled into this bundle would keep
 * crediting OpenStreetMap on the day a deployment started paying somebody else.
 * `/tiles/meta` answers with the right one.
 *
 * ★ THE CIRCLE IS A PICTURE OF THE RULE, NOT THE RULE. It draws the radius the
 * server confirms a milestone within, so the operator can see whether the whole
 * yard sits inside it. The server's `MILESTONE_LOCATION_POLICY` is the only
 * thing that measures a driver; this figure is copied for display and would
 * drift silently if that policy ever became configurable — which is the moment
 * to serve it from the API instead, exactly as the attribution above now is.
 */
const MILESTONE_RADIUS_M = 300;

/** Where the map opens with no pin yet: the company's own region, not 0,0. */
const DEFAULT_CENTER: L.LatLngTuple = [10.78, 106.7];
const DEFAULT_ZOOM = 10;
const PINNED_ZOOM = 16;

/**
 * What to draw with when `/tiles/meta` cannot be reached.
 *
 * ★ A MISSING CAPTION MUST NOT BECOME A MISSING MAP. The tiles are separate
 * requests from this one, so they can be perfectly fine while this fails —
 * refusing to build the map because the credit line did not arrive would turn a
 * small problem into the exact symptom this whole change exists to remove.
 * These values are the server's own defaults, so the common case of a failure
 * here is that they are also correct.
 */
const FALLBACK_STYLE: TileStyle = {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
};

/**
 * How many tiles may fail before the map admits it.
 *
 * ★ BECAUSE THE OLD FAILURE WAS COMPLETELY SILENT. `state` only ever became
 * `'failed'` if `L.map()` threw synchronously, which is the one thing that did
 * not happen in production: construction succeeded and every image after it
 * died, leaving a grey square, no message, and nothing in front of the operator
 * to act on. Leaflet does report this per tile — nobody was listening.
 *
 * Four rather than one, because a single `tileerror` is ordinary: a provider
 * genuinely has no square for some corners of the world, and a flaky connection
 * drops one and retrieves it on the next pan. Four consecutive failures with
 * NOTHING having loaded is not a gap in the map, it is the absence of a map.
 */
const FAILED_TILES_BEFORE_GIVING_UP = 4;

/**
 * ★ A DIV, NOT LEAFLET'S OWN MARKER IMAGE, AND THIS IS THE CLASSIC TRAP.
 * `L.Marker`'s default icon resolves `marker-icon.png` relative to the CSS,
 * which a bundler rewrites and hashes — the marker then 404s and the pin is
 * invisible, on the one control the whole dialog exists for. A `divIcon` is
 * markup we own, so there is no asset to lose.
 *
 * Sized and anchored so the POINT of the pin is the coordinate, not its
 * middle: `iconAnchor` sits at the bottom centre of the box.
 */
const PIN = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

interface Props {
  point: Coordinates | null;
  onMove: (point: Coordinates) => void;
}

export function LocationMap({ point, onMove }: Readonly<Props>) {
  const { t } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const objects = useRef<{ map: L.Map; marker: L.Marker; circle: L.Circle } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  /**
   * ★ TRACKED SEPARATELY FROM `state`, BECAUSE A MAP THAT CANNOT DRAW IS NOT A
   * MAP THAT WAS NEVER BUILT. The pin, the circle and the zoom controls are all
   * still there and still work — the operator can drag a pin they searched for,
   * and the radius note below is still true. Folding this into `state` would
   * take all of that away to report a narrower problem than it is.
   */
  const [tilesFailed, setTilesFailed] = useState(false);

  /** `null` until `/tiles/meta` answers or gives up; the map waits for it. */
  const [style, setStyle] = useState<TileStyle | null>(null);

  // Read through refs from the listeners, so the map is built exactly once and
  // neither a new callback identity nor a moved pin rebuilds it.
  const onMoveRef = useRef(onMove);
  const pointRef = useRef(point);
  useEffect(() => {
    onMoveRef.current = onMove;
    pointRef.current = point;
  });

  useEffect(() => {
    let alive = true;

    fetchTileStyle()
      .then((answer) => {
        if (alive) setStyle(answer);
      })
      .catch(() => {
        // Not surfaced: the map is about to be built either way, and the
        // fallback is the server's own default.
        if (alive) setStyle(FALLBACK_STYLE);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // `style` settles exactly once, so this builds the map exactly once — the
    // same guarantee the empty dependency array used to give.
    if (!style || !host.current) return undefined;

    try {
      const initial = pointRef.current;
      const center: L.LatLngTuple = initial
        ? [initial.latitude, initial.longitude]
        : DEFAULT_CENTER;

      const map = L.map(host.current, {
        center,
        // Clamped, because a provider configured with less coverage than our
        // pinned zoom would open on a level it has no imagery for — a grey
        // square again, from the opposite direction.
        zoom: initial ? Math.min(PINNED_ZOOM, style.maxZoom) : DEFAULT_ZOOM,
        // The operator is placing one pin, not exploring. Leaflet's zoom
        // buttons stay; there is nothing else worth the width.
        attributionControl: true,
      });

      const tiles = L.tileLayer(TILE_URL_TEMPLATE, {
        attribution: style.attribution,
        maxZoom: style.maxZoom,
      });

      /**
       * ★ COUNTED IN CLOSURE VARIABLES, NOT STATE. These fire once per tile —
       * twenty-odd times on open and again on every pan — and routing each
       * through a re-render would be a lot of work to answer one yes/no
       * question. Only the answer becomes state, and only once.
       */
      let loaded = 0;
      let failed = 0;
      tiles.on('tileload', () => {
        loaded += 1;
      });
      tiles.on('tileerror', () => {
        failed += 1;
        if (loaded === 0 && failed >= FAILED_TILES_BEFORE_GIVING_UP) setTilesFailed(true);
      });
      tiles.addTo(map);

      const marker = L.marker(center, { draggable: true, icon: PIN, keyboard: true });
      const circle = L.circle(center, {
        radius: MILESTONE_RADIUS_M,
        color: '#2563eb',
        opacity: 0.7,
        weight: 1.5,
        fillColor: '#2563eb',
        fillOpacity: 0.08,
        // A click meant for the map must not be swallowed by the circle drawn
        // over it — moving the pin is the whole interaction.
        interactive: false,
      });
      if (initial) {
        marker.addTo(map);
        circle.addTo(map);
      }

      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        onMoveRef.current({ latitude: lat, longitude: lng });
      });
      map.on('click', (event: L.LeafletMouseEvent) => {
        onMoveRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
      });

      objects.current = { map, marker, circle };
      setState('ready');

      return () => {
        // ★ `remove()`, NOT JUST DROPPING THE REF. Leaflet attaches listeners to
        // the window and keeps a handle on the container; without this, closing
        // and reopening the dialog throws "Map container is already initialized"
        // on the same div.
        map.remove();
        objects.current = null;
      };
    } catch {
      setState('failed');
      return undefined;
    }
  }, [style]);

  // The pin follows the form's numbers — typed, searched or dragged alike.
  const latitude = point?.latitude ?? null;
  const longitude = point?.longitude ?? null;
  useEffect(() => {
    const built = objects.current;
    if (!built || state !== 'ready') return;

    if (latitude === null || longitude === null) {
      built.marker.remove();
      built.circle.remove();
      return;
    }
    const position: L.LatLngTuple = [latitude, longitude];
    built.marker.addTo(built.map);
    built.circle.addTo(built.map);
    built.marker.setLatLng(position);
    built.circle.setLatLng(position);
    built.map.panTo(position);
  }, [latitude, longitude, state]);

  return (
    <div className="space-y-1.5">
      <div className="relative h-64 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
        <div ref={host} className="size-full" aria-label={t('locationCoordinates')} />
        {state !== 'ready' ? (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-gray-500">
            {t(state === 'failed' ? 'locationMapFailed' : 'locationMapLoading')}
          </p>
        ) : null}
        {/* ★ `pointer-events-none`, AND IT IS LOAD-BEARING. This sits ON TOP of
            a live map: the pin can still be dragged and the zoom buttons still
            work with no tiles behind them, and a banner that swallowed those
            clicks would take away the only thing still usable. `z-[500]` clears
            Leaflet's own panes, which start at 400. */}
        {state === 'ready' && tilesFailed ? (
          <p className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-amber-50/95 px-3 py-2 text-center text-xs text-amber-900">
            {t('locationMapFailed')}
          </p>
        ) : null}
      </div>
      {state === 'ready' ? (
        <p className="text-xs text-gray-500">
          {t(point ? 'locationRadiusNote' : 'locationMapNoPin')}
        </p>
      ) : null}
    </div>
  );
}
