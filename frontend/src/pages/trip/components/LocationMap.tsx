import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  loadGoogleMaps,
  type Coordinates,
  type GoogleCircle,
  type GoogleMap,
  type GoogleMarker,
} from '@/utils/googleMaps';

/**
 * A map with one pin on it, for the operator to put where the lorry must go.
 *
 * ★ THE PIN IS THE ANSWER, NOT THE SEARCH RESULT. Google returns the centre
 * of a warehouse's parcel; the driver has to reach its gate. So the pin is
 * draggable, a click on the map moves it, and whatever the operator leaves it
 * on is what the form saves. Nothing here decides anything: `onMove` hands
 * the pair up and the form owns the numbers.
 *
 * ★ THE CIRCLE IS A PICTURE OF THE RULE, NOT THE RULE. It draws the radius the
 * server confirms a milestone within, so the operator can see whether the
 * whole yard sits inside it. The server's `MILESTONE_LOCATION_POLICY` is the
 * only thing that measures a driver; this figure is copied for display and
 * would drift silently if that policy ever became configurable — which is the
 * moment to serve it from the API instead.
 */
const MILESTONE_RADIUS_M = 300;

/** Where the map opens with no pin yet: the company's own region, not 0,0. */
const DEFAULT_CENTER = { lat: 10.78, lng: 106.7 };
const DEFAULT_ZOOM = 10;
const PINNED_ZOOM = 16;

interface Props {
  point: Coordinates | null;
  onMove: (point: Coordinates) => void;
}

export function LocationMap({ point, onMove }: Readonly<Props>) {
  const { t } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const objects = useRef<{ map: GoogleMap; marker: GoogleMarker; circle: GoogleCircle } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  // Read through refs from the listeners, so the map is built exactly once
  // and neither a new callback identity nor a moved pin rebuilds it.
  const onMoveRef = useRef(onMove);
  const pointRef = useRef(point);
  useEffect(() => {
    onMoveRef.current = onMove;
    pointRef.current = point;
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const api = await loadGoogleMaps();
      const [{ Map: GoogleMapCtor, Circle }, { Marker }] = await Promise.all([
        api.importLibrary('maps'),
        api.importLibrary('marker'),
      ]);
      if (cancelled || !host.current) return;

      const initial = pointRef.current;
      const center = initial ? { lat: initial.latitude, lng: initial.longitude } : DEFAULT_CENTER;
      const map = new GoogleMapCtor(host.current, {
        center,
        zoom: initial ? PINNED_ZOOM : DEFAULT_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        // Business pins on the base map would otherwise open Google's own
        // info cards on click, over the operator's pin.
        clickableIcons: false,
      });
      const marker = new Marker({ map: initial ? map : null, position: center, draggable: true });
      const circle = new Circle({
        map: initial ? map : null,
        center,
        radius: MILESTONE_RADIUS_M,
        strokeColor: '#2563eb',
        strokeOpacity: 0.7,
        strokeWeight: 1.5,
        fillColor: '#2563eb',
        fillOpacity: 0.08,
        clickable: false,
      });

      marker.addListener('dragend', () => {
        const position = marker.getPosition();
        if (position) onMoveRef.current({ latitude: position.lat(), longitude: position.lng() });
      });
      map.addListener('click', ({ latLng }) => {
        if (latLng) onMoveRef.current({ latitude: latLng.lat(), longitude: latLng.lng() });
      });

      objects.current = { map, marker, circle };
      setState('ready');
    })().catch(() => {
      if (!cancelled) setState('failed');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // The pin follows the form's numbers — typed, searched or dragged alike.
  const latitude = point?.latitude ?? null;
  const longitude = point?.longitude ?? null;
  useEffect(() => {
    const built = objects.current;
    if (!built || state !== 'ready') return;

    if (latitude === null || longitude === null) {
      built.marker.setMap(null);
      built.circle.setMap(null);
      return;
    }
    const position = { lat: latitude, lng: longitude };
    built.marker.setMap(built.map);
    built.circle.setMap(built.map);
    built.marker.setPosition(position);
    built.circle.setCenter(position);
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
        <p className="text-xs text-gray-500">{t(point ? 'locationRadiusNote' : 'locationMapNoPin')}</p>
      ) : null}
    </div>
  );
}
