import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { createTripCustomer, createTripVehicle } from '@/api/tripCatalogue';
import {
  createTripSchedule,
  updateTripSchedule,
  type CreateTripInput,
  type UpdateTripInput,
} from '@/api/tripSchedule';
import { isApiError } from '@/utils/errors';
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
  note: '',
  status: 'awaiting_production',
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

  /** Which end a "new place" dialog was opened for; the new place is selected there on save. */
  const [addingFor, setAddingFor] = useState<'pickup' | 'delivery' | null>(null);

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
    const payload: CreateTripInput & UpdateTripInput = {
      scheduledOn: form.scheduledOn,
      vehicleId: form.vehicleId,
      customerId: form.customerId,
      cargoInfo: blank(form.cargoInfo),
      pickupLocationId: form.pickupLocationId,
      deliveryLocationId: form.deliveryLocationId,
      pickupAddress: form.pickupLocationId ? null : blank(form.pickupAddress),
      deliveryAddress: form.deliveryLocationId ? null : blank(form.deliveryAddress),
      pickupContact: form.pickupLocationId ? null : blank(form.pickupContact),
      deliveryContact: form.deliveryLocationId ? null : blank(form.deliveryContact),
      pickupAt: fromDateTimeLocalValue(form.pickupAt),
      deliveryAt: fromDateTimeLocalValue(form.deliveryAt),
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
   * ★ `done` IS TERMINAL, AND IT IS ALSO UNREACHABLE FROM HERE (BD-01).
   *
   * Two rules, not one. A finished trip's status is frozen because the server
   * refuses every move away from it. And `done` is absent from the options on
   * EVERY trip — new or existing — because a trip is finished by approving its
   * completion request, never by editing a field: `requireNotCompletionOnly`
   * refuses it on create and on update alike, and a trigger in 0017 makes the
   * state permanent once it is reached.
   *
   * Every other field of a finished trip stays editable. Whether a closed trip
   * should be read-only in full is a separate decision nobody has taken, and
   * this is not the place to take it.
   */
  const statusLocked = trip?.status === 'done';

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
              {/* The current value must still render, or a frozen `done` field
                  would show the first option instead of the truth. */}
              {statusLocked && (
                <option value="done">{t(TRIP_STATUS_STYLES.done.label)}</option>
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
            onCreate={async (plate) => {
              const created = await createTripVehicle({ plate });
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

        <div className="grid gap-4 sm:grid-cols-2">
          <LocationEnd
            end="pickup"
            label={t('fieldPickupLocation')}
            customerId={form.customerId}
            locations={locations.data ?? []}
            current={trip?.pickupLocation ?? null}
            value={form.pickupLocationId}
            onChange={(id) => set('pickupLocationId', id)}
            onAdd={() => setAddingFor('pickup')}
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
            current={trip?.deliveryLocation ?? null}
            value={form.deliveryLocationId}
            onChange={(id) => set('deliveryLocationId', id)}
            onAdd={() => setAddingFor('delivery')}
            address={form.deliveryAddress}
            contact={form.deliveryContact}
            onAddress={(value) => set('deliveryAddress', value)}
            onContact={(value) => set('deliveryContact', value)}
          />

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

      {addingFor && form.customerId ? (
        <LocationFormModal
          customerId={form.customerId}
          editing={null}
          onClose={() => setAddingFor(null)}
          onSaved={async (location) => {
            // The new place is the customer's and is selected where it was
            // asked for — AFTER the list has been re-read, so the effect that
            // drops unknown places never sees the new id before the list
            // that contains it.
            const end = addingFor;
            await locations.reload();
            set(end === 'pickup' ? 'pickupLocationId' : 'deliveryLocationId', location.id);
          }}
        />
      ) : null}
    </Modal>
  );
}

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
  address,
  contact,
  onAddress,
  onContact,
}: Readonly<{
  end: 'pickup' | 'delivery';
  label: string;
  customerId: string | null;
  locations: TripLocation[];
  /** The row's own place, kept selectable even when archived. */
  current: { id: string; name: string } | null;
  value: string | null;
  onChange: (id: string | null) => void;
  onAdd: () => void;
  address: string;
  contact: string;
  onAddress: (value: string) => void;
  onContact: (value: string) => void;
}>) {
  const { t } = useLanguage();
  const selectId = `trip-${end}-location`;
  const chosen = locations.find((location) => location.id === value) ?? null;
  const options = locations.some((location) => location.id === current?.id) || !current
    ? locations
    : [...locations, { id: current.id, name: `${current.name} (${t('statusArchived')})` } as TripLocation];

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
          {options.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
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
          {chosen.latitude !== null ? (
            <p className="text-xs text-green-700">{t('locationLocated')}</p>
          ) : (
            <output className="block text-xs font-medium text-amber-700">
              {t('locationUnlocatedWarning')}
            </output>
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
