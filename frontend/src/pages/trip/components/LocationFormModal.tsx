import { useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { createTripLocation, updateTripLocation } from '@/api/tripCatalogue';
import { isApiError } from '@/utils/errors';
import {
  isMapsConfigured,
  resolvePlace,
  searchPlaces,
  type Coordinates,
  type PlaceSuggestion,
} from '@/utils/googleMaps';
import type { TripLocation } from '@/types/trip';
import { LocationMap } from './LocationMap';

/**
 * One of a customer's places, entered or corrected.
 *
 * ★ ALWAYS UNDER ONE CUSTOMER. The dialog is opened with the customer it
 * belongs to and creates under that id; there is no customer picker here, so
 * a place cannot be filed under the wrong company by a slip.
 *
 * ★ THE OPERATOR FINDS THE PLACE; THE PIN IS THE TRUTH. With a map configured,
 * the operator searches for the warehouse, gets a pin, and drags it to the
 * gate the lorry actually reaches. The two numbers under the map are what is
 * saved — the same two columns the form has always written, so the trip
 * snapshot, the driver's read model and the server's geofence see nothing
 * new. Without a map (no key in this deployment) the numbers are typed by
 * hand, exactly as before.
 *
 * ★ COORDINATES ARE OPTIONAL, AND SAID SO. A place is real before anybody has
 * located it. The dialog says "not located" plainly and never invents a point.
 *
 * ★ THE ADDRESS IS THE OPERATOR'S. A chosen search result fills it only while
 * it is empty or still reads exactly what the last result filled in; a hand-
 * written address is never overwritten, and moving the pin never touches it.
 */
interface Props {
  customerId: string;
  /** `null` to add; a row to correct. */
  editing: TripLocation | null;
  onClose: () => void;
  onSaved: (location: TripLocation) => void | Promise<void>;
}

const numberField = (value: number | null): string => (value === null ? '' : String(value));
const numberOrNull = (value: string): number | null =>
  value.trim() === '' ? null : Number(value);

/**
 * Six decimals is ~11 cm — finer than any GPS and coarse enough that a dragged
 * pin does not leave fifteen digits in the field.
 */
const roundCoordinate = (value: number): string => String(Math.round(value * 1e6) / 1e6);

/**
 * What is wrong with the pair as typed, if anything. The server refuses the
 * same two things with a 422; this stops the request being sent at all.
 * `Number('')` is 0, so emptiness is checked on the text, never on the number.
 */
type PairProblem = 'incomplete' | 'invalid' | null;

const pairProblem = (latitude: string, longitude: string): PairProblem => {
  const hasLat = latitude.trim() !== '';
  const hasLng = longitude.trim() !== '';
  if (hasLat !== hasLng) return 'incomplete';
  if (!hasLat) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  const onEarth =
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  return onEarth ? null : 'invalid';
};

/** The pair as a point, only when it is a whole, valid one. */
const pointOf = (latitude: string, longitude: string): Coordinates | null =>
  pairProblem(latitude, longitude) === null && latitude.trim() !== ''
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null;

/** Below this the API returns noise; above it a debounce keeps one request per pause. */
const SEARCH_MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 350;

export function LocationFormModal({ customerId, editing, onClose, onSaved }: Readonly<Props>) {
  const { t } = useLanguage();
  const [name, setName] = useState(editing?.name ?? '');
  const [address, setAddress] = useState(editing?.address ?? '');
  const [contact, setContact] = useState(editing?.contact ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [latitude, setLatitude] = useState(numberField(editing?.latitude ?? null));
  const [longitude, setLongitude] = useState(numberField(editing?.longitude ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapEnabled = isMapsConfigured();
  const problem = pairProblem(latitude, longitude);
  const point = pointOf(latitude, longitude);
  const located = point !== null;

  const setPoint = ({ latitude: lat, longitude: lng }: Coordinates) => {
    setLatitude(roundCoordinate(lat));
    setLongitude(roundCoordinate(lng));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem !== null) return;
    setBusy(true);
    setError(null);

    const blank = (value: string) => (value.trim() === '' ? null : value.trim());
    const body = {
      name: name.trim(),
      address: address.trim(),
      contact: blank(contact),
      note: blank(note),
      latitude: numberOrNull(latitude),
      longitude: numberOrNull(longitude),
    };

    try {
      const saved = editing
        ? await updateTripLocation(customerId, editing.id, body)
        : await createTripLocation(customerId, body);
      await onSaved(saved);
      onClose();
    } catch (error_) {
      // The server refuses half a point, a duplicate name and a retired
      // customer with a sentence; that sentence is the honest one.
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'location-form';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(editing ? 'editLocation' : 'addLocation')}
      className={mapEnabled ? 'max-w-2xl' : undefined}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || problem !== null}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Field id="location-name" label={t('locationName')} value={name} onChange={setName} required />

        {mapEnabled ? (
          <PlaceSearch
            onPick={(place) => {
              setPoint(place);
              if (place.address) setAddress(place.address);
            }}
            addressIsEditable={(filled) => address.trim() === '' || address === filled}
          />
        ) : null}

        <div className="space-y-2">
          <label htmlFor="location-address" className="text-sm font-medium text-gray-700">
            {t('locationAddress')}
          </label>
          <textarea
            id="location-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            rows={3}
            required
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <Field id="location-contact" label={t('locationContact')} value={contact} onChange={setContact} />
        <Field id="location-note" label={t('noteOptional')} value={note} onChange={setNote} />

        <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-700">
            {t('locationCoordinates')}{' '}
            <span className={located ? 'text-green-700' : 'text-amber-700'}>
              — {t(located ? 'locationLocated' : 'locationUnlocated')}
            </span>
          </legend>
          <p className="text-xs text-gray-500">{t(mapEnabled ? 'locationPinHint' : 'locationCoordinatesHint')}</p>

          {mapEnabled ? <LocationMap point={point} onMove={setPoint} /> : null}

          <div className="grid grid-cols-2 gap-2">
            <Input
              id="location-latitude"
              type="number"
              inputMode="decimal"
              step="any"
              min={-90}
              max={90}
              placeholder={t('fieldLatitude')}
              aria-label={t('fieldLatitude')}
              aria-invalid={problem !== null || undefined}
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
            />
            <Input
              id="location-longitude"
              type="number"
              inputMode="decimal"
              step="any"
              min={-180}
              max={180}
              placeholder={t('fieldLongitude')}
              aria-label={t('fieldLongitude')}
              aria-invalid={problem !== null || undefined}
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </div>
          {problem ? (
            <p role="alert" className="text-xs text-red-600">
              {t(problem === 'incomplete' ? 'locationPairIncomplete' : 'locationPairInvalid')}
            </p>
          ) : null}
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/**
 * The search box and its results. Debounced, one request per pause, and the
 * chosen result is fetched once — the adapter's session token makes the pair
 * one billable session.
 *
 * ponytail: a list of buttons under an input, not a full ARIA combobox. Tab
 * reaches every result and Enter picks it; add roving arrow keys the day
 * somebody asks for them.
 */
function PlaceSearch({
  onPick,
  addressIsEditable,
}: Readonly<{
  onPick: (place: { address: string | null } & Coordinates) => void;
  /** Whether the address field may be overwritten, given what this box last filled in. */
  addressIsEditable: (lastFilled: string | null) => boolean;
}>) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'failed'>('idle');
  // What the last pick wrote into the address, so a later pick may replace
  // it — and a hand-edited address is left alone.
  const lastFilled = useRef<string | null>(null);
  // Only the newest search may publish results; an older one that resolves
  // late must not overwrite them.
  const latest = useRef(0);

  useEffect(() => {
    const input = query.trim();
    if (input.length < SEARCH_MIN_CHARS) {
      setResults(null);
      setState('idle');
      return;
    }
    const ticket = ++latest.current;
    const timer = window.setTimeout(() => {
      setState('searching');
      searchPlaces(input)
        .then((found) => {
          if (ticket !== latest.current) return;
          setResults(found);
          setState('idle');
        })
        .catch(() => {
          if (ticket !== latest.current) return;
          setResults(null);
          setState('failed');
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const pick = async (suggestion: PlaceSuggestion) => {
    latest.current++;
    setResults(null);
    setState('searching');
    try {
      const place = await resolvePlace(suggestion.id);
      const address = addressIsEditable(lastFilled.current) ? place.address : null;
      if (address) lastFilled.current = address;
      onPick({ ...place, address });
      setQuery(suggestion.primary);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor="location-search" className="text-sm font-medium text-gray-700">
        {t('locationSearch')}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-gray-400" aria-hidden />
        <Input
          id="location-search"
          type="search"
          autoComplete="off"
          className="pl-8"
          placeholder={t('locationSearchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {state === 'searching' ? <p className="text-xs text-gray-500">{t('locationSearching')}</p> : null}
      {state === 'failed' ? (
        <p role="alert" className="text-xs text-red-600">
          {t('locationSearchFailed')}
        </p>
      ) : null}
      {results && results.length === 0 ? (
        <p className="text-xs text-gray-500">{t('locationNoResults')}</p>
      ) : null}
      {results && results.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" aria-label={t('locationSearch')}>
          {results.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                onClick={() => void pick(suggestion)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900">{suggestion.primary}</span>
                  {suggestion.secondary ? (
                    <span className="block text-xs text-gray-500">{suggestion.secondary}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  required = false,
}: Readonly<{ id: string; label: string; value: string; onChange: (value: string) => void; required?: boolean }>) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </div>
  );
}
