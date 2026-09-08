import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { createTripCustomer, createTripVehicle } from '@/api/tripCatalogue';
import {
  createTripSchedule,
  updateTripSchedule,
  type CreateTripInput,
  type UpdateTripInput,
} from '@/api/tripSchedule';
import { isApiError } from '@/utils/errors';
import { stripPlate } from '@/utils/format';
import {
  fromDateTimeLocalValue,
  todayAsCalendarDay,
  toDateTimeLocalValue,
} from '@/utils/format/datetime';
import { useTripLocations } from '@/hooks/trip';
import {
  DISPATCH_SELECTABLE_STATUSES,
  type TripCustomer,
  type TripLocation,
  type TripScheduleWithRefs,
  type TripStatus,
  type TripVehicle,
} from '@/types/trip';
import { CatalogueSelect } from './CatalogueSelect';
import { LocationFormModal } from './LocationFormModal';
import { TRIP_STATUS_STYLES } from './tripStatus';

interface TripFormModalProps {
  isOpen: boolean;
  /** Absent means "add". Present means "correct this row" — GLOBAL only. */
  trip?: TripScheduleWithRefs | null;
  vehicles: TripVehicle[];
  customers: TripCustomer[];
  /**
   * Have both catalogue reads come back?
   *
   * Needed only to tell "this truck is retired" from "the list has not loaded
   * yet" — the two look identical from an empty options array, and labelling an
   * active truck as archived for the first few hundred milliseconds would be a
   * statement that is simply untrue.
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
  vehicleId: string | null;
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
  vehicleId: null,
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
  vehicleId: trip.vehicleId,
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
  vehicles,
  customers,
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

  const editing = trip !== null;

  // Reloading the form when the dialog opens on a different row. Keyed on the
  // id rather than on the object, so an unrelated list refresh that produces a
  // new object for the same trip does not throw away what somebody is typing.
  useEffect(() => {
    if (!isOpen) return;
    setForm(trip ? formFor(trip) : emptyForm());
    setError(null);
  }, [isOpen, trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // ★ THE PLACES ARE THE CHOSEN CUSTOMER'S, AND NOBODY ELSE'S. Read for the
  // customer on the form; a place still selected after the customer changed
  // is dropped the moment the new list arrives without it, so a trip for
  // customer B can never quietly carry customer A's warehouse. The server
  // refuses that pairing anyway; this keeps the form honest before submit.
  const locations = useTripLocations(form.customerId);
  useEffect(() => {
    if (form.customerId === null) {
      if (form.pickupLocationId !== null || form.deliveryLocationId !== null) {
        setForm((current) => ({ ...current, pickupLocationId: null, deliveryLocationId: null }));
      }
      return;
    }
    if (locations.data === null) return;
    const known = new Set(locations.data.map((location) => location.id));
    // The row's own current places may be archived and absent from the active
    // list; they stay selectable on that trip exactly as a retired vehicle does
    // — but ONLY while the form still names the trip's own customer. Once the
    // customer changes they are another customer's places and are not known.
    if (trip && form.customerId === trip.customerId) {
      if (trip.pickupLocation) known.add(trip.pickupLocation.id);
      if (trip.deliveryLocation) known.add(trip.deliveryLocation.id);
    }
    setForm((current) => {
      const pickup = current.pickupLocationId && known.has(current.pickupLocationId) ? current.pickupLocationId : null;
      const delivery = current.deliveryLocationId && known.has(current.deliveryLocationId) ? current.deliveryLocationId : null;
      return pickup === current.pickupLocationId && delivery === current.deliveryLocationId
        ? current
        : { ...current, pickupLocationId: pickup, deliveryLocationId: delivery };
    });
  }, [form.customerId, form.pickupLocationId, form.deliveryLocationId, locations.data, trip]);

  /**
   * ★ A NEW CUSTOMER MEANS NO PLACE, YET. The places on the form were the old
   * customer's; both are cleared in the same state change as the customer, so
   * no render — and no submit — can pair customer B with customer A's place.
   * The server refuses that pairing anyway; this keeps the form honest.
   */
  const chooseCustomer = (id: string | null) =>
    setForm((current) =>
      current.customerId === id
        ? current
        : { ...current, customerId: id, pickupLocationId: null, deliveryLocationId: null },
    );

  /**
   * ★ THE ROW'S OWN PLACE, WITH THE TRIP'S SNAPSHOT OF IT. The active list does
   * not carry an archived place, but the trip still names it and still holds
   * what was copied from it. That copy is what the form shows for it — read
   * only, as for any chosen place — and the reference stays selected. Nothing
   * is reactivated and nothing is replaced; choosing another place or clearing
   * it is the dispatcher's to do.
   */
  const ownPlace = (end: 'pickup' | 'delivery'): ChosenPlace | null => {
    if (!trip) return null;
    if (end === 'pickup') {
      return trip.pickupLocation
        ? {
            ...trip.pickupLocation,
            address: trip.pickupAddress ?? '',
            contact: trip.pickupContact,
            latitude: trip.pickupLatitude ?? null,
            longitude: trip.pickupLongitude ?? null,
          }
        : null;
    }
    return trip.deliveryLocation
      ? {
          ...trip.deliveryLocation,
          address: trip.deliveryAddress ?? '',
          contact: trip.deliveryContact,
          latitude: trip.deliveryLatitude ?? null,
          longitude: trip.deliveryLongitude ?? null,
        }
      : null;
  };

  /** The place one end currently names: an active row, or the trip's own copy of an archived one. */
  const chosenFor = (end: 'pickup' | 'delivery'): ChosenPlace | null => {
    const value = end === 'pickup' ? form.pickupLocationId : form.deliveryLocationId;
    const own = ownPlace(end);
    return (locations.data ?? []).find((location) => location.id === value) ?? (own?.id === value ? own : null);
  };

  /**
   * ★ READINESS IS "HAS COORDINATES", AND NOTHING ELSE. The driver's
   * confirmation at an end is refused by the server unless the trip's
   * snapshot of that end carries a point, so a trip is ready for location
   * verification exactly when BOTH ends name a located place. A hand-typed
   * address has no point and counts as not ready — which is the truth the
   * driver would otherwise discover at the gate. Whether a driver's reading
   * later PASSES is a different fact, decided by the server.
   */
  const tripLocationReady = isLocated(chosenFor('pickup')) && isLocated(chosenFor('delivery'));

  /**
   * The place dialog, if open: which end asked for it, and — for "set up
   * location" — which existing place it corrects. One dialog for both jobs;
   * there is no second way to put coordinates on a place.
   */
  const [placeDialog, setPlaceDialog] = useState<{
    end: 'pickup' | 'delivery';
    editing: TripLocation | null;
  } | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    // `''` → `null`. See the header: this is what makes clearing a field
    // possible on the PATCH path.
    const blank = (value: string) => (value.trim() === '' ? null : value.trim());

    // ★ NO COORDINATE LEAVES THIS FORM. Each end names the customer's place,
    // and the server copies that place's address, contact and coordinates onto
    // the trip. The typed address and contact travel only for an end with no
    // place — the hand-typed path every trip took before places existed.
    //
    // ★ AN END WHOSE PLACE IS UNCHANGED IS NOT IN THE PATCH. The server copies
    // a place afresh only when the patch names it, and refuses to copy an
    // archived one — so an edit that leaves the place alone must not name it.
    // Otherwise correcting a note on a trip whose warehouse has since closed
    // would be refused, and on any other trip would quietly rewrite last
    // week's snapshot from today's master. Omitted, the trip's own copy — and
    // its reference, archived or not — stands. An end with no place is always
    // sent: its typed address may be what changed.
    const endFields = (end: 'pickup' | 'delivery'): UpdateTripInput => {
      const [id, was, address, contact] =
        end === 'pickup'
          ? [form.pickupLocationId, trip?.pickupLocationId, form.pickupAddress, form.pickupContact]
          : [form.deliveryLocationId, trip?.deliveryLocationId, form.deliveryAddress, form.deliveryContact];
      if (trip && id !== null && id === was) return {};
      return end === 'pickup'
        ? { pickupLocationId: id, pickupAddress: id ? null : blank(address), pickupContact: id ? null : blank(contact) }
        : { deliveryLocationId: id, deliveryAddress: id ? null : blank(address), deliveryContact: id ? null : blank(contact) };
    };
    const payload: CreateTripInput & UpdateTripInput = {
      scheduledOn: form.scheduledOn,
      vehicleId: form.vehicleId,
      customerId: form.customerId,
      cargoInfo: blank(form.cargoInfo),
      ...endFields('pickup'),
      ...endFields('delivery'),
      pickupAt: fromDateTimeLocalValue(form.pickupAt),
      deliveryAt: fromDateTimeLocalValue(form.deliveryAt),
      // ★ THE TWO PRICE KEYS ARE PRESENT ONLY FOR SOMEBODY WHO MAY SET THEM,
      // and this is the one place on the form where a key is dropped rather
      // than sent as `null`. For a viewer without the permission the server
      // REFUSES a body carrying either — it does not ignore them — so the
      // usual `'' → null` would turn every save they make into a 403.
      //
      // For a viewer who does hold it the ordinary rule applies: `''` → `null`
      // clears the figure, because a price typed by mistake has to be
      // removable. The selling price cannot be cleared on CREATE — the field is
      // `required` below and the server answers 422 — but it can on an edit.
      ...(mayPrice
        ? { sellPrice: blank(form.sellPrice), purchasePrice: blank(form.purchasePrice) }
        : {}),
      note: blank(form.note),
      status: form.status,
    };

    try {
      if (trip) {
        await updateTripSchedule(trip.id, payload);
      } else {
        await createTripSchedule(payload);
      }
      onSaved();
      onClose();
    } catch (error_) {
      // The server knows about retired vehicles, archived customers and the
      // date rules; this form does not, so its message is the honest one.
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
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

          <CatalogueSelect
            id="trip-vehicle"
            label={t('fieldVehicle')}
            placeholder={t('addVehicle')}
            newPlaceholder={t('platePlaceholder')}
            options={withCurrentReference(
              vehicles.map((vehicle) => ({ id: vehicle.id, label: vehicle.plate })),
              trip?.vehicle ? { id: trip.vehicle.id, label: trip.vehicle.plate } : null,
              cataloguesLoaded,
              t('statusArchived'),
            )}
            value={form.vehicleId}
            onChange={(id) => set('vehicleId', id)}
            onCreate={async (typed) => {
              // ★ THE PLAIN PLATE TRAVELS FROM HERE TOO. This is the second door
              // into the vehicle catalogue — a dispatcher adding a lorry without
              // leaving the trip form — and a plate created through it must land
              // in the same shape as one created on the master-data screen, or
              // the catalogue starts holding two spellings again.
              const created = await createTripVehicle({ plate: stripPlate(typed) });
              onCatalogueChanged();
              return { id: created.id, label: created.plate };
            }}
          />

          <CatalogueSelect
            id="trip-customer"
            label={t('fieldCustomer')}
            placeholder={t('addCustomer')}
            newPlaceholder={t('customerNamePlaceholder')}
            options={withCurrentReference(
              customers.map((customer) => ({ id: customer.id, label: customer.name })),
              trip?.customer ? { id: trip.customer.id, label: trip.customer.name } : null,
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
            current={ownPlace('pickup')}
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
            current={ownPlace('delivery')}
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
          {form.customerId !== null ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600 sm:col-span-2">
              <span>{t('tripLocationReadiness')}:</span>
              <StatusPill tone={tripLocationReady ? 'green' : 'amber'}>
                {t(tripLocationReady ? 'tripLocationReady' : 'tripLocationNotReady')}
              </StatusPill>
            </p>
          ) : null}

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
          onSaved={async (location) => {
            // The new place is the customer's and is selected where it was
            // asked for — AFTER the list has been re-read, so the effect that
            // drops unknown places never sees the new id before the list
            // that contains it. A place that was only CORRECTED is already
            // selected; the re-read list is what carries its coordinates.
            const { end, editing } = placeDialog;
            await locations.reload();
            if (!editing) set(end === 'pickup' ? 'pickupLocationId' : 'deliveryLocationId', location.id);
          }}
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

/** Both halves present — the only readiness there is. The server stores them both or neither. */
const isLocated = (place: ChosenPlace | null): boolean =>
  place !== null && place.latitude !== null && place.longitude !== null;

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
  value,
  onChange,
  onAdd,
  onSetup,
  address,
  contact,
  onAddress,
  onContact,
}: Readonly<{
  end: 'pickup' | 'delivery';
  label: string;
  customerId: string | null;
  locations: TripLocation[];
  /** The row's own place with the trip's snapshot of it, kept selectable and shown even when archived. */
  current: ChosenPlace | null;
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
  // An archived place is absent from the active list but is still the trip's
  // choice: it is shown from the trip's own copy, read-only like any other.
  const chosen: ChosenPlace | null =
    locations.find((location) => location.id === value) ?? (current?.id === value ? current : null);
  // ★ SAID IN THE PICKER, NOT ONLY AFTER THE CHOICE. A native `<select>` can
  // carry no badge, so the word goes in the label — a dispatcher sees which
  // places can be verified before picking one.
  const options: { id: string; label: string }[] = locations.map((location) => ({
    id: location.id,
    label: isLocated(location) ? location.name : `${location.name} (${t('locationUnlocated')})`,
  }));
  if (current && !locations.some((location) => location.id === current.id)) {
    options.push({ id: current.id, label: `${current.name} (${t('statusArchived')})` });
  }
  // Only an active row can be corrected; an archived place is the trip's
  // frozen copy, and the server refuses edits to it anyway.
  const setupTarget = onSetup ? (locations.find((location) => location.id === value) ?? null) : null;

  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          id={selectId}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
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
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
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
        <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <p className="flex items-start gap-1.5 whitespace-pre-wrap text-gray-800">
            <MapPin className="mt-0.5 size-4 shrink-0 text-gray-400" aria-hidden />
            <span>{chosen.address}</span>
          </p>
          {chosen.contact ? <p className="text-xs text-gray-600">{chosen.contact}</p> : null}
          {isLocated(chosen) ? (
            <StatusPill tone="green">{t('locationLocated')}</StatusPill>
          ) : (
            <div className="space-y-1.5">
              <StatusPill tone="amber">{t('locationUnlocated')}</StatusPill>
              <output className="block text-xs font-medium text-amber-700">
                {t('locationUnlocatedWarning')}
              </output>
              {/* The fix, where the person who may make it is standing. */}
              {setupTarget && onSetup ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onSetup(setupTarget)}>
                  <MapPin className="size-3.5" aria-hidden />
                  {t('setupLocation')}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500">{t('noLocationSelected')}</p>
          <TextArea
            id={`trip-${end}-address`}
            label={t(end === 'pickup' ? 'fieldPickupAddress' : 'fieldDeliveryAddress')}
            value={address}
            onChange={onAddress}
          />
          <TextArea
            id={`trip-${end}-contact`}
            label={t(end === 'pickup' ? 'fieldPickupContact' : 'fieldDeliveryContact')}
            value={contact}
            onChange={onContact}
          />
        </>
      )}
    </div>
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
