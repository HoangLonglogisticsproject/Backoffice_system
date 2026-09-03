import { useState } from 'react';
import { Archive, MapPin, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { archiveTripLocation } from '@/api/tripCatalogue';
import { useTripLocations } from '@/hooks/trip';
import { isApiError } from '@/utils/errors';
import { cn } from '@/utils/cn';
import type { TripLocation } from '@/types/trip';
import { LocationFormModal } from './LocationFormModal';

/**
 * The places of ONE customer, managed where the customer is.
 *
 * ★ NOT A CATALOGUE OF ITS OWN. There is no "all locations" screen and no
 * sidebar entry: a place only means something under its customer, so that is
 * the only door to it. Archive rather than delete — a trip that went there
 * keeps its snapshot and its reference.
 */
interface Props {
  customer: { id: string; name: string };
  canAdd: boolean;
  canManage: boolean;
  onClose: () => void;
}

export function CustomerLocationsModal({ customer, canAdd, canManage, onClose }: Readonly<Props>) {
  const { t } = useLanguage();
  const [includeArchived, setIncludeArchived] = useState(false);
  const locations = useTripLocations(customer.id, includeArchived);
  const [form, setForm] = useState<{ editing: TripLocation | null } | null>(null);
  const [archiving, setArchiving] = useState<TripLocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const archive = async () => {
    if (!archiving) return;
    setError(null);
    try {
      await archiveTripLocation(customer.id, archiving.id);
      setArchiving(null);
      locations.reload();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${t('locationsTitle')} — ${customer.name}`}
      className="max-w-2xl"
      footer={
        <Button variant="outline" type="button" onClick={onClose}>
          {t('close')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            {t('locationsTitle')} ({locations.items.length})
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            {t('showArchived')}
          </label>
        </div>

        {locations.loading ? (
          <p className="py-6 text-center text-sm text-gray-500">{t('loading')}</p>
        ) : null}

        {!locations.loading && locations.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">{t('emptyLocations')}</p>
        ) : null}

        {locations.items.length > 0 ? (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {locations.items.map((location) => {
              const archived = location.status !== 'active';
              const located = location.latitude !== null;
              return (
                <li
                  key={location.id}
                  className={cn('flex items-start gap-3 px-3 py-2', archived && 'opacity-60')}
                >
                  <MapPin className="mt-1 size-4 shrink-0 text-gray-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{location.name}</p>
                    <p className="whitespace-pre-wrap text-xs text-gray-600">{location.address}</p>
                    {location.contact ? (
                      <p className="text-xs text-gray-500">{location.contact}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                      archived
                        ? 'bg-gray-50 text-gray-600 ring-gray-500/10'
                        : located
                          ? 'bg-green-50 text-green-700 ring-green-600/20'
                          : 'bg-amber-50 text-amber-700 ring-amber-600/20',
                    )}
                  >
                    {t(archived ? 'statusArchived' : located ? 'locationLocated' : 'locationUnlocated')}
                  </span>
                  {canManage && !archived ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-gray-600"
                        onClick={() => setForm({ editing: location })}
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only">{t('edit')}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-gray-600"
                        onClick={() => setArchiving(location)}
                      >
                        <Archive className="size-3.5" />
                        <span className="sr-only">{t('archive')}</span>
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {canAdd ? (
          <Button
            variant="outline"
            className="gap-1"
            onClick={() => setForm({ editing: null })}
          >
            <Plus className="size-4" />
            {t('addLocation')}
          </Button>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {archiving ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <span>
              {t('archiveLocationConfirm')} <strong>{archiving.name}</strong>?
            </span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setArchiving(null)}>
                {t('cancel')}
              </Button>
              <Button size="sm" onClick={() => void archive()}>
                {t('archive')}
              </Button>
            </span>
          </div>
        ) : null}
      </div>

      {form ? (
        <LocationFormModal
          customerId={customer.id}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={() => locations.reload()}
        />
      ) : null}
    </Modal>
  );
}
