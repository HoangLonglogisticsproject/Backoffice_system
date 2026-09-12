import { useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  createSharedTripLocation,
  createTripLocation,
  updateTripLocationById,
} from '@/api/tripCatalogue';
import { isApiError } from '@/utils/errors';
import {
  isMapsConfigured,
  resolvePlace,
  searchPlaces,
  type Coordinates,
  type PlaceSuggestion,
  type ResolvedPlace,
} from '@/utils/googleMaps';
import {
  AdminAreaFields,
  EMPTY_ADMIN_AREA,
  type AdminAreaValue,
} from '@/components/trip/AdminAreaFields';
import type { TripLocation } from '@/types/trip';

/**
 * One place, entered or corrected.
 *
 * ★ THE CUSTOMER IS DECIDED BY WHOEVER OPENED THIS, NEVER PICKED HERE. Opened
 * from a customer's row it creates under that id; opened from the locations
 * catalogue it is passed `null` and creates a SHARED place. Either way there is
 * no customer picker on the form, so a place cannot be filed under the wrong
 * company by a slip — and the dialog never has to ask a question whose answer
 * the screen behind it already knows.
 *
 * ★ THE ADMINISTRATIVE THREE ARE TEXT, AND OPTIONAL. Tỉnh/thành, quận/huyện,
 * phường/xã: filled from the address components of the place the operator
 * picks, corrected by hand, and blank whenever nobody has said. They describe
 * the row for a reader; nothing operational reads them.
 *
 * ★ THE OPERATOR NEVER TYPES A COORDINATE. A place has a name, an address and
 * a POSITION; the position is set by finding the place on a map and putting a
 * pin on its gate — "Thiết lập vị trí" — and confirmed as a whole. The two
 * numbers that come out of that are what `trip_locations` has always stored,
 * so the trip snapshot, the driver read model and the server's geofence see
 * nothing new. They stay reachable behind an "advanced" fold for the rare
 * case somebody was handed coordinates, and are the ONLY input when this
 * deployment has no map key — then the dialog says so in plain words.
 *
 * ★ COORDINATES ARE OPTIONAL, AND SAID SO. A place is real before anybody has
 * located it. The dialog says "not located" plainly and never invents a point.
 *
 * ★ THE ADDRESS IS THE OPERATOR'S. A place found on the map fills it only
 * while it is empty or still reads exactly what the last find filled in; a
 * hand-written address is never overwritten, and moving the pin never
 * touches it.
 */
interface Props {
  /** Whose place this will be. `null` creates a SHARED one. */
  customerId: string | null;
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

/** Below this the API returns noise; above it a debounce keeps one request per pause. */
const SEARCH_MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 350;

/** `''` → `null` for the optional texts; the required ones are only trimmed. */
const blank = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** What the form sends. */
interface LocationBody {
  name: string;
  address: string;
  contact: string | null;
  note: string | null;
  provinceCode: string | null;
  province: string | null;
  districtCode: string | null;
  district: string | null;
  wardCode: string | null;
  ward: string | null;
  latitude: number | null;
  longitude: number | null;
}

const locationBody = (fields: {
  name: string;
  address: string;
  contact: string;
  note: string;
  area: AdminAreaValue;
  latitude: string;
  longitude: string;
}): LocationBody => ({
  name: fields.name.trim(),
  address: fields.address.trim(),
  contact: blank(fields.contact),
  note: blank(fields.note),
  ...fields.area,
  latitude: numberOrNull(fields.latitude),
  longitude: numberOrNull(fields.longitude),
});

/**
 * Four destinations, chosen by two questions: is there a row already, and does
 * it belong to a customer.
 *
 * ★ AN EDIT GOES BY ID WHATEVER OPENED IT. The catalogue screen edits rows it
 * does not necessarily have a customer for, and the per-customer dialog gains
 * nothing from restating one it already proved. A CREATE still needs to say
 * which population it is joining, and that is what `customerId` decides.
 */
const saveLocation = (
  customerId: string | null,
  editing: TripLocation | null,
  body: LocationBody,
): Promise<TripLocation> => {
  if (editing) return updateTripLocationById(editing.id, body);
  return customerId === null
    ? createSharedTripLocation(body)
    : createTripLocation(customerId, body);
};

/**
 * The server refuses half a point, a duplicate name and a retired customer
 * with a sentence; that sentence is the honest one. Anything else gets the
 * generic line.
 */
const failureMessage = (error: unknown, fallback: string): string =>
  isApiError(error) ? error.message : fallback;

export function LocationFormModal({ customerId, editing, onClose, onSaved }: Readonly<Props>) {
  const { t } = useLanguage();
  const [name, setName] = useState(editing?.name ?? '');
  const [address, setAddress] = useState(editing?.address ?? '');
  /**
   * ★ READ, NEVER WRITTEN — the two fields this dialog stopped ASKING for.
   * They are still sent, so correcting a place does not silently blank the
   * contact and the note it already had. Restore the inputs below to edit them.
   */
  const [contact] = useState(editing?.contact ?? '');
  const [note] = useState(editing?.note ?? '');
  const [area, setArea] = useState<AdminAreaValue>(
    editing
      ? {
          provinceCode: editing.provinceCode,
          province: editing.province,
          districtCode: editing.districtCode,
          district: editing.district,
          wardCode: editing.wardCode,
          ward: editing.ward,
        }
      : EMPTY_ADMIN_AREA,
  );
  const [latitude, setLatitude] = useState(numberField(editing?.latitude ?? null));
  const [longitude, setLongitude] = useState(numberField(editing?.longitude ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapEnabled = isMapsConfigured();
  const problem = pairProblem(latitude, longitude);

  const setPoint = ({ latitude: lat, longitude: lng }: Coordinates) => {
    setLatitude(roundCoordinate(lat));
    setLongitude(roundCoordinate(lng));
  };

  // What the last found place wrote into the address, so a later find may
  // replace it — and an address the operator wrote is left alone.
  const lastFilled = useRef<string | null>(null);

  /**
   * ★ THE NORMAL PATH: a suggestion picked IN THE ADDRESS FIELD. The operator
   * was writing the address; the row they chose IS the address, so it is
   * taken as written by the place, and its position comes with it — no map,
   * no numbers, nothing further to do. Remembered as this dialog's own fill,
   * so a later map confirm may still replace it under the rule above.
   */
  const addressPicked = (place: ResolvedPlace, text: string) => {
    lastFilled.current = text;
    setAddress(text);
    setPoint(place);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem !== null) return;
    setBusy(true);
    setError(null);

    try {
      const saved = await saveLocation(
        customerId,
        editing,
        locationBody({
          name,
          address,
          contact,
          note,
          area,
          latitude,
          longitude,
        }),
      );
      await onSaved(saved);
      onClose();
    } catch (error_) {
      setError(failureMessage(error_, t('saveFailed')));
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
          // The address field IS the search: suggestions as the operator
          // types, and a pick settles the position underneath.
          <PlaceSearch
            id="location-address"
            label={t('locationAddress')}
            value={address}
            onChange={setAddress}
            onPick={addressPicked}
            multiline
            required
            hint={t('locationAddressHint')}
          />
        ) : (
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
              className={TEXTAREA_CLASS}
            />
          </div>
        )}
        {/*
          ★ TWO DROPDOWNS, BECAUSE VIETNAM HAS TWO LEVELS. Tỉnh/thành → xã/phường,
          served from our own API (which proxies and caches the public source).
          The quận/huyện tier was abolished on 1 July 2025, so there is no third
          control and nothing that could fill one.
        */}
        <AdminAreaFields value={area} onChange={setArea} />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

const TEXTAREA_CLASS =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * A text field with place suggestions under it. Debounced, one request per
 * pause, and the chosen result is fetched once — the adapter's session token
 * makes the pair one billable session.
 *
 * ★ CONTROLLED, SO THE ADDRESS FIELD CAN BE ONE. The caller owns the text;
 * this only searches it and reports a pick. Two texts are never searched:
 * the one the field opened with — an existing place's address is not a
 * query — and the one a pick just wrote, or every pick would search itself.
 *
 * ponytail: a list of buttons under the field, not a full ARIA combobox. Tab
 * reaches every result and Enter picks it; add roving arrow keys the day
 * somebody asks for them.
 */
function PlaceSearch({
  id,
  label,
  value,
  onChange,
  onPick,
  multiline = false,
  required = false,
  placeholder,
  hint,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** A suggestion resolved: the place, and the text the field should now read. */
  onPick: (place: ResolvedPlace, text: string) => void;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}>) {
  const { t } = useLanguage();
  const [results, setResults] = useState<PlaceSuggestion[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'failed'>('idle');
  // Only the newest request may publish results; an older one that resolves
  // late must not overwrite them. Every change of intent takes a new ticket.
  const latest = useRef(0);
  // The text that is not a query: what the field opened with, then what the
  // last pick wrote.
  const settled = useRef(value);

  useEffect(() => {
    const input = value.trim();
    if (input.length < SEARCH_MIN_CHARS || value === settled.current) {
      // ★ THE IN-FLIGHT SEARCH IS RETIRED TOO. Clearing the timer only stops
      // a search that has not started; one already on the wire would come
      // back and repopulate a list the operator had just emptied.
      latest.current += 1;
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
  }, [value]);

  const pick = async (suggestion: PlaceSuggestion) => {
    latest.current++;
    setResults(null);
    setState('searching');
    try {
      // The row itself, not its id: the adapter resolves the prediction that
      // produced THIS row, whatever other search has finished since.
      const place = await resolvePlace(suggestion);
      const text = place.address ?? suggestion.primary;
      settled.current = text;
      onPick(place, text);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  // What is on screen: rows from the newest search, and whether one has run.
  const visible = results ?? [];
  const searched = results !== null;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          required={required}
          autoComplete="off"
          className={TEXTAREA_CLASS}
        />
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-gray-400" aria-hidden />
          <Input
            id={id}
            type="search"
            autoComplete="off"
            className="pl-8"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )}
      {hint ? <p className="text-xs text-gray-500">{hint}</p> : null}

      {state === 'searching' ? <p className="text-xs text-gray-500">{t('locationSearching')}</p> : null}
      {state === 'failed' ? <p className="text-xs text-amber-700">{t('locationSearchFailed')}</p> : null}
      {state === 'idle' && searched && visible.length === 0 ? (
        <p className="text-xs text-gray-500">{t('locationNoResults')}</p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {visible.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-blue-50/50"
                onClick={() => void pick(suggestion)}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-gray-900">{suggestion.primary}</span>
                  {suggestion.secondary ? (
                    <span className="block truncate text-xs text-gray-500">{suggestion.secondary}</span>
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

/** One labelled text input. The form's plainest field. */
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
