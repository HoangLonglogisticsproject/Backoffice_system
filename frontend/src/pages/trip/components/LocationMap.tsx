import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLanguage } from '@/contexts/LanguageContext';
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
 * ★ OPENSTREETMAP, AND IT COSTS NOTHING. Leaflet is a library rather than a
 * service — no key, no quota, no per-load charge — and the tiles are OSM's.
 * This is the half of the old Google integration that was pure expense: every
 * time somebody opened this dialog was a billable map load. Searching is still
 * bought, because Vietnamese address data is worth buying; drawing a map is
 * not.
 *
 * ⚠ THE TILE SERVER IS SOMEBODY ELSE'S GOODWILL. OpenStreetMap's public tiles
 * are meant for modest use — a few dispatchers opening this a few times a day
 * is squarely that, a public-facing map on a busy site is not. If this ever
 * grows past the former, the fix is this one URL: MapTiler, Stadia and Carto
 * all serve the same tiles under a key, and self-hosting is a container.
 *
 * ★ THE ATTRIBUTION IS A LICENCE TERM, NOT DECORATION. OSM's data is ODbL;
 * naming the contributors is the condition of using it. Leaflet renders the
 * line from the option below, so it must not be dropped for looking untidy.
 *
 * ★ THE CIRCLE IS A PICTURE OF THE RULE, NOT THE RULE. It draws the radius the
 * server confirms a milestone within, so the operator can see whether the whole
 * yard sits inside it. The server's `MILESTONE_LOCATION_POLICY` is the only
 * thing that measures a driver; this figure is copied for display and would
 * drift silently if that policy ever became configurable — which is the moment
 * to serve it from the API instead.
 */
const MILESTONE_RADIUS_M = 300;

/** Where the map opens with no pin yet: the company's own region, not 0,0. */
const DEFAULT_CENTER: L.LatLngTuple = [10.78, 106.7];
const DEFAULT_ZOOM = 10;
const PINNED_ZOOM = 16;

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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

  // Read through refs from the listeners, so the map is built exactly once and
  // neither a new callback identity nor a moved pin rebuilds it.
  const onMoveRef = useRef(onMove);
  const pointRef = useRef(point);
  useEffect(() => {
    onMoveRef.current = onMove;
    pointRef.current = point;
  });

  useEffect(() => {
    if (!host.current) return undefined;

    try {
      const initial = pointRef.current;
      const center: L.LatLngTuple = initial
        ? [initial.latitude, initial.longitude]
        : DEFAULT_CENTER;

      const map = L.map(host.current, {
        center,
        zoom: initial ? PINNED_ZOOM : DEFAULT_ZOOM,
        // The operator is placing one pin, not exploring. Leaflet's zoom
        // buttons stay; there is nothing else worth the width.
        attributionControl: true,
      });
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);

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
  }, []);

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
      </div>
      {state === 'ready' ? (
        <p className="text-xs text-gray-500">
          {t(point ? 'locationRadiusNote' : 'locationMapNoPin')}
        </p>
      ) : null}
    </div>
  );
}
