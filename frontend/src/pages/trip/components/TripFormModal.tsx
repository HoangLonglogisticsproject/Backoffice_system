import { useEffect, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { createTripCustomer } from '@/api/tripCatalogue';
import { assignDriver } from '@/api/tripAssignment';
import {
  createTripSchedule,
  updateTripSchedule,
  type CreateTripInput,
  type UpdateTripInput,
} from '@/api/tripSchedule';
import { isApiError } from '@/utils/errors';
import { formatPlate } from '@/utils/format';
import {
  fromDateTimeLocalValue,
  todayAsCalendarDay,
  toDateTimeLocalValue,
} from '@/utils/format/datetime';
import { useTripLocations } from '@/hooks/trip';
import { useEligibleDrivers } from '@/hooks/trip/useTripAssignment';
import {
  DISPATCH_SELECTABLE_STATUSES,
  type TripCustomer,
  type TripLocation,
  type TripSchedule,
  type TripScheduleWithRefs,
  type TripStatus,
  type TripVehicle,
} from '@/types/trip';
import { CatalogueSelect } from './CatalogueSelect';
import { DriverSelect } from './DriverSelect';
import { LocationFormModal } from './LocationFormModal';
import { TRIP_STATUS_STYLES } from './tripStatus';

interface TripFormModalProps {
  isOpen: boolean;
  /** Absent means "add". Present means "correct this row" — GLOBAL only. */
  trip?: TripScheduleWithRefs | null;
  customers: TripCustomer[];
  /**
   * The active lorries, for the crew rows below.
   *
   * ★ STILL NO LORRY FIELD ON THE TRIP (ADR-0004). These feed
   * "Phương tiện điều độ", where each row is one ASSIGNMENT — a lorry AND its
   * driver — and every row is sent to the dispatch endpoint after the trip
   * exists. Nothing here reads or writes `trip_schedules.vehicle_id`.
   */
  vehicles: TripVehicle[];
  /**
   * May the caller dispatch? `trip.create` and `trip.write` are separate
   * permissions and the dispatch endpoint demands the second, so somebody who
   * may book a trip but not crew one is offered no rows to fill in rather than
   * a section that answers 403 on save.
   */
  mayDispatch: boolean;
  /**
   * Has the customer catalogue read come back?
   *
   * Needed only to tell "this customer is archived" from "the list has not
   * loaded yet" — the two look identical from an empty options array, and
   * labelling an active customer as archived for the first few hundred
   * milliseconds would be a statement that is simply untrue.
   */
  cataloguesLoaded: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** A new catalogue row was added from inside the form; reload the lists. */
  onCatalogueChanged: () => void;
}

/** Every field, as the form holds it: strings, because that is what inputs give. */
interface FormState {
  scheduledOn: string;
  customerId: string | null;
  cargoInfo: string;
  pickupAddress: string;
  deliveryAddress: string;
  pickupContact: string;
  deliveryContact: string;
  pickupAt: string;
  deliveryAt: string;
  /** The customer's place for each end, or `null` for a hand-typed address. */
  pickupLocationId: string | null;
  deliveryLocationId: string | null;
  /**
   * The two agreed charges, as the PLAIN decimal strings the API takes —
   * `MoneyInput` keeps the commas between itself and the DOM, so nothing here
   * strips them.
   *
   * ⚠ BOTH STAY `''` FOR A VIEWER WHO MAY NOT SEE PRICES, and the submit path
   * drops the keys entirely rather than sending `null`. The server answers 403
   * to a body carrying either key from such a caller — deliberately, so that a
   * figure is never silently discarded — so sending "nothing to say here" as an
   * explicit clear would fail every save they attempt.
   */
  sellPrice: string;
  purchasePrice: string;
  note: string;
  status: TripStatus;
}

const emptyForm = (): FormState => ({
  scheduledOn: todayAsCalendarDay(),
  customerId: null,
  cargoInfo: '',
  pickupAddress: '',
  deliveryAddress: '',
  pickupContact: '',
  deliveryContact: '',
  pickupAt: '',
  deliveryAt: '',
  pickupLocationId: null,
  deliveryLocationId: null,
  sellPrice: '',
  purchasePrice: '',
  note: '',
  status: 'pending',
});

/** What a `CatalogueSelect` offers. Mirrors its own prop type. */
interface Option {
  id: string;
  label: string;
}

/**
 * ★ THE ROW'S OWN REFERENCE IS NOT AN OPTION — IT IS THE CURRENT VALUE.
 *
 * The catalogue endpoints return ACTIVE rows only, which is right: a retired
 * truck must not be offered for tomorrow's work. But a trip entered before that
 * truck was retired still names it, and a `<select>` whose value matches none of
 * its options renders BLANK — so the plate vanished from the form, and touching
 * the control at all silently replaced a historical assignment with something
 * else.
 *
 * So the row's own current reference is appended when the catalogue no longer
 * carries it, marked as retired. It is reachable only from the trip that
 * already holds it: a new trip passes `current = null`, and another trip passes
 * its own. No archived row is ever offered as an ordinary choice.
 */
const withCurrentReference = (
  options: Option[],
  current: Option | null,
  loaded: boolean,
  archivedLabel: string,
): Option[] => {
  if (!current || options.some((option) => option.id === current.id)) return options;
  // Still loading: keep the value selectable so nothing is lost, but do not
  // call it retired until the catalogue has actually said so.
  const label = loaded ? `${current.label} (${archivedLabel})` : current.label;
  return [...options, { id: current.id, label }];
};

const formFor = (trip: TripScheduleWithRefs): FormState => ({
  // Copied through as the STRING it is. Never `new Date(trip.scheduledOn)` —
  // that is midnight UTC, and it would move the trip a day back on the way into
  // the form for anybody west of UTC.
  scheduledOn: trip.scheduledOn,
  customerId: trip.customerId,
  cargoInfo: trip.cargoInfo ?? '',
  pickupAddress: trip.pickupAddress ?? '',
  deliveryAddress: trip.deliveryAddress ?? '',
  pickupContact: trip.pickupContact ?? '',
  deliveryContact: trip.deliveryContact ?? '',
  pickupAt: toDateTimeLocalValue(trip.pickupAt),
  deliveryAt: toDateTimeLocalValue(trip.deliveryAt),
  pickupLocationId: trip.pickupLocationId,
  deliveryLocationId: trip.deliveryLocationId,
  // ★ THE SERVER'S `"4500000.00"` GOES IN AS IT CAME. Trimming the decimals
  // here would make opening a trip and saving it unchanged rewrite the figure,
  // and no reading of that is reassuring when the subject is money.
  //
  // ⚠ A VIEWER WITHOUT `trip.price.read` IS SENT `null` FOR BOTH, whatever the
  // trip actually holds, so these land as `''` — indistinguishable from an
  // unpriced trip, which is what the server intends. They never reach a field:
  // the form does not render one for them.
  sellPrice: trip.sellPrice ?? '',
  purchasePrice: trip.purchasePrice ?? '',
  note: trip.note ?? '',
  status: trip.status,
});

type End = 'pickup' | 'delivery';
type EndFlags = Record<End, boolean>;
const NO_REFRESH: EndFlags = { pickup: false, delivery: false };

/** The form as it opens: the row's values, or an empty sheet for a new trip. */
const initialForm = (trip: TripScheduleWithRefs | null): FormState =>
  trip ? formFor(trip) : emptyForm();

/**
 * ★ A NEW CUSTOMER MEANS NO PLACE, YET. The places on the form were the old
 * customer's; both are cleared in the same state change as the customer, so
 * no render — and no submit — can pair customer B with customer A's place.
 * The server refuses that pairing anyway; this keeps the form honest.
 */
const withCustomer = (current: FormState, id: string | null): FormState =>
  current.customerId === id
    ? current
    : { ...current, customerId: id, pickupLocationId: null, deliveryLocationId: null };

/**
 * ★ THE TRIP'S OWN COPY OF ONE END: the place it was copied from, with the
 * address, contact and coordinates the trip actually holds. This — not the
 * master row — is what the driver is measured against, until the reference is
 * changed or deliberately refreshed. The active list does not carry an
 * archived place, but the trip still names it and still holds the copy; that
 * copy is what the form shows for it, read-only, and the reference stays
 * selected. Nothing is reactivated; choosing another place is the
 * dispatcher's to do.
 */
const snapshotOf = (trip: TripScheduleWithRefs | null, end: End): ChosenPlace | null => {
  const ref = end === 'pickup' ? trip?.pickupLocation : trip?.deliveryLocation;
  if (!trip || !ref) return null;
  return end === 'pickup'
    ? {
        ...ref,
        address: trip.pickupAddress ?? '',
        contact: trip.pickupContact,
        latitude: trip.pickupLatitude ?? null,
        longitude: trip.pickupLongitude ?? null,
      }
    : {
        ...ref,
        address: trip.deliveryAddress ?? '',
        contact: trip.deliveryContact,
        latitude: trip.deliveryLatitude ?? null,
        longitude: trip.deliveryLongitude ?? null,
      };
};

/**
 * ★ THE PLACES ARE THE CHOSEN CUSTOMER'S, AND NOBODY ELSE'S. A place still
 * selected after the customer changed is dropped the moment the new list
 * arrives without it, so a trip for customer B can never quietly carry
 * customer A's warehouse. The trip's own (possibly archived) places stay
 * known — but ONLY while the form still names the trip's own customer. The
 * server refuses the wrong pairing anyway; this keeps the form honest before
 * submit. Returns `current` itself when nothing changes, so the effect settles.
 */
const reconcilePlaces = (
  current: FormState,
  master: TripLocation[] | null,
  trip: TripScheduleWithRefs | null,
): FormState => {
  if (current.customerId === null) {
    return current.pickupLocationId === null && current.deliveryLocationId === null
      ? current
      : { ...current, pickupLocationId: null, deliveryLocationId: null };
  }
  if (master === null) return current;

  const known = new Set(master.map((location) => location.id));
  if (current.customerId === trip?.customerId) {
    for (const end of ['pickup', 'delivery'] as const) {
      const own = snapshotOf(trip, end);
      if (own) known.add(own.id);
    }
  }
  const keep = (id: string | null) => (id !== null && known.has(id) ? id : null);
  const pickup = keep(current.pickupLocationId);
  const delivery = keep(current.deliveryLocationId);
  return pickup === current.pickupLocationId && delivery === current.deliveryLocationId
    ? current
    : { ...current, pickupLocationId: pickup, deliveryLocationId: delivery };
};

/**
 * ★ THE PLACE AN END WILL ACTUALLY RUN AGAINST. For an existing trip whose
 * reference is unchanged, that is the trip's SNAPSHOT: the master row may
 * have been located since, but the driver is measured against the copy the
 * trip holds until the office deliberately refreshes it. A refreshed or newly
 * chosen place reads from the master, because that is what the next save
 * copies. So what the readiness pill says is always what the driver will
 * meet — never a master value the trip does not yet hold.
 */
const placeFor = (
  value: string | null,
  master: TripLocation[],
  snapshot: ChosenPlace | null,
  refreshed: boolean,
): ChosenPlace | null => {
  if (value === null) return null;
  if (snapshot?.id === value && !refreshed) return snapshot;
  return master.find((location) => location.id === value) ?? (snapshot?.id === value ? snapshot : null);
};

/** `''` → `null`: on the PATCH path this is what makes clearing a field possible. */
const blank = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** The place id the form holds for one end. */
const locationIdAt = (form: FormState, end: End): string | null =>
  end === 'pickup' ? form.pickupLocationId : form.deliveryLocationId;

/**
 * The server's own sentence when it refused — it knows about retired
 * vehicles, archived customers and the date rules; this form does not — or
 * the generic one when the failure was not the server's.
 */
const failureMessage = (error: unknown, fallback: string): string =>
  isApiError(error) ? error.message : fallback;

/** The row's own customer as an option, for `withCurrentReference`. `null` when it has none. */
const currentCustomerOption = (trip: TripScheduleWithRefs | null): Option | null =>
  trip?.customer ? { id: trip.customer.id, label: trip.customer.name } : null;

/**
 * One end of the payload.
 *
 * ★ NO COORDINATE LEAVES THIS FORM. Each end names the customer's place, and
 * the server copies that place's address, contact and coordinates onto the
 * trip. The typed address and contact travel only for an end with no place —
 * the hand-typed path every trip took before places existed.
 *
 * ★ AN END WHOSE PLACE IS UNCHANGED IS NOT IN THE PATCH. The server copies a
 * place afresh only when the patch names it, and refuses to copy an archived
 * one — so an edit that leaves the place alone must not name it. Otherwise
 * correcting a note on a trip whose warehouse has since closed would be
 * refused, and on any other trip would quietly rewrite last week's snapshot
 * from today's master. Omitted, the trip's own copy stands.
 *
 * ★ UNLESS THE OFFICE REFRESHED THE PLACE FROM THIS FORM. Then naming it again
 * is exactly the request: the server copies it afresh, and the snapshot the
 * driver meets becomes the one the readiness pill already shows.
 */
const endFields = (
  form: FormState,
  trip: TripScheduleWithRefs | null,
  end: End,
  refreshed: boolean,
): UpdateTripInput => {
  const [id, was, address, contact] =
    end === 'pickup'
      ? [form.pickupLocationId, trip?.pickupLocationId, form.pickupAddress, form.pickupContact]
      : [form.deliveryLocationId, trip?.deliveryLocationId, form.deliveryAddress, form.deliveryContact];
  if (id !== null && id === was && !refreshed) return {};
  return end === 'pickup'
    ? { pickupLocationId: id, pickupAddress: id ? null : blank(address), pickupContact: id ? null : blank(contact) }
    : { deliveryLocationId: id, deliveryAddress: id ? null : blank(address), deliveryContact: id ? null : blank(contact) };
};

/**
 * Everything the form sends. Every field it owns is always present, with
 * `''` as `null` — except the two prices, which are dropped entirely for a
 * viewer without the permission: the server REFUSES a body carrying either
 * from such a caller rather than ignoring it, so `'' → null` would turn every
 * save they make into a 403. For a viewer who holds it, `''` clears the
 * figure, because a price typed by mistake has to be removable.
 */
const tripPayload = (
  form: FormState,
  trip: TripScheduleWithRefs | null,
  mayPrice: boolean,
  refreshed: EndFlags,
): CreateTripInput & UpdateTripInput => ({
  scheduledOn: form.scheduledOn,
  customerId: form.customerId,
  cargoInfo: blank(form.cargoInfo),
  ...endFields(form, trip, 'pickup', refreshed.pickup),
  ...endFields(form, trip, 'delivery', refreshed.delivery),
  pickupAt: fromDateTimeLocalValue(form.pickupAt),
  deliveryAt: fromDateTimeLocalValue(form.deliveryAt),
  ...(mayPrice ? { sellPrice: blank(form.sellPrice), purchasePrice: blank(form.purchasePrice) } : {}),
  note: blank(form.note),
  status: form.status,
});

/** An existing row is patched; a new one is created. */
const saveTrip = (
  trip: TripScheduleWithRefs | null,
  payload: CreateTripInput & UpdateTripInput,
): Promise<TripSchedule> =>
  trip ? updateTripSchedule(trip.id, payload) : createTripSchedule(payload);

/**
 * One row of "Phương tiện điều độ" while it is being typed.
 *
 * ★ THIS IS AN INPUT SHAPE, NOT A DOMAIN ONE. It becomes a DispatchAssignment
 * the moment it is sent, and until then it is allowed to be half-filled —
 * which is the whole reason it carries its own `error`: the refusal belongs
 * beside the row that caused it, not at the bottom of the form.
 */
interface CrewRow {
  key: string;
  vehicleId: string;
  driverUserId: string;
  error: string | null;
}

// A counter rather than `crypto.randomUUID()`: this only has to be unique
// within one open form, and the key never leaves the browser.
let crewKeySeq = 0;
const newCrewRow = (): CrewRow => {
  crewKeySeq += 1;
  return { key: `crew-${crewKeySeq}`, vehicleId: '', driverUserId: '', error: null };
};

/**
 * Sends each pair to the dispatch endpoint and returns the rows that did NOT
 * land, each carrying the server's own words.
 *
 * ★ ONE AT A TIME, NOT `Promise.all`. `TripExecutionService.assign` locks the
 * trip row, so parallel calls would queue on the server anyway — and
 * sequentially each refusal can be attributed to the row that caused it
 * instead of arriving as one rejected batch.
 *
 * ★ AND THE SERVER IS THE AUTHORITY ON THE RULES. The duplicate-lorry check in
 * the form is a courtesy that saves a round trip; `requireVehicleFree` and the
 * partial unique index from 0027 are what actually enforce it, including
 * against a second dispatcher working at the same moment.
 */
const dispatchCrew = async (
  tripId: string,
  rows: CrewRow[],
  refusal: (error: unknown) => string,
): Promise<CrewRow[]> => {
  const failed: CrewRow[] = [];
  for (const row of rows) {
    try {
      await assignDriver(tripId, { vehicleId: row.vehicleId, driverUserId: row.driverUserId });
    } catch (error_) {
      failed.push({ ...row, error: refusal(error_) });
    }
  }
  return failed;
};

/**
 * Entering or correcting one row of the dispatch board.
 *
 * ★ THE EMPTY STRING IS SENT AS `null`, NOT OMITTED. On the PATCH endpoint,
 * omitting a key means "leave this alone" and `null` means "clear it" — so a
 * form that dropped its empty fields could never remove an address somebody
 * had entered by mistake. Every field this form owns is always sent, with `''`
 * converted to `null`, because the form genuinely knows the value of all of
 * them: the user is looking at every one.
 *
 * Same construction as `AddEmployeeModal`: one `useState` per field, a native
 * `<form onSubmit>`, HTML validation attributes, and the server's message shown
 * verbatim when it refuses. No form library — this project has none, and a
 * dependency added for one screen is a dependency the next reader has to learn.
 */
export function TripFormModal({
  isOpen,
  trip = null,
  customers,
  vehicles,
  mayDispatch,
  cataloguesLoaded,
  onClose,
  onSaved,
  onCatalogueChanged,
}: Readonly<TripFormModalProps>) {
  const { t } = useLanguage();
  // ★ A RENDER HINT THAT ALSO CHANGES THE PAYLOAD, WHICH IS UNUSUAL HERE AND
  // DELIBERATE. Everywhere else in this app `can()` only hides a control the
  // server would refuse anyway. Prices are different: the server refuses a body
  // that so much as MENTIONS them from a caller without the permission, so this
  // decides which keys are sent, not merely which fields are drawn. Getting it
  // wrong is a 403 on save rather than a silently ignored field — which is the
  // failure mode worth having.
  const { can } = useSession();
  const mayPrice = can('trip.price.read');
  // Correcting a place — locating it — is `trip.write`, the same key the
  // master-data screen asks for. A dispatcher without it still sees that a
  // place is not located; they just cannot fix it from here.
  const mayManagePlaces = can('trip.write');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * ★ WHICH ENDS THE OFFICE REFRESHED FROM THIS FORM. Correcting a place
   * through the dialog below changes the master row, not the trip; the trip
   * keeps its snapshot until a save names the place again. These flags are
   * what make the next save do that — see `endFields` — and what make the
   * readiness pill read the master for that end in the meantime, so the two
   * never disagree. Reset whenever the form opens on a row.
   */
  const [refreshed, setRefreshed] = useState<EndFlags>(NO_REFRESH);

  const editing = trip !== null;

  // Reloading the form when the dialog opens on a different row. Keyed on the
  // id rather than on the object, so an unrelated list refresh that produces a
  // new object for the same trip does not throw away what somebody is typing.
  useEffect(() => {
    if (!isOpen) return;
    setForm(initialForm(trip));
    setRefreshed(NO_REFRESH);
    setError(null);
    setCrew([]);
    setCreatedTripId(null);
  }, [isOpen, trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // The chosen customer's places, and the form kept honest against them —
  // see `reconcilePlaces`.
  const locations = useTripLocations(form.customerId);
  useEffect(() => {
    setForm((current) => reconcilePlaces(current, locations.data, trip));
  }, [form.customerId, form.pickupLocationId, form.deliveryLocationId, locations.data, trip]);

  const chooseCustomer = (id: string | null) => setForm((current) => withCustomer(current, id));

  /** The place one end will run against — see `placeFor`. */
  const placeAt = (end: End): ChosenPlace | null =>
    placeFor(locationIdAt(form, end), locations.data ?? [], snapshotOf(trip, end), refreshed[end]);

  /**
   * ★ READINESS IS "HAS COORDINATES", AND NOTHING ELSE. The driver's
   * confirmation at an end is refused by the server unless the trip's
   * snapshot of that end carries a point, so a trip is ready for location
   * verification exactly when BOTH ends name a located place. A hand-typed
   * address has no point and counts as not ready — which is the truth the
   * driver would otherwise discover at the gate. Whether a driver's reading
   * later PASSES is a different fact, decided by the server.
   */
  const tripLocationReady = isLocated(placeAt('pickup')) && isLocated(placeAt('delivery'));

  /**
   * The place dialog, if open: which end asked for it, and — for "set up
   * location" — which existing place it corrects. One dialog for both jobs;
   * there is no second way to put coordinates on a place.
   */
  const [placeDialog, setPlaceDialog] = useState<{ end: End; editing: TripLocation | null } | null>(null);

  /**
   * "Phương tiện điều độ" — the pairs typed alongside the trip.
   *
   * ★ EMPTY IS A PERFECTLY ORDINARY TRIP. Booking without a crew is still
   * supported and is still what happens when nobody has decided yet; these
   * rows only spare the dispatcher a second screen when they HAVE.
   */
  const [crew, setCrew] = useState<CrewRow[]>([]);
  /**
   * ★ THE TRIP IS CREATED ONCE, EVEN IF SAVE IS PRESSED TWICE.
   *
   * There is no endpoint that writes a trip and its assignments together, so a
   * save that creates the trip and then has a lorry refused leaves a real trip
   * on the board with some of its crew. Remembering the id is what makes the
   * retry send only the rows that are left instead of booking a second trip —
   * the one failure this flow could cause that nobody could undo from the UI.
   */
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);

  // Read once the form is open and only for somebody who may actually dispatch.
  const drivers = useEligibleDrivers(isOpen && mayDispatch && trip === null);

  /**
   * After the place dialog saved. A NEW place is selected where it was asked
   * for — AFTER the list has been re-read, so the effect that drops unknown
   * places never sees the new id before the list that contains it. A place
   * CORRECTED from here is already selected; the re-read list carries its
   * coordinates, and the end is marked so the next save names the place again
   * and the server copies it afresh.
   */
  const placeSaved = async (location: TripLocation) => {
    if (!placeDialog) return;
    const { end, editing } = placeDialog;
    await locations.reload();
    if (editing) setRefreshed((flags) => ({ ...flags, [end]: true }));
    else set(end === 'pickup' ? 'pickupLocationId' : 'deliveryLocationId', location.id);
  };

  const close = () => {
    setError(null);
    onClose();
  };

  /**
   * The lorries already spoken for by ANOTHER row of this form.
   *
   * ★ THE SAME PATTERN THE DISPATCH PANEL USES — it hides the lorries already
   * on the trip — and for the same reason: one lorry cannot be on one trip
   * twice, so offering it again only invites a refusal the user cannot see
   * coming. `checkCrew` still holds the rule, because a rule the UI merely
   * makes hard to break is not a rule.
   *
   * ⚠ It knows only about THIS form. A lorry already assigned on the server —
   * one that landed before a partial failure, say — is not in `crew` and is
   * still offered; that one is the server's to refuse, and it does.
   */
  const takenVehicleIds = new Set(crew.map((row) => row.vehicleId).filter((id) => id !== ''));

  const addCrew = () => setCrew((rows) => [...rows, newCrewRow()]);
  const removeCrew = (key: string) => setCrew((rows) => rows.filter((row) => row.key !== key));
  /** Editing a row clears its refusal — the message described the old value. */
  const setCrewAt = (key: string, patch: Partial<CrewRow>) =>
    setCrew((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch, error: null } : row)));

  /**
   * The two rules that can be answered without asking the server.
   *
   * A pair needs both halves — there is no lorry-only assignment — and one
   * lorry cannot be on the trip twice. The same DRIVER twice is left alone:
   * that is ordinary dispatch and the server accepts it.
   */
  const checkCrew = (rows: CrewRow[]): CrewRow[] => {
    const seen = new Set<string>();
    return rows.map((row) => {
      if (row.vehicleId === '' || row.driverUserId === '') {
        return { ...row, error: t('crewIncomplete') };
      }
      if (seen.has(row.vehicleId)) return { ...row, error: t('crewDuplicateVehicle') };
      seen.add(row.vehicleId);
      return { ...row, error: null };
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const checked = checkCrew(crew);
    setCrew(checked);
    if (checked.some((row) => row.error !== null)) return;

    setBusy(true);
    try {
      // ★ BUILT FROM THE FORM ON EVERY SAVE, AND ON A RETRY IT IS SENT.
      // Remembering the id stops a second trip being booked; it must not also
      // mean the second press throws away what was typed in between. A
      // dispatcher who fixes a refused lorry AND corrects the date in the same
      // breath expects both to land — and the first press is exactly when a
      // wrong date gets noticed, because that is when the row appears.
      const payload = tripPayload(form, trip, mayPrice, refreshed);

      let tripId: string;
      if (createdTripId === null) {
        const saved = await saveTrip(trip, payload);
        tripId = saved.id;
        if (trip === null) setCreatedTripId(saved.id);
      } else {
        // The trip this form created moments ago, corrected rather than
        // recreated. PATCH is `trip.write`, the same permission the crew
        // section already required to be drawn, so this cannot 403 for anyone
        // who could reach a partial failure in the first place.
        await updateTripSchedule(createdTripId, payload);
        tripId = createdTripId;
      }

      const failed = await dispatchCrew(tripId, checked, (error_) =>
        failureMessage(error_, t('saveFailed')),
      );

      // The trip is on the board whether or not every lorry landed, so the
      // list is re-read either way; hiding it until the crew is complete would
      // be hiding a row that exists.
      onSaved();
      setCrew(failed);
      if (failed.length > 0) {
        setError(t('crewPartlyAssigned'));
        return;
      }
      onClose();
    } catch (error_) {
      setError(failureMessage(error_, t('saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'trip-form';

  /**
   * ★ `finished` IS TERMINAL, AND IT IS ALSO UNREACHABLE FROM HERE (BD-01).
   *
   * Two rules, not one. A finished trip's status is frozen because the server
   * refuses every move away from it. And `finished` is absent from the options
   * on EVERY trip — new or existing — because a trip is finished by approving
   * its completion request, never by editing a field: `requireNotCompletionOnly`
   * refuses it on create and on update alike, and 0025's trigger makes the
   * state permanent once it is reached.
   *
   * Every other field of a finished trip stays editable. Whether a closed trip
   * should be read-only in full is a separate decision nobody has taken, and
   * this is not the place to take it.
   */
  const statusLocked = trip?.status === 'finished';

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={editing ? t('editTrip') : t('addTrip')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" type="button" onClick={close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="trip-date" className="text-sm font-medium text-gray-700">
              {t('fieldDate')}
            </label>
            {/*
              A native date input. This repo has no date-picker component and no
              date library; adding `react-day-picker` for two fields would be a
              dependency for a control every browser already ships — including
              the phones this is entered on.

              `type="date"` speaks `YYYY-MM-DD`, which is exactly the string the
              API wants, so the value moves in and out untouched.
            */}
            <Input
              id="trip-date"
              type="date"
              value={form.scheduledOn}
              onChange={(event) => set('scheduledOn', event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="trip-status" className="text-sm font-medium text-gray-700">
              {t('fieldStatus')}
            </label>
            <select
              id="trip-status"
              value={form.status}
              onChange={(event) => set('status', event.target.value as TripStatus)}
              disabled={statusLocked}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {/* The current value must still render, or a frozen `finished`
                  field would show the first option instead of the truth. */}
              {statusLocked && (
                <option value="finished">{t(TRIP_STATUS_STYLES.finished.label)}</option>
              )}
              {DISPATCH_SELECTABLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(TRIP_STATUS_STYLES[status].label)}
                </option>
              ))}
            </select>
          </div>

          {/* ★ STILL NO LORRY FIELD ON THE TRIP (ADR-0004) — the crew is typed
              in "Phương tiện điều độ" below, one row per PAIR. */}
          <CatalogueSelect
            id="trip-customer"
            label={t('fieldCustomer')}
            placeholder={t('addCustomer')}
            newPlaceholder={t('customerNamePlaceholder')}
            options={withCurrentReference(
              customers.map((customer) => ({ id: customer.id, label: customer.name })),
              currentCustomerOption(trip),
              cataloguesLoaded,
              t('statusArchived'),
            )}
            value={form.customerId}
            onChange={chooseCustomer}
            onCreate={async (name) => {
              const created = await createTripCustomer({ name });
              onCatalogueChanged();
              return { id: created.id, label: created.name };
            }}
          />
        </div>

        <p className="text-xs text-gray-500">{t('catalogueHint')}</p>

        <TextArea
          id="trip-cargo"
          label={t('fieldCargo')}
          value={form.cargoInfo}
          onChange={(value) => set('cargoInfo', value)}
        />

        {/*
          ★ THE TWO PRICES, DRAWN ONLY FOR SOMEBODY WHO MAY SEE THEM.

          Not disabled, not blanked — absent. A disabled field would tell a
          dispatcher that a figure exists and is being withheld, and the server
          goes to some trouble not to disclose even that: it sends `null` for
          both to such a caller, so an unpriced trip and a priced one look
          identical from here. Drawing a greyed box would undo that.

          ★ `MoneyInput`, NOT `type="number"`, on both. The state IS the payload
          — a plain decimal string — and the grouping comes from
          `formatWithCommas`, which lives between the field and the DOM. A
          number input would hand back a value the browser had already put
          through a float, which is exactly what `NUMERIC(14,2)` on the server
          exists to prevent.
        */}
        {mayPrice ? (
          <div className="grid gap-4 sm:grid-cols-2">
            

            <div className="space-y-2">
              <label htmlFor="trip-purchase-price" className="text-sm font-medium text-gray-700">
                {t('fieldPurchasePrice')}
              </label>
              {/*
                ★ AND THIS ONE IS NOT `required`, WHICH IS THE POINT OF SPLITTING
                THEM. Most runs go on our own lorries and are not bought from
                anybody, so an empty buying price is the ordinary case rather
                than an unfinished form.
              */}
              <MoneyInput
                id="trip-purchase-price"
                value={form.purchasePrice}
                onChange={(plain) => set('purchasePrice', plain)}
                aria-describedby="trip-purchase-price-hint"
              />
              <p id="trip-purchase-price-hint" className="text-xs text-gray-500">
                {t('purchasePriceHint')}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="trip-sell-price" className="text-sm font-medium text-gray-700">
                {t('fieldSellPrice')}
              </label>
              {/*
                ★ `required` ON CREATE ONLY, WHICH IS THE HALF OF THE RULE THE
                BROWSER CAN ENFORCE. A trip is priced when it is booked, so the
                figure is compulsory the first time — the server answers 422
                without it. On an EDIT the field may be emptied, because a price
                typed by mistake has to be removable by whoever may see it, and
                the PATCH route accepts an explicit clear.
              */}
              <MoneyInput
                id="trip-sell-price"
                value={form.sellPrice}
                onChange={(plain) => set('sellPrice', plain)}
                required={!editing}
                aria-describedby="trip-sell-price-hint"
              />
              <p id="trip-sell-price-hint" className="text-xs text-gray-500">
                {t('sellPriceHint')}
              </p>
            </div>
          </div>
        ) : (
          // Says the trip is saveable without a price, and does NOT say whether
          // this one has one. See the note above.
          <p className="text-xs text-gray-500">{t('priceRestricted')}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <LocationEnd
            end="pickup"
            label={t('fieldPickupLocation')}
            customerId={form.customerId}
            locations={locations.data ?? []}
            current={snapshotOf(trip, 'pickup')}
            chosen={placeAt('pickup')}
            value={form.pickupLocationId}
            onChange={(id) => set('pickupLocationId', id)}
            onAdd={() => setPlaceDialog({ end: 'pickup', editing: null })}
            onSetup={mayManagePlaces ? (location) => setPlaceDialog({ end: 'pickup', editing: location }) : null}
            address={form.pickupAddress}
            contact={form.pickupContact}
            onAddress={(value) => set('pickupAddress', value)}
            onContact={(value) => set('pickupContact', value)}
          />
          <LocationEnd
            end="delivery"
            label={t('fieldDeliveryLocation')}
            customerId={form.customerId}
            locations={locations.data ?? []}
            current={snapshotOf(trip, 'delivery')}
            chosen={placeAt('delivery')}
            value={form.deliveryLocationId}
            onChange={(id) => set('deliveryLocationId', id)}
            onAdd={() => setPlaceDialog({ end: 'delivery', editing: null })}
            onSetup={mayManagePlaces ? (location) => setPlaceDialog({ end: 'delivery', editing: location }) : null}
            address={form.deliveryAddress}
            contact={form.deliveryContact}
            onAddress={(value) => set('deliveryAddress', value)}
            onContact={(value) => set('deliveryContact', value)}
          />

          {/* ★ THE TRIP'S READINESS, IN ONE LINE, once there is a customer
              whose places could make it ready. Said here so the office sees
              it before the driver does. */}
          {form.customerId !== null ? <TripReadiness ready={tripLocationReady} /> : null}

          <div className="space-y-2">
            <label htmlFor="trip-pickup-at" className="text-sm font-medium text-gray-700">
              {t('fieldPickupAt')}
            </label>
            <Input
              id="trip-pickup-at"
              type="datetime-local"
              value={form.pickupAt}
              onChange={(event) => set('pickupAt', event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="trip-delivery-at" className="text-sm font-medium text-gray-700">
              {t('fieldDeliveryAt')}
            </label>
            {/*
              A full datetime, not a time. Delivery routinely lands on a LATER
              day than pickup — the sheet writes `08H30` in one cell and
              `09H00 SÁNG 04 AUG 2026` in the next — and a time-only control
              would force that into the note, where nothing can query it.
            */}
            <Input
              id="trip-delivery-at"
              type="datetime-local"
              value={form.deliveryAt}
              onChange={(event) => set('deliveryAt', event.target.value)}
              aria-describedby="trip-delivery-hint"
            />
            <p id="trip-delivery-hint" className="text-xs text-gray-500">
              {t('deliveryMayBeLater')}
            </p>
          </div>
        </div>

        {/* ★ THE CREW, TYPED WITH THE TRIP — AND STILL ONE ASSIGNMENT PER PAIR.
            This section is an INPUT SURFACE and nothing else: on save each row
            becomes its own `POST /trip-schedules/:id/driver-assignments`, which
            is the same canonical path the dispatch panel uses. The trip body
            carries no lorry, `trip_schedules.vehicle_id` is neither read nor
            written, and a trip saved with no rows is ordinary rather than
            incomplete.

            Only when CREATING: correcting an existing trip's crew is the
            dispatch panel's job, where a change can be ended with a reason and
            keep its history. */}
        {!editing && mayDispatch && (
          <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium text-gray-700">{t('dispatchTitle')}</legend>

            {crew.map((row, index) => (
              <div key={row.key} className="space-y-1">
                <div className="flex items-end gap-2">
                  <div className="grid flex-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label
                        htmlFor={`trip-crew-vehicle-${index}`}
                        className="text-sm font-medium text-gray-700"
                      >
                        {t('fieldVehicle')}
                      </label>
                      <select
                        id={`trip-crew-vehicle-${index}`}
                        value={row.vehicleId}
                        onChange={(event) => setCrewAt(row.key, { vehicleId: event.target.value })}
                        className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="">{t('dispatchSelectVehicle')}</option>
                        {vehicles
                          // Its OWN choice always stays: a select cannot show a
                          // value it has no option for.
                          .filter(
                            (vehicle) =>
                              vehicle.id === row.vehicleId || !takenVehicleIds.has(vehicle.id),
                          )
                          .map((vehicle) => (
                            <option key={vehicle.id} value={vehicle.id}>
                              {formatPlate(vehicle.plate)}
                            </option>
                          ))}
                      </select>
                    </div>
                    <DriverSelect
                      id={`trip-crew-driver-${index}`}
                      value={row.driverUserId}
                      onChange={(value) => setCrewAt(row.key, { driverUserId: value })}
                      options={drivers.data ?? []}
                      loading={drivers.isLoading}
                      // The row says what is wrong, in its own words — see `checkCrew`.
                      required={false}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeCrew(row.key)}
                  >
                    {t('dispatchRemove')}
                  </Button>
                </div>
                {row.error && (
                  <p role="alert" className="text-sm text-red-600">
                    {row.error}
                  </p>
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={addCrew}
              disabled={vehicles.length === 0}
            >
              <Plus className="h-4 w-4" />
              {t('dispatchAdd')}
            </Button>
          </fieldset>
        )}

        <TextArea
          id="trip-note"
          label={t('fieldNote')}
          value={form.note}
          onChange={(value) => set('note', value)}
        />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>

      {placeDialog && form.customerId ? (
        <LocationFormModal
          customerId={form.customerId}
          editing={placeDialog.editing}
          onClose={() => setPlaceDialog(null)}
          onSaved={placeSaved}
        />
      ) : null}
    </Modal>
  );
}

/** What the read-only block after a choice shows: an active place, or the trip's own copy of an archived one. */
interface ChosenPlace {
  id: string;
  name: string;
  address: string;
  contact: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Both halves present — the only readiness there is. The server stores them
 * both or neither. `!= null` on purpose: `?.` yields `undefined` for no place,
 * and that must read as "not located" exactly like a `null` coordinate.
 */
const isLocated = (place: ChosenPlace | null): boolean =>
  place?.latitude != null && place?.longitude != null;

/** The trip's readiness for location verification, in one line. Said here so the office sees it before the driver does. */
function TripReadiness({ ready }: Readonly<{ ready: boolean }>) {
  const { t } = useLanguage();
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600 sm:col-span-2">
      <span>{t('tripLocationReadiness')}:</span>
      <StatusPill tone={ready ? 'green' : 'amber'}>
        {t(ready ? 'tripLocationReady' : 'tripLocationNotReady')}
      </StatusPill>
    </p>
  );
}

type Translate = ReturnType<typeof useLanguage>['t'];
type PhraseKey = Parameters<Translate>[0];

/** The labels of the hand-typed fields, for the end with no place. */
const TYPED_FIELD_LABELS: Record<End, { address: PhraseKey; contact: PhraseKey }> = {
  pickup: { address: 'fieldPickupAddress', contact: 'fieldPickupContact' },
  delivery: { address: 'fieldDeliveryAddress', contact: 'fieldDeliveryContact' },
};

/** The empty option is "no place"; anything else is an id. */
const selectedId = (value: string): string | null => (value === '' ? null : value);

/**
 * The fix for the chosen place, or nothing. Only an ACTIVE row can be
 * corrected — an archived place is the trip's frozen copy, and the server
 * refuses edits to it anyway — and only by a caller who may.
 */
const setupActionFor = (
  onSetup: ((location: TripLocation) => void) | null,
  locations: TripLocation[],
  value: string | null,
): (() => void) | null => {
  if (!onSetup) return null;
  const target = locations.find((location) => location.id === value);
  return target ? () => onSetup(target) : null;
};

/**
 * The picker's rows: the customer's active places by name, and the trip's
 * own archived one after them. Readiness is not in the label — the pill
 * beside the picker says it the moment a place is chosen, and a suffix on
 * every row only made the names long enough to truncate.
 */
const placeOptions = (
  locations: TripLocation[],
  current: ChosenPlace | null,
  t: Translate,
): { id: string; label: string }[] => {
  const options = locations.map((location) => ({ id: location.id, label: location.name }));
  if (current && !locations.some((location) => location.id === current.id)) {
    options.push({ id: current.id, label: `${current.name} (${t('statusArchived')})` });
  }
  return options;
};

/**
 * One end of the trip: the customer's place, chosen — or, with none chosen,
 * the address typed by hand as before.
 *
 * ★ WHAT IS SHOWN AFTER A CHOICE IS READ-ONLY. The address and contact come
 * from the place and will be copied by the server; a dispatcher edits them on
 * the place, once, not on every trip. And "not located" is said here, before
 * the trip exists, so nobody is surprised at the pickup gate.
 */
function LocationEnd({
  end,
  label,
  customerId,
  locations,
  current,
  chosen,
  value,
  onChange,
  onAdd,
  onSetup,
  address,
  contact,
  onAddress,
  onContact,
}: Readonly<{
  end: End;
  label: string;
  customerId: string | null;
  locations: TripLocation[];
  /** The row's own place with the trip's snapshot of it, kept selectable and shown even when archived. */
  current: ChosenPlace | null;
  /** What this end will run against — the snapshot or the master row, as `placeFor` decides. */
  chosen: ChosenPlace | null;
  value: string | null;
  onChange: (id: string | null) => void;
  onAdd: () => void;
  /** Opens the place dialog on an unlocated ACTIVE place. `null` for a caller who may not correct places. */
  onSetup: ((location: TripLocation) => void) | null;
  address: string;
  contact: string;
  onAddress: (value: string) => void;
  onContact: (value: string) => void;
}>) {
  const { t } = useLanguage();
  const selectId = `trip-${end}-location`;
  const options = placeOptions(locations, current, t);
  const setup = setupActionFor(onSetup, locations, value);
  const typedLabels = TYPED_FIELD_LABELS[end];

  return (
    <div className="space-y-2" data-end={end}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={selectId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
        {/* ★ READINESS BESIDE THE PICKER, the moment a place is chosen. */}
        {chosen ? (
          <StatusPill tone={isLocated(chosen) ? 'green' : 'amber'}>
            {t(isLocated(chosen) ? 'locationLocated' : 'locationUnlocated')}
          </StatusPill>
        ) : null}
      </div>
      <div className="flex gap-2">
        <select
          id={selectId}
          value={value ?? ''}
          onChange={(event) => onChange(selectedId(event.target.value))}
          disabled={customerId === null}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">{customerId === null ? t('chooseCustomerFirst') : t('selectLocation')}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {/* A step lighter than the picker: adding a place is the exception, choosing one is the job. */}
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 text-gray-600"
          disabled={customerId === null}
          onClick={onAdd}
        >
          {t('addLocation')}
        </Button>
      </div>

      {customerId !== null && locations.length === 0 ? (
        <p className="text-xs text-gray-500">{t('emptyLocations')}</p>
      ) : null}

      {chosen ? (
        <ChosenPlaceCard chosen={chosen} labels={typedLabels} onSetup={setup} />
      ) : (
        <>
          <p className="text-xs text-gray-500">{t('noLocationSelected')}</p>
          <TextArea
            id={`trip-${end}-address`}
            label={t(typedLabels.address)}
            value={address}
            onChange={onAddress}
          />
          <TextArea
            id={`trip-${end}-contact`}
            label={t(typedLabels.contact)}
            value={contact}
            onChange={onContact}
          />
        </>
      )}
    </div>
  );
}

/**
 * The chosen place's address and contact, under the same labels the typed
 * fields carry, read-only — and the fix, where the person who may make it is
 * standing.
 *
 * ★ ONE SOURCE. What is printed here is the place — the master row for a
 * new choice, the trip's own snapshot for an unchanged one — and nothing on
 * this form can type a different address beside it. The server copies the
 * place onto the trip; the form sends no address for a named end.
 */
function ChosenPlaceCard({
  chosen,
  labels,
  onSetup,
}: Readonly<{
  chosen: ChosenPlace;
  labels: { address: PhraseKey; contact: PhraseKey };
  onSetup: (() => void) | null;
}>) {
  const { t } = useLanguage();

  return (
    <dl className="space-y-2">
      <div className="space-y-2">
        <dt className="text-sm font-medium text-gray-700">{t(labels.address)}</dt>
        <dd className="flex items-start gap-1.5 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
          <MapPin className="mt-0.5 size-4 shrink-0 text-gray-400" aria-hidden />
          <span>{chosen.address}</span>
        </dd>
      </div>
      {chosen.contact ? (
        <div className="space-y-2">
          <dt className="text-sm font-medium text-gray-700">{t(labels.contact)}</dt>
          <dd className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">{chosen.contact}</dd>
        </div>
      ) : null}
      {isLocated(chosen) ? null : (
        <div className="space-y-1.5">
          <output className="block text-xs font-medium text-amber-700">
            {t('locationUnlocatedWarning')}
          </output>
          {onSetup ? (
            <Button type="button" variant="outline" size="sm" onClick={onSetup}>
              <MapPin className="size-3.5" aria-hidden />
              {t('setupLocation')}
            </Button>
          ) : null}
        </div>
      )}
    </dl>
  );
}

/**
 * A multi-line field.
 *
 * A textarea rather than an input because the source data genuinely is
 * multi-line: the workbook's address cells hold a company name, a street, a
 * ward and a phone number on four lines, and the driver-contact cells hold a
 * name with a licence and a lorry number under it. Flattening those into one
 * line on the way in would lose the shape somebody reads them by.
 */
function TextArea({
  id,
  label,
  value,
  onChange,
}: Readonly<{ id: string; label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </div>
  );
}
