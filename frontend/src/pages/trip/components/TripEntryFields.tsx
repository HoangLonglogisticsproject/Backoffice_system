import { useLanguage } from '@/contexts/LanguageContext';
import { createTripCustomer } from '@/api/tripCatalogue';
import type { TripCustomer } from '@/types/trip';
import { currentCustomerOption, withCurrentReference } from '../entry/tripEntryModel';
import type { TripEntry } from '../entry/useTripEntryForm';
import { CatalogueSelect } from './CatalogueSelect';
import { TripTimeField } from './TripTimeField';

/**
 * The trip form's own fields, each bound to one `TripEntry` — the same
 * controls, ids, labels and rules whichever presentation lays them out
 * (`TripFormModal`, `OperationalBookingDialog`). The ends, the prices and the
 * crew have files of their own: `TripLocationFields`, `TripPriceFields`,
 * `TripCrewFields`.
 */

/** The customer: the catalogue's active rows, the row's own one kept, and "+" for a caller who may file one. */
export function CustomerField({
  entry,
  customers,
  cataloguesLoaded,
  onCatalogueChanged,
}: Readonly<{
  entry: TripEntry;
  customers: TripCustomer[];
  /** Has the customer catalogue read come back? Tells "archived" from "not loaded yet". */
  cataloguesLoaded: boolean;
  /** A new customer was filed from here; reload the lists. */
  onCatalogueChanged: () => void;
}>) {
  const { t } = useLanguage();
  return (
    // ★ STILL NO LORRY FIELD ON THE TRIP (ADR-0004) — the crew is typed in
    // "Phương tiện điều độ", one row per PAIR.
    <CatalogueSelect
      id="trip-customer"
      label={t('fieldCustomer')}
      placeholder={t('addCustomer')}
      newPlaceholder={t('customerNamePlaceholder')}
      options={withCurrentReference(
        customers.map((customer) => ({ id: customer.id, label: customer.name })),
        currentCustomerOption(entry.trip),
        cataloguesLoaded,
        t('statusArchived'),
      )}
      value={entry.form.customerId}
      onChange={entry.chooseCustomer}
      // ★ `customer.create`, NOT `trip.create` (DL-112): booking a run
      // and filing a customer are two keys, and a caller with only the
      // first gets a list with no "+". The server refuses the POST anyway.
      canCreate={entry.mayCreateCustomer}
      onCreate={async (name) => {
        const created = await createTripCustomer({ name });
        onCatalogueChanged();
        return { id: created.id, label: created.name };
      }}
    />
  );
}

/** "Ngày lấy hàng *" — the booking's day, bounded by the entry intent (`pickupControls`). */
export function PickupDateField({ entry }: Readonly<{ entry: TripEntry }>) {
  const { t } = useLanguage();
  return (
    <TripTimeField
      id="trip-date"
      label={t('fieldPickupDate')}
      type="date"
      value={entry.form.scheduledOn}
      onChange={(value) => entry.set('scheduledOn', value)}
      error={entry.fieldError('scheduledOn')}
      min={entry.pickup.dateMin}
      max={entry.pickup.dateMax}
      required
    />
  );
}

/** "Giờ lấy hàng" — required for today's booking, open on any later day (`pickupControls`). */
export function PickupHourField({ entry }: Readonly<{ entry: TripEntry }>) {
  return (
    <TripTimeField
      id="trip-pickup-time"
      label={entry.pickup.hourLabel}
      type="time"
      value={entry.form.pickupTime}
      onChange={(value) => entry.set('pickupTime', value)}
      error={entry.fieldError('pickupAt')}
      hint={entry.pickup.hourHint}
      required={entry.pickup.hourRequired}
      min={entry.pickup.hourMin}
    />
  );
}

/**
 * "Thời gian giao hàng" — a full datetime, not a time. Delivery routinely
 * lands on a LATER day than pickup — the sheet writes `08H30` in one cell and
 * `09H00 SÁNG 04 AUG 2026` in the next — and it must land AFTER it.
 */
export function DeliveryAtField({ entry }: Readonly<{ entry: TripEntry }>) {
  const { t } = useLanguage();
  return (
    <TripTimeField
      id="trip-delivery-at"
      label={t('fieldDeliveryDateTime')}
      type="datetime-local"
      value={entry.form.deliveryAt}
      onChange={(value) => entry.set('deliveryAt', value)}
      error={entry.fieldError('deliveryAt')}
      hint={t('deliveryMayBeLater')}
    />
  );
}

/** "Thông tin hàng". */
export function CargoField({ entry }: Readonly<{ entry: TripEntry }>) {
  const { t } = useLanguage();
  return (
    <TextArea
      id="trip-cargo"
      label={t('fieldCargo')}
      value={entry.form.cargoInfo}
      onChange={(value) => entry.set('cargoInfo', value)}
    />
  );
}

/** "Ghi chú". */
export function NoteField({ entry }: Readonly<{ entry: TripEntry }>) {
  const { t } = useLanguage();
  return (
    <TextArea id="trip-note" label={t('fieldNote')} value={entry.form.note} onChange={(value) => entry.set('note', value)} />
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
export function TextArea({
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
