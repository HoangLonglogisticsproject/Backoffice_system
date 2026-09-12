import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { LocationCatalogueTable } from '@/components/trip/LocationCatalogueTable';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { archiveTripLocationById } from '@/api/tripCatalogue';
import { useAllTripLocations } from '@/hooks/trip';
import { isApiError } from '@/utils/errors';
import type { TripLocationListing } from '@/types/trip';
import { LocationFormModal } from './components/LocationFormModal';

/**
 * The places the board dispatches to, as one list.
 *
 * ★ A SECOND DOOR, NOT A REPLACEMENT. A customer's places are still reachable
 * from the customer's own row on the master data screen, which is the right
 * door when somebody is already working with that customer. This screen is the
 * other question — "where do we run to, and what is the address of the one
 * everyone calls Cảng Cát Lái" — and it is the ONLY place a SHARED place can
 * be created, because a shared place has no customer row to hang off.
 *
 * ★ THE FILTER IS CLIENT-SIDE, AND THAT IS A SIZE DECISION RATHER THAN A
 * SHORTCUT. The whole catalogue arrives in one read — it is a catalogue, not a
 * ledger, the same argument that leaves the vehicle and customer lists
 * unpaginated — so narrowing it costs a comparison per row and a round trip per
 * keystroke is the alternative.
 */

/** The owner filter: everything, the shared ones, or one customer's. */
type OwnerFilter = { kind: 'all' } | { kind: 'shared' } | { kind: 'customer'; id: string };

const SHARED = 'shared';
const ALL = 'all';

const matches = (location: TripLocationListing, filter: OwnerFilter): boolean => {
  if (filter.kind === ALL) return true;
  if (filter.kind === SHARED) return location.customerId === null;
  return location.customerId === filter.id;
};

export default function LocationCataloguePage() {
  const { t } = useLanguage();
  const { can } = useSession();

  /**
   * ★ READ, NEVER WRITTEN — the two filters this screen stopped OFFERING.
   * They still decide what is read and what is shown, so removing them would
   * change behaviour rather than just hide a control: archived rows stay out,
   * and every owner is listed. Restore the filter bar below to move them again.
   */
  const [includeArchived] = useState(false);
  const [owner] = useState<OwnerFilter>({ kind: ALL });

  const locations = useAllTripLocations(includeArchived);

  const canManage = can('trip.write');
  const canAdd = can('trip.create');

  /**
   * ★ THE DIALOG'S STATE IS WHAT IT IS FOR, NOT A PAIR OF BOOLEANS. `null` is
   * closed; `{ editing: null }` adds a SHARED place; `{ editing: row }`
   * corrects that row, whoever owns it.
   */
  const [form, setForm] = useState<{ editing: TripLocationListing | null } | null>(null);
  const [archiving, setArchiving] = useState<TripLocationListing | null>(null);
  /** An archive request in flight. Both confirmation controls are held while it is. */
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => locations.items.filter((location) => matches(location, owner)),
    [locations.items, owner],
  );

  const archive = async () => {
    if (!archiving || archiveBusy) return;
    setArchiveBusy(true);
    setError(null);
    try {
      await archiveTripLocationById(archiving.id);
      setArchiving(null);
      await locations.reload();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('locationCatalogue')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('locationCatalogueHint')}</p>
        </div>
        {canAdd && (
          <Button className="gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => setForm({ editing: null })}>
            <Plus className="size-4" />
            {t('addSharedLocation')}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        {/* ★ THE FILTER BAR IS OUT, AND WITH IT ITS CONTAINER. An empty bar
            still draws its bottom border, so leaving the wrapper behind hangs
            a blank strip above the table. Restore both together. */}

        {locations.loading ? (
          <p className="py-10 text-center text-sm text-gray-500">{t('loading')}</p>
        ) : null}

        {!locations.loading && locations.error ? (
          <p role="alert" className="py-10 text-center text-sm text-red-600">
            {locations.error.message}
          </p>
        ) : null}

        {!locations.loading && !locations.error && rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">{t('emptyLocationCatalogue')}</p>
        ) : null}

        {!locations.loading && rows.length > 0 ? (
          <LocationCatalogueTable
            rows={rows}
            canManage={canManage}
            onEdit={(location) => setForm({ editing: location })}
            onArchive={setArchiving}
          />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {form ? (
        <LocationFormModal
          // ★ A NEW ROW FROM HERE IS SHARED; AN EDIT KEEPS WHOEVER OWNS IT.
          // The dialog patches by id, so the customer it is handed matters only
          // when it is creating — and this screen only ever creates shared ones.
          customerId={null}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={() => locations.reload()}
        />
      ) : null}

      {archiving ? (
        <Modal
          isOpen
          onClose={() => (archiveBusy ? undefined : setArchiving(null))}
          title={t('archiveLocationConfirm')}
          footer={
            <>
              <Button
                variant="outline"
                type="button"
                disabled={archiveBusy}
                onClick={() => setArchiving(null)}
              >
                {t('cancel')}
              </Button>
              <Button type="button" disabled={archiveBusy} onClick={() => void archive()}>
                {archiveBusy ? t('saving') : t('archive')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{t('confirmArchiveLocationBody')}</p>
            <p className="text-sm font-medium text-gray-900">{archiving.name}</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
