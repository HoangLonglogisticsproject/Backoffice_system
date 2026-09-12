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
import { LocationMap } from './LocationMap';

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

/** The pair as a point, only when it is a whole, valid one. */
const pointOf = (latitude: string, longitude: string): Coordinates | null =>
  pairProblem(latitude, longitude) === null && latitude.trim() !== ''
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null;

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
  /** The map dialog, open on top of this one. */
  const [setupOpen, setSetupOpen] = useState(false);

  const mapEnabled = isMapsConfigured();
  const problem = pairProblem(latitude, longitude);
  const point = pointOf(latitude, longitude);

  const setPoint = ({ latitude: lat, longitude: lng }: Coordinates) => {
    setLatitude(roundCoordinate(lat));
    setLongitude(roundCoordinate(lng));
  };

  // What the last found place wrote into the address, so a later find may
  // replace it — and an address the operator wrote is left alone.
  const lastFilled = useRef<string | null>(null);

  /**
   * ★ DECIDED AGAINST THE ADDRESS AS IT IS WHEN THE PLACE ARRIVES, not as it
   * was when the search began. The updater form of `setAddress` reads the
   * current value, so the rule — fill only an empty address, or the one this
   * dialog filled last — is applied to the truth at that moment. The
   * coordinates are taken either way: they are what the place was found for.
   */
  const applyPlace = (place: ResolvedPlace) => {
    setPoint(place);
    const offered = place.address;
    if (!offered) return;
    setAddress((current) => {
      if (current.trim() !== '' && current !== lastFilled.current) return current;
      lastFilled.current = offered;
      return offered;
    });
  };

  /** The map dialog confirmed: the pin is the position, and any address it found is offered under the rule above. */
  const confirmPosition = (result: ResolvedPlace) => {
    applyPlace(result);
    setSetupOpen(false);
  };

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

        {/* <Field id="location-contact" label={t('locationContact')} value={contact} onChange={setContact} />
        <Field id="location-note" label={t('noteOptional')} value={note} onChange={setNote} /> */}

        {/* <PositionSection
          located={located}
          mapEnabled={mapEnabled}
          problem={problem}
          onSetup={() => setSetupOpen(true)}
          coordinateInputs={
            <CoordinateInputs
              latitude={latitude}
              longitude={longitude}
              invalid={problem !== null}
              onLatitude={setLatitude}
              onLongitude={setLongitude}
            />
          }
        /> */}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>

      {setupOpen ? (
        <LocationSetupModal initial={point} onCancel={() => setSetupOpen(false)} onConfirm={confirmPosition} />
      ) : null}
    </Modal>
  );
}

// ★ COMMENTED OUT WITH THE JSX THAT RENDERED IT — see the "Vị trí" block above. Restoring one means restoring the other, and it MUST be restored for a new place to get coordinates at all: those two numbers are the only thing the driver geofence can measure against.
// /**
//  * How the map action reads: setting a position is the work when there is
//  * none, and a quiet correction when there is one.
//  */
// const MAP_ACTION = {
//   located: { variant: 'ghost', className: 'text-gray-600', label: 'editLocationPosition' },
//   unlocated: { variant: 'outline', className: undefined, label: 'setupLocation' },
// } as const;
//
// /**
//  * ★ THE POSITION, AS A STATE AND ONE ACTION — never as two numbers to type.
//  * The pill, the map action, the one-line exception for a free-text address
//  * nobody picked, and the numbers: behind a fold when there is a map, in the
//  * open with plain words when there is not.
//  */
// function PositionSection({
//   located,
//   mapEnabled,
//   problem,
//   onSetup,
//   coordinateInputs,
// }: Readonly<{
//   located: boolean;
//   mapEnabled: boolean;
//   problem: PairProblem;
//   onSetup: () => void;
//   coordinateInputs: React.ReactNode;
// }>) {
//   const { t } = useLanguage();
//   const action = MAP_ACTION[located ? 'located' : 'unlocated'];
//
//   return (
//     <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
//       <legend className="px-1 text-sm font-medium text-gray-700">{t('locationPosition')}</legend>
//       <div className="flex flex-wrap items-center gap-2">
//         <StatusPill tone={located ? 'green' : 'amber'}>
//           {t(located ? 'locationLocated' : 'locationUnlocated')}
//         </StatusPill>
//         {mapEnabled ? (
//           <Button
//             type="button"
//             variant={action.variant}
//             size="sm"
//             className={action.className}
//             onClick={onSetup}
//           >
//             <MapPin className="size-3.5" aria-hidden />
//             {t(action.label)}
//           </Button>
//         ) : null}
//       </div>
//       {/* The exception, and only then: a free-text address nobody picked from the suggestions. */}
//       {located ? null : (
//         <p className="text-xs text-amber-700">
//           {t('locationNotYetLocated')}
//           {mapEnabled ? ` ${t('locationResolveHint')}` : ''}
//         </p>
//       )}
//
//       {mapEnabled ? (
//         // Behind a fold: for somebody who was handed coordinates, not the way in.
//         <details className="text-xs text-gray-500">
//           <summary className="cursor-pointer select-none">{t('manualCoordinates')}</summary>
//           <div className="mt-2">{coordinateInputs}</div>
//         </details>
//       ) : (
//         <>
//           <p className="text-xs text-gray-500">{t('locationCoordinatesHint')}</p>
//           {coordinateInputs}
//         </>
//       )}
//       {problem ? (
//         <p role="alert" className="text-xs text-red-600">
//           {t(problem === 'incomplete' ? 'locationPairIncomplete' : 'locationPairInvalid')}
//         </p>
//       ) : null}
//     </fieldset>
//   );
// }

/**
 * The map, on top of the form: find the place, put the pin on the gate,
 * confirm. Nothing reaches the form until "Xác nhận vị trí" — closing the
 * dialog any other way leaves the place exactly as it was.
 *
 * ★ THE PIN IS THE ANSWER, NOT THE SEARCH RESULT. Google finds the parcel;
 * the operator drags the pin to the gate the lorry actually reaches, and the
 * pin's final position is what is confirmed. The address the found place
 * offered travels back with it, for the form's own fill rule.
 */
function LocationSetupModal({
  initial,
  onCancel,
  onConfirm,
}: Readonly<{
  initial: Coordinates | null;
  onCancel: () => void;
  onConfirm: (result: ResolvedPlace) => void;
}>) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Coordinates | null>(initial);
  const [offeredAddress, setOfferedAddress] = useState<string | null>(null);
  /**
   * What the found place said about tỉnh/huyện/xã, travelling back with the
   * confirm exactly as the address does.
   *
   * ★ DRAGGING THE PIN DOES NOT CHANGE IT, and that is the same rule the
   * address follows. The operator moves the pin from the parcel's centre to the
   * gate — a few dozen metres inside the SAME ward — so re-deriving the three
   * would mean a second billed lookup to learn what is already known. An
   * operator who really has moved the pin into the next district corrects the
   * fields, which they can.
   */


  const pick = (place: ResolvedPlace, text: string) => {
    setQuery(text);
    setDraft(place);
    setOfferedAddress(place.address);
  };

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={t('setupLocation')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" type="button" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={draft === null}
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => {
              // The pin is the answer; the administrative fields are chosen
              // from the official list, never inferred from where it landed.
              if (draft)
                onConfirm({ ...draft, address: offeredAddress, province: null, ward: null });
            }}
          >
            {t('confirmPosition')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <PlaceSearch
          id="location-search"
          label={t('locationSearch')}
          value={query}
          onChange={setQuery}
          onPick={pick}
          placeholder={t('locationSearchPlaceholder')}
        />
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">{t('locationPinHint')}</p>
          <LocationMap point={draft} onMove={setDraft} />
        </div>
      </div>
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
      {state === 'failed' ? (
        <p role="alert" className="text-xs text-red-600">
          {t('locationSearchFailed')}
        </p>
      ) : null}
      {searched && visible.length === 0 ? (
        <p className="text-xs text-gray-500">{t('locationNoResults')}</p>
      ) : null}
      {visible.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" aria-label={label}>
          {visible.map((suggestion) => (
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

// ★ COMMENTED OUT WITH `PositionSection`, its only caller.
// /** The two numbers, as text fields. The server validates them again; this only keeps the pair whole. */
// function CoordinateInputs({
//   latitude,
//   longitude,
//   invalid,
//   onLatitude,
//   onLongitude,
// }: Readonly<{
//   latitude: string;
//   longitude: string;
//   invalid: boolean;
//   onLatitude: (value: string) => void;
//   onLongitude: (value: string) => void;
// }>) {
//   const { t } = useLanguage();
//   return (
//     <div className="grid grid-cols-2 gap-2">
//       <Input
//         id="location-latitude"
//         type="number"
//         inputMode="decimal"
//         step="any"
//         min={-90}
//         max={90}
//         placeholder={t('fieldLatitude')}
//         aria-label={t('fieldLatitude')}
//         aria-invalid={invalid || undefined}
//         value={latitude}
//         onChange={(event) => onLatitude(event.target.value)}
//       />
//       <Input
//         id="location-longitude"
//         type="number"
//         inputMode="decimal"
//         step="any"
//         min={-180}
//         max={180}
//         placeholder={t('fieldLongitude')}
//         aria-label={t('fieldLongitude')}
//         aria-invalid={invalid || undefined}
//         value={longitude}
//         onChange={(event) => onLongitude(event.target.value)}
//       />
//     </div>
//   );
// }

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
