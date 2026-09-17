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
  geocodeAddress,
  resolvePlace,
  searchPlaces,
  type PlaceSuggestion,
  type ResolvedPlace,
} from '@/api/placeSearch';
import {
  AdminAreaFields,
  EMPTY_ADMIN_AREA,
  type AdminAreaValue,
} from '@/components/trip/AdminAreaFields';
import { StatusPill } from '@/components/common/StatusPill';
import { LocationMap } from './LocationMap';
import type { Coordinates } from '@/types/driver';
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
 * ★ THE ADMINISTRATIVE FIELDS ARE TEXT, AND OPTIONAL. Tỉnh/thành and phường/xã:
 * filled from the address components of the place the operator picks,
 * corrected by hand, and blank whenever nobody has said. They describe the row
 * for a reader; nothing operational reads them. A pre-merger row also carries
 * the abolished quận/huyện, which this form sends back unchanged rather than
 * blanking — see `AdminAreaFields`.
 *
 * ★ THE OPERATOR NEVER *HAS TO* TYPE A COORDINATE. A place has a name, an
 * address and a POSITION. Picking a suggestion settles the position with it;
 * "Thiết lập vị trí" opens a map to put the pin on the gate, which is what
 * matters — a geocoder answers with the centre of a parcel, and Cảng Cát Lái's
 * centre is most of a kilometre from the gate a lorry queues at, outside the
 * 300 m the server confirms within. The two numbers stay reachable behind an
 * "advanced" fold for the rare case somebody was handed them.
 *
 * ★ AND THE DIALOG SHOWS WHAT IT CAPTURED. Until it did, picking a suggestion
 * silently set a position nobody could see, and typing an address silently set
 * none — both looked identical on screen and the difference only surfaced at a
 * gate, as a driver who could not confirm arrival.
 *
 * ★ COORDINATES DESCRIBE THE ADDRESS THEY WERE CAPTURED FOR. Change the address
 * afterwards and the old pair becomes a claim about somewhere else — so the
 * dialog says so rather than shipping it quietly. That one is worse than having
 * no coordinates at all: `DESTINATION_MISSING` names the office as the party
 * at fault, while `OUTSIDE_GEOFENCE` reads as a driver lying about where he is.
 *
 * ★ COORDINATES ARE OPTIONAL, AND SAID SO. A place is real before anybody has
 * located it, the server's own contract says both or neither, and the trip form
 * warns again at dispatch. So an unlocated place still SAVES; only a malformed
 * pair — half of one, or off the planet — blocks it, because the server would
 * refuse that with a 422 anyway.
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

/** The pair as a point, or nothing when it is absent or not yet a pair. */
const pointOf = (latitude: string, longitude: string): Coordinates | null =>
  latitude.trim() !== '' && pairProblem(latitude, longitude) === null
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null;

/**
 * Whether the position on the form still describes the address on the form.
 *
 * ★ `stale` IS THE STATE THAT EXISTS TO BE CAUGHT. Correcting the address of a
 * located place leaves the old pair attached, and a saved row whose coordinates
 * point at the previous address fails the driver at the gate with
 * `OUTSIDE_GEOFENCE` — which reads as the driver lying rather than as the row
 * being wrong. Nothing else on the screen would have shown it.
 *
 * ★ `locatedFor === null` MEANS "NOTHING TO COMPARE", NOT "STALE". Numbers
 * typed by hand are a claim about whatever address is in the box; treating them
 * as suspect would put a warning on every hand-entered place forever.
 *
 * ⚠ WITHIN ONE SESSION ONLY, and that is the honest limit. A row whose address
 * was corrected last week opens with the two agreeing, because the form has no
 * record of which address the stored pair was captured for — and inventing
 * suspicion for every edited row would train people to ignore the warning.
 */
type PositionState = 'located' | 'stale' | 'unlocated';

export const positionStateOf = (
  point: Coordinates | null,
  address: string,
  locatedFor: string | null,
): PositionState => {
  if (point === null) return 'unlocated';
  if (locatedFor === null) return 'located';
  // Trimmed: the address is a textarea, and a trailing newline is not somebody
  // moving the warehouse.
  return address.trim() === locatedFor.trim() ? 'located' : 'stale';
};

/**
 * Which address survives a place being applied.
 *
 * A hand-written address is never overwritten — only an empty field, or one
 * still reading exactly what the last find put there, gives way to the place's
 * own wording.
 */
const addressAfterPlace = (
  current: string,
  offered: string | null,
  filledByUs: string | null,
): string =>
  offered === null || (current.trim() !== '' && current !== filledByUs) ? current : offered;

/**
 * What gets geocoded: the street line, then the ward, then the province.
 *
 * ★ THE ADDRESS ALONE IS OFTEN UNPLACEABLE, AND THE FORM ALREADY KNOWS THE
 * REST. "số 10" matches nothing anywhere; "số 10, Phường Tân Hải, Thành phố Hồ
 * Chí Minh" is a question a geocoder can answer. The operator picked those two
 * dropdowns already, so using them costs nothing and is the difference between
 * this feature working and appearing broken.
 *
 * Narrowest first, widest last — the order a Vietnamese address is written, and
 * the same order `fullAddress` uses on the catalogue.
 */
const geocodeQuery = (address: string, area: AdminAreaValue): string =>
  [address, area.ward, area.province]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');

/**
 * How long after the last keystroke the address is looked up by itself.
 *
 * ★ LONGER THAN THE SUGGESTION DEBOUNCE, DELIBERATELY. Suggestions are a
 * conversation — they should keep up with typing. This one fires once, writes a
 * position, and costs a request against a monthly allowance, so it waits until
 * somebody has actually stopped.
 */
const AUTO_LOCATE_DEBOUNCE_MS = 900;

/** Case- and diacritic-insensitive, so "Tân Hưng" matches "tan hung". */
const loosely = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

/**
 * Whether a derived point is where the operator SAID the place is.
 *
 * ★ THE ANSWER IS CHECKED AGAINST THE QUESTION, BECAUSE GEOCODERS DROP TERMS
 * THEY CANNOT SATISFY. Measured: asked for a street in Phường Tân Hưng, one
 * answered with a street of the same name in Phường Long Trường — fifteen
 * kilometres away, confidently, with nothing marking the substitution. A point
 * in the wrong ward is not a near miss at a 300 m geofence; it is a driver
 * standing at the right gate being told he is somewhere else.
 *
 * ★ LENIENT IN BOTH DIRECTIONS ON PURPOSE. No ward chosen, or no address
 * returned, means there is nothing to check and the answer stands — refusing
 * what cannot be verified would reject every good result from a provider that
 * words its addresses differently. Only a stated ward that the answer
 * CONTRADICTS is rejected. The unit prefix is stripped first, so "Phường Tân
 * Hưng" still matches a provider that writes "P. Tân Hưng".
 */
const inChosenArea = (answered: string | null, area: AdminAreaValue): boolean => {
  if (answered === null || area.ward === null) return true;
  const core = loosely(area.ward).replace(/^(phuong|xa|thi tran|p\.|tt\.)\s*/, '');
  return core === '' || loosely(answered).includes(core);
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
  const [setupOpen, setSetupOpen] = useState(false);

  /**
   * The address the current pair is a position OF.
   *
   * On open this is the row's own address whenever it has a pair — we have no
   * better claim, and assuming the two disagree would shout at every edit.
   * Every pick, every confirmed pin and every hand-typed number rewrites it.
   */
  const [locatedFor, setLocatedFor] = useState<string | null>(
    editing && editing.latitude !== null ? editing.address : null,
  );

  const problem = pairProblem(latitude, longitude);
  const point = pointOf(latitude, longitude);
  const positionState = positionStateOf(point, address, locatedFor);

  /** Whether an automatic lookup is in flight. */
  const [locating, setLocating] = useState(false);

  /**
   * What the automatic lookup MATCHED, when the pair came from one.
   *
   * ★ THE MATCHED TEXT, NOT A BOOLEAN, AND THIS WAS MEASURED. Asked for
   * "105 đường số 10, Phường Phú Thuận" a geocoder answered with *Đường Số 7*
   * in the same ward — a different street, confidently, with no hint that it
   * had substituted one. Showing only "derived automatically" would leave that
   * silent, and a point on the wrong street is exactly the OUTSIDE_GEOFENCE
   * failure the rest of this dialog exists to prevent. Printing what it matched
   * makes a wrong match obvious at a glance instead of at a gate.
   */
  const [autoMatched, setAutoMatched] = useState<string | null>(null);
  const [autoLocated, setAutoLocated] = useState(false);

  const setPoint = ({ latitude: lat, longitude: lng }: Coordinates) => {
    setLatitude(roundCoordinate(lat));
    setLongitude(roundCoordinate(lng));
  };

  /**
   * ★ THE ADDRESS LOCATES ITSELF, WHICH IS THE POINT OF THIS BLOCK. Picking a
   * suggestion was the only path before, and an operator who typed the address
   * instead — which is most of them — saved a place no driver could ever
   * confirm arrival at. Now the typed address is looked up on its own.
   *
   * ★ ONLY WHEN THERE IS NO POSITION AT ALL. Never on `stale`: an address
   * edited after a pin was placed means the two disagree, and the person who
   * dragged that pin onto a gate is a better authority than a geocoder. That
   * case keeps its warning and its choice.
   *
   * ★ AND IT NEVER TOUCHES THE ADDRESS. The lookup answers with the provider's
   * tidied wording; writing that back would rewrite what somebody was still
   * typing. Only the two numbers are taken.
   */
  const query = geocodeQuery(address, area);

  /**
   * ★ THE ADDRESS MUST BE THERE, NOT JUST THE QUERY. Measured as a bug: the
   * ward and the province alone are already long enough to look up, so
   * answering the two dropdowns FIRST — which is the order half the form
   * invites — derived a position before anybody had typed an address at all.
   * What came back was the centre of the ward, presented as the place's
   * position on a brand-new "Thêm địa điểm" form. The two dropdowns are
   * CONTEXT for the address; they are not a place.
   */
  const derivable = address.trim().length >= SEARCH_MIN_CHARS;

  /**
   * ★ A DERIVED POINT MAY BE RE-DERIVED; A CHOSEN ONE MAY NOT. Once anything
   * had been derived, editing the form left it permanently "lệch" with no way
   * back, because deriving was allowed only from nothing. A derived point has
   * no human decision behind it, so replacing it costs nothing. A picked
   * suggestion, a dragged pin or typed numbers DO carry one, and those stay
   * protected — they keep the warning and the choice.
   *
   * ★ COMPARED AGAINST THE WHOLE QUERY, NOT THE ADDRESS, AND THIS WAS THE BUG
   * THAT REACHED A SCREENSHOT. An operator who types the address BEFORE
   * answering the two dropdowns gets a lookup with no ward in it — and
   * "đường số 53" alone matched a street of that name in Phường Long Trường,
   * fifteen kilometres from the Phường Tân Hưng they then chose. Choosing the
   * ward changed the QUERY but not the address, so the old rule saw nothing to
   * redo and the wrong point stood. The ward and the province are part of the
   * question; a change to either is a different question.
   */
  const derivedFrom = useRef<string | null>(null);
  const mayDerive =
    positionState === 'unlocated' || (autoLocated && query !== derivedFrom.current);

  useEffect(() => {
    if (!mayDerive || !derivable || query.trim().length < SEARCH_MIN_CHARS) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLocating(true);
      // Recorded when the request LEAVES, not when it lands, so a question that
      // cannot be answered is not asked again on every render.
      derivedFrom.current = query;
      geocodeAddress(query)
        .then((found) => {
          if (cancelled) return;
          // `null` is "nothing matches that", which is the normal answer to
          // half an address. The section already says "not located"; there is
          // nothing further to tell anybody.
          if (found && inChosenArea(found.address, area)) {
            setPoint(found);
            setLocatedFor(address);
            setAutoLocated(true);
            setAutoMatched(found.address);
          }
        })
        // A failed lookup is silent here on purpose: the address field's own
        // search says when the service is unavailable, and two messages about
        // one outage is noise.
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLocating(false);
        });
    }, AUTO_LOCATE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `address` is read inside but `query` already contains it; listing both
    // would run this twice for one keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mayDerive, derivable]);

  // What the last found place wrote into the address, so a later find may
  // replace it — and an address the operator wrote is left alone.
  const lastFilled = useRef<string | null>(null);

  /**
   * Numbers typed into the advanced fold.
   *
   * ★ TYPING ONE ALSO CLAIMS IT DESCRIBES THE ADDRESS ON SCREEN. Without that,
   * a hand-entered pair would read as `stale` the instant it was complete —
   * a warning about a disagreement the operator had just resolved.
   */
  const typeLatitude = (value: string) => {
    setLatitude(value);
    setLocatedFor(address);
    setAutoLocated(false);
    setAutoMatched(null);
  };
  const typeLongitude = (value: string) => {
    setLongitude(value);
    setLocatedFor(address);
    setAutoLocated(false);
    setAutoMatched(null);
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
    setLocatedFor(text);
    setAddress(text);
    setPoint(place);
    // A chosen suggestion is a decision, not a derivation — it carries no
    // caveat to show.
    setAutoLocated(false);
    setAutoMatched(null);
  };

  /**
   * A pin confirmed on the map.
   *
   * ★ `setLocatedFor(next)` IS THE LOAD-BEARING LINE. Without it a pin the
   * operator had just dragged deliberately would read as `stale` on the very
   * next render — the form warning them about the thing they had come here to
   * do.
   */
  const confirmPosition = (place: Coordinates & { address?: string | null }) => {
    const next = addressAfterPlace(address, place.address ?? null, lastFilled.current);
    if (next !== address) lastFilled.current = next;
    setAddress(next);
    setPoint(place);
    setLocatedFor(next);
    // A hand-placed pin outranks anything derived, so the caveat goes with it.
    setAutoLocated(false);
    setAutoMatched(null);
    setSetupOpen(false);
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

        {/*
          The address field IS the search: suggestions as the operator types,
          and a pick settles the position underneath.

          ★ RENDERED UNCONDITIONALLY NOW, WHERE IT USED TO BE BEHIND A KEY
          CHECK. The map no longer needs one — it is OpenStreetMap — so there is
          no longer a "this deployment has no maps" mode to fall back from. If
          the SEARCH is unavailable the field says so under itself and the pin
          still works, which is a better answer than a bare textarea that
          explained nothing.
        */}
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
        {/*
          ★ TWO DROPDOWNS, BECAUSE VIETNAM HAS TWO LEVELS. Tỉnh/thành → xã/phường,
          served from our own API (which proxies and caches the public source).
          The quận/huyện tier was abolished on 1 July 2025, so there is no third
          control and nothing that could fill one — only a read-only line on the
          rows that were filed while it still existed.
        */}
        <AdminAreaFields value={area} onChange={setArea} />

        <PositionSection
          state={positionState}
          locating={locating}
          autoLocated={autoLocated}
          autoMatched={autoMatched}
          latitude={latitude}
          longitude={longitude}
          problem={problem}
          onSetup={() => setSetupOpen(true)}
          onLatitude={typeLatitude}
          onLongitude={typeLongitude}
        />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>

      {setupOpen ? (
        <LocationSetupModal
          initial={point}
          onCancel={() => setSetupOpen(false)}
          onConfirm={confirmPosition}
        />
      ) : null}
    </Modal>
  );
}

/**
 * What the form knows about where this place is, said out loud.
 *
 * ★ THE NUMBERS ARE ON SCREEN, AND THAT IS THE POINT OF THE WHOLE SECTION.
 * Before it, a picked suggestion and a typed address looked identical — both
 * showed nothing — and the difference between them only appeared later, as a
 * driver at a gate who could not confirm arrival.
 *
 * ★ `stale` IS AMBER, NOT GREEN. A pair that may describe a different address
 * is not a located place; colouring it green would be the screen agreeing with
 * a row that is about to fail at the gate.
 */
function PositionSection({
  state,
  locating,
  autoLocated,
  autoMatched,
  latitude,
  longitude,
  problem,
  onSetup,
  onLatitude,
  onLongitude,
}: Readonly<{
  state: PositionState;
  locating: boolean;
  autoLocated: boolean;
  autoMatched: string | null;
  latitude: string;
  longitude: string;
  problem: PairProblem;
  onSetup: () => void;
  onLatitude: (value: string) => void;
  onLongitude: (value: string) => void;
}>) {
  const { t } = useLanguage();
  const located = state === 'located';

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">{t('locationPosition')}</span>
        <StatusPill tone={located ? 'green' : 'amber'}>
          {t(located ? 'locationLocated' : 'locationUnlocated')}
        </StatusPill>
      </div>

      {/*
        ★ `tabular-nums` SO THE DIGITS DO NOT DANCE. Somebody comparing this
        against a figure from elsewhere is reading column by column.
        `t()` takes a key and does not interpolate, so the label and the numbers
        are composed here rather than formatted into a sentence.
      */}
      {latitude.trim() !== '' || longitude.trim() !== '' ? (
        <p className="text-sm text-gray-800">
          <span className="text-gray-500">{t('locationCoordinates')}: </span>
          <span className="tabular-nums">
            {latitude || '—'}, {longitude || '—'}
          </span>
        </p>
      ) : null}

      {/*
        The state, then what to DO about it. A warning that names a problem and
        stops there gets read once and ignored afterwards.
      */}
      {/*
        ★ SAID WHILE IT IS HAPPENING, NOT AFTER. The lookup takes a moment and
        writes a position by itself; without this line the operator sees nothing
        change, concludes the address was not understood, and reaches for the
        map a second before the answer lands.
      */}
      {locating ? (
        <output role="status" className="block text-xs text-gray-500">
          {t('locationLocating')}
        </output>
      ) : null}

      {/*
        ★ AN AUTOMATIC POINT SAYS SO. It is the street or the parcel, not the
        gate — fine for a shop on a named road, wrong by a kilometre for a port.
        Presenting it as though somebody had placed it is how a row nobody
        checked reaches a driver.
      */}
      {autoLocated && located ? (
        <div className="space-y-0.5">
          <p className="text-xs text-amber-700">{t('locationAutoLocated')}</p>
          {/*
            ★ WHAT IT MATCHED, VERBATIM. Measured: asked for "105 đường số 10,
            Phường Phú Thuận" a geocoder answered with *Đường Số 7* — a
            different street, with no hint it had substituted one. Read back,
            the substitution is obvious in a second; unread, it is a lorry at
            the wrong gate and a driver blamed for it.
          */}
          {autoMatched ? (
            <p className="text-xs text-gray-500">
              <span className="text-gray-400">↳ </span>
              {autoMatched}
            </p>
          ) : null}
        </div>
      ) : null}

      {state === 'unlocated' && !locating ? (
        <output className="block text-xs text-amber-700">
          {t('locationNotYetLocated')} {t('locationResolveHint')}
        </output>
      ) : null}
      {state === 'stale' ? (
        <output role="status" className="block text-xs text-amber-700">
          {t('locationAddressChanged')}
        </output>
      ) : null}

      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onSetup}>
        <MapPin className="size-3.5" aria-hidden />
        {t(located ? 'editLocationPosition' : 'setupLocation')}
      </Button>

      {/*
        ⚠ RENDERING `problem` IS NOT POLISH. These two inputs are the only way
        to produce a malformed pair, and a malformed pair disables Save — so
        without this line the button dies the moment somebody types one of the
        two numbers, with nothing on screen saying why.
      */}
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer select-none">{t('manualCoordinates')}</summary>
        <div className="mt-2">
          <CoordinateInputs
            latitude={latitude}
            longitude={longitude}
            invalid={problem !== null}
            onLatitude={onLatitude}
            onLongitude={onLongitude}
          />
        </div>
      </details>
      {problem ? (
        <p role="alert" className="text-xs text-red-600">
          {t(problem === 'incomplete' ? 'locationPairIncomplete' : 'locationPairInvalid')}
        </p>
      ) : null}
    </div>
  );
}

/** The two numbers, for somebody who was handed them. */
function CoordinateInputs({
  latitude,
  longitude,
  invalid,
  onLatitude,
  onLongitude,
}: Readonly<{
  latitude: string;
  longitude: string;
  invalid: boolean;
  onLatitude: (value: string) => void;
  onLongitude: (value: string) => void;
}>) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        type="number"
        step="any"
        min={-90}
        max={90}
        aria-label={t('fieldLatitude')}
        placeholder={t('fieldLatitude')}
        aria-invalid={invalid || undefined}
        value={latitude}
        onChange={(event) => onLatitude(event.target.value)}
      />
      <Input
        type="number"
        step="any"
        min={-180}
        max={180}
        aria-label={t('fieldLongitude')}
        placeholder={t('fieldLongitude')}
        aria-invalid={invalid || undefined}
        value={longitude}
        onChange={(event) => onLongitude(event.target.value)}
      />
    </div>
  );
}

/**
 * The map, with its own search, for putting the pin on the gate.
 *
 * ★ A SECOND DIALOG RATHER THAN A MAP ON THE FORM. The form is `max-w-lg` and
 * a map needs room to aim in; more importantly, the pin is a decision that gets
 * CONFIRMED — dragging it around is not the same as saying "this is the place",
 * and a map wired straight into the form would make every stray click an edit.
 *
 * ★ ITS OWN SEARCH BOX, because the address on the form is often the postal
 * address and the gate is found by looking for something else — the port, the
 * industrial park, the road it opens onto.
 */
function LocationSetupModal({
  initial,
  onCancel,
  onConfirm,
}: Readonly<{
  initial: Coordinates | null;
  onCancel: () => void;
  onConfirm: (place: Coordinates & { address?: string | null }) => void;
}>) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<(Coordinates & { address?: string | null }) | null>(initial);
  const [query, setQuery] = useState('');

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={t('locationPosition')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" type="button" onClick={onCancel}>
            {t('cancel')}
          </Button>
          {/* Nothing to confirm until there is a pin: confirming `null` would
              be the dialog quietly clearing a position somebody came to fix. */}
          <Button
            type="button"
            disabled={draft === null}
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => draft && onConfirm(draft)}
          >
            {t('confirmPosition')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PlaceSearch
          id="location-setup-search"
          label={t('locationSearch')}
          placeholder={t('locationSearchPlaceholder')}
          value={query}
          onChange={setQuery}
          onPick={(place, text) => {
            setQuery(text);
            setDraft(place);
          }}
        />
        <LocationMap point={draft} onMove={(moved) => setDraft({ ...moved, address: null })} />
        <p className="text-xs text-gray-500">{t('locationPinHint')}</p>
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
      // ★ THE ID, PLAINLY. The previous provider needed the prediction OBJECT
      // kept alive in a WeakMap so overlapping searches could not resolve each
      // other's rows; this one issues a plain id that means the same thing
      // whenever it is sent, so that whole mechanism is gone.
      const place = await resolvePlace(suggestion.id);
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
