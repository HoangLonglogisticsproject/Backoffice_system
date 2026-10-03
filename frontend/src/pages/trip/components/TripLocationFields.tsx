import { MapPin } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripLocation } from '@/types/trip';
import type { End } from '../entry/tripEntryModel';
import { isLocated, type ChosenPlace } from '../entry/tripEntryPlaces';
import type { TripEntry } from '../entry/useTripEntryForm';
import { LocationFormModal } from './LocationFormModal';
import { TextArea } from './TripEntryFields';

/**
 * One end of the trip — the customer's place, or an address typed by hand —
 * with the place dialog behind "Thêm địa điểm" / "Thiết lập vị trí" and the
 * readiness of the driver's location checks. Bound to one `TripEntry`.
 */

/** One end of the trip, wired: the customer's place, or the address typed by hand — see `LocationEnd`. */
export function TripEnd({ entry, end }: Readonly<{ entry: TripEntry; end: End }>) {
  const { t } = useLanguage();
  const pickup = end === 'pickup';
  return (
    <LocationEnd
      end={end}
      label={t(pickup ? 'fieldPickupLocation' : 'fieldDeliveryLocation')}
      customerId={entry.form.customerId}
      locations={entry.locations.data ?? []}
      current={entry.snapshotAt(end)}
      chosen={entry.placeAt(end)}
      value={pickup ? entry.form.pickupLocationId : entry.form.deliveryLocationId}
      onChange={(id) => entry.set(pickup ? 'pickupLocationId' : 'deliveryLocationId', id)}
      canAdd={entry.mayCreatePlace}
      onAdd={() => entry.setPlaceDialog({ end, editing: null })}
      onSetup={setupHandlerFor(entry.mayManagePlaces, end, entry.setPlaceDialog)}
      address={pickup ? entry.form.pickupAddress : entry.form.deliveryAddress}
      contact={pickup ? entry.form.pickupContact : entry.form.deliveryContact}
      onAddress={(value) => entry.set(pickup ? 'pickupAddress' : 'deliveryAddress', value)}
      onContact={(value) => entry.set(pickup ? 'pickupContact' : 'deliveryContact', value)}
    />
  );
}

/**
 * The place dialog, if open — a new place for an end, or the fix for an
 * unlocated one. One dialog for both jobs; there is no second way to put
 * coordinates on a place.
 */
export function PlaceDialog({ entry }: Readonly<{ entry: TripEntry }>) {
  if (!entry.placeDialog || !entry.form.customerId) return null;
  return (
    <LocationFormModal
      customerId={entry.form.customerId}
      editing={entry.placeDialog.editing}
      onClose={() => entry.setPlaceDialog(null)}
      onSaved={entry.placeSaved}
    />
  );
}

/**
 * ★ THE TRIP'S READINESS, IN ONE LINE, once there is a customer whose places
 * could make it ready. Said here so the office sees it before the driver does.
 */
export function TripLocationReadiness({ entry }: Readonly<{ entry: TripEntry }>) {
  return entry.form.customerId === null ? null : <TripReadiness ready={entry.tripLocationReady} />;
}

/**
 * The "set up location" handler for one end, or null for a caller who may not
 * correct places — `LocationEnd` draws no control for null.
 */
const setupHandlerFor = (
  mayManagePlaces: boolean,
  end: End,
  open: (dialog: { end: End; editing: TripLocation | null }) => void,
): ((location: TripLocation) => void) | null =>
  mayManagePlaces ? (location) => open({ end, editing: location }) : null;

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
  canAdd,
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
  /** May this caller add a place (`location.create`)? False draws no control. */
  canAdd: boolean;
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
        {canAdd && (
          <Button
            type="button"
            variant="ghost"
            className="shrink-0 text-gray-600"
            disabled={customerId === null}
            onClick={onAdd}
          >
            {t('addLocation')}
          </Button>
        )}
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
