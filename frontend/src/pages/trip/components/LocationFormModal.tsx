import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { createTripLocation, updateTripLocation } from '@/api/tripCatalogue';
import { isApiError } from '@/utils/errors';
import type { TripLocation } from '@/types/trip';

/**
 * One of a customer's places, entered or corrected.
 *
 * ★ ALWAYS UNDER ONE CUSTOMER. The dialog is opened with the customer it
 * belongs to and creates under that id; there is no customer picker here, so
 * a place cannot be filed under the wrong company by a slip.
 *
 * ★ COORDINATES ARE OPTIONAL, AND SAID SO. A place is real before anybody has
 * located it. The pair can be entered here — this is master data, entered
 * once — but the dialog says "not located" plainly when it is empty and never
 * pretends the system will find the point from the address: there is no map
 * provider in this deployment yet, and nothing here assumes one.
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

  const located = latitude.trim() !== '' && longitude.trim() !== '';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Field id="location-name" label={t('locationName')} value={name} onChange={setName} required />
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
          <p className="text-xs text-gray-500">{t('locationCoordinatesHint')}</p>
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
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </div>
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
