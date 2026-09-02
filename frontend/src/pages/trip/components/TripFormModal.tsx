import { useEffect, useState } from 'react';
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
import { DISPATCH_SELECTABLE_STATUSES, type TripCustomer, type TripScheduleWithRefs, type TripStatus, type TripVehicle } from '@/types/trip';
import { CatalogueSelect } from './CatalogueSelect';
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
  /** As typed. `''` is "no point"; the server refuses one half without the other. */
  pickupLatitude: string;
  pickupLongitude: string;
  deliveryLatitude: string;
  deliveryLongitude: string;
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
  pickupLatitude: '',
  pickupLongitude: '',
  deliveryLatitude: '',
  deliveryLongitude: '',
  note: '',
  status: 'awaiting_production',
});

/** A number as the input holds it. `String(null)` is `"null"`, so not that. */
const numberField = (value: number | null): string => (value === null ? '' : String(value));

/** Back again. An empty box is `null` — a cleared coordinate, not zero. */
const numberOrNull = (value: string): number | null =>
  value.trim() === '' ? null : Number(value);

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
  pickupLatitude: numberField(trip.pickupLatitude),
  pickupLongitude: numberField(trip.pickupLongitude),
  deliveryLatitude: numberField(trip.deliveryLatitude),
  deliveryLongitude: numberField(trip.deliveryLongitude),
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

    const payload: CreateTripInput & UpdateTripInput = {
      scheduledOn: form.scheduledOn,
      vehicleId: form.vehicleId,
      customerId: form.customerId,
      cargoInfo: blank(form.cargoInfo),
      pickupAddress: blank(form.pickupAddress),
      deliveryAddress: blank(form.deliveryAddress),
      pickupContact: blank(form.pickupContact),
      deliveryContact: blank(form.deliveryContact),
      pickupAt: fromDateTimeLocalValue(form.pickupAt),
      deliveryAt: fromDateTimeLocalValue(form.deliveryAt),
      pickupLatitude: numberOrNull(form.pickupLatitude),
      pickupLongitude: numberOrNull(form.pickupLongitude),
      deliveryLatitude: numberOrNull(form.deliveryLatitude),
      deliveryLongitude: numberOrNull(form.deliveryLongitude),
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
            onChange={(id) => set('customerId', id)}
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
          <TextArea
            id="trip-pickup-address"
            label={t('fieldPickupAddress')}
            value={form.pickupAddress}
            onChange={(value) => set('pickupAddress', value)}
          />
          <TextArea
            id="trip-delivery-address"
            label={t('fieldDeliveryAddress')}
            value={form.deliveryAddress}
            onChange={(value) => set('deliveryAddress', value)}
          />
          <TextArea
            id="trip-pickup-contact"
            label={t('fieldPickupContact')}
            value={form.pickupContact}
            onChange={(value) => set('pickupContact', value)}
          />
          <TextArea
            id="trip-delivery-contact"
            label={t('fieldDeliveryContact')}
            value={form.deliveryContact}
            onChange={(value) => set('deliveryContact', value)}
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

        {/*
          ★ NUMBERS BESIDE A PROSE ADDRESS, AND THAT IS THE POINT (GAP-14). The
          address is what a person reads; the pair is what the server measures
          the driver's GPS against when they confirm the pickup. Native number
          inputs with the axis bounds — the server and the database both refuse
          the range again, and refuse one half without the other.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <CoordinateFields
            idPrefix="trip-pickup"
            label={t('fieldPickupLocation')}
            latitude={form.pickupLatitude}
            longitude={form.pickupLongitude}
            onLatitude={(value) => set('pickupLatitude', value)}
            onLongitude={(value) => set('pickupLongitude', value)}
          />
          <CoordinateFields
            idPrefix="trip-delivery"
            label={t('fieldDeliveryLocation')}
            latitude={form.deliveryLatitude}
            longitude={form.deliveryLongitude}
            onLatitude={(value) => set('deliveryLatitude', value)}
            onLongitude={(value) => set('deliveryLongitude', value)}
          />
        </div>
        <p className="text-xs text-gray-500">{t('coordinatesHint')}</p>

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
    </Modal>
  );
}

/** One point: two bounded number inputs under one heading. */
function CoordinateFields({
  idPrefix,
  label,
  latitude,
  longitude,
  onLatitude,
  onLongitude,
}: Readonly<{
  idPrefix: string;
  label: string;
  latitude: string;
  longitude: string;
  onLatitude: (value: string) => void;
  onLongitude: (value: string) => void;
}>) {
  const { t } = useLanguage();

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-gray-700">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Input
          id={`${idPrefix}-latitude`}
          type="number"
          inputMode="decimal"
          step="any"
          min={-90}
          max={90}
          placeholder={t('fieldLatitude')}
          aria-label={`${label} — ${t('fieldLatitude')}`}
          value={latitude}
          onChange={(event) => onLatitude(event.target.value)}
        />
        <Input
          id={`${idPrefix}-longitude`}
          type="number"
          inputMode="decimal"
          step="any"
          min={-180}
          max={180}
          placeholder={t('fieldLongitude')}
          aria-label={`${label} — ${t('fieldLongitude')}`}
          value={longitude}
          onChange={(event) => onLongitude(event.target.value)}
        />
      </div>
    </fieldset>
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
