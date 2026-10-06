import { useState } from 'react';
import { History, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OffsetPagination } from '@/components/ui/pagination';
import { TripScheduleExportButton } from '@/components/trip/TripScheduleExportButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useTripCatalogue, useTripSchedules } from '@/hooks/trip';
import type { TripScheduleWithRefs } from '@/types/trip';
import { cn } from '@/utils/cn';
import { isApiError } from '@/utils/errors';
import { notifySuccess } from '@/utils/toast';
import { ArchiveTripDialog } from './components/ArchiveTripDialog';
import { NoTripAccess } from './components/NoTripAccess';
import { TripCostModal } from './components/TripCostModal';
import { TripFormModal } from './components/TripFormModal';
import { TripHistoryTable } from './components/TripHistoryTable';
import { TripRangeFilters } from './components/TripRangeFilters';
import { BookingExportDialog } from './schedule/export/BookingExportDialog';

/**
 * Lịch sử chuyến — the trips that ran AND were closed.
 *
 * ★ A PROJECTION OF THE SAME TRIPS AS LỊCH XE, NOT A SECOND KIND OF TRIP. The
 * server splits them at the canonical `finished` (`?lifecycle=history`); a trip
 * lands here when its completion is approved, and an overdue trip nobody has
 * closed stays on Lịch xe however old its date. Same list hook, same filters,
 * same export, same pagination — only the question differs.
 *
 * ★ "NHẬP CHUYẾN CŨ" IS THE SAME FORM AND THE SAME `POST /trip-schedules`, with
 * the create intent `historical`: a past day is accepted, a future one is not,
 * every other rule holds — and the SERVER records the trip finished, so it
 * lists here the moment it is saved and never on Lịch xe.
 */
export default function TripHistoryPage() {
  const { t } = useLanguage();
  const { can } = useSession();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TripScheduleWithRefs | null>(null);
  const [archiving, setArchiving] = useState<TripScheduleWithRefs | null>(null);
  const [costFor, setCostFor] = useState<string | null>(null);
  const [exportFor, setExportFor] = useState<string | null>(null);

  const trips = useTripSchedules('history');
  const catalogue = useTripCatalogue();

  if (!can('trip.read')) return <NoTripAccess />;

  const openForm = (trip: TripScheduleWithRefs | null) => {
    setEditing(trip);
    setFormOpen(true);
  };

  const saved = () => {
    trips.reload();
    if (editing === null) notifySuccess('importTripSaved');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-blue-600" aria-hidden="true" />
          <h1 className="text-xl font-bold text-gray-900">{t('tripHistoryTitle')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('trip.create') && (
            <Button onClick={() => openForm(null)} className="h-9 gap-2 bg-blue-600 text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              {t('importTrip')}
            </Button>
          )}
          <TripScheduleExportButton range={trips.range} lifecycle="history" customer={trips.appliedCustomer} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <TripRangeFilters trips={trips} />

        <div className={cn('overflow-x-auto transition-opacity', trips.showingPreviousPage && 'opacity-60')}>
          <TripHistoryTable
            rows={trips.items}
            firstRowNumber={trips.firstRowNumber}
            onEdit={openForm}
            onArchive={setArchiving}
            onCost={setCostFor}
            onExport={setExportFor}
          />

          {!trips.loading && trips.items.length === 0 && !trips.error && (
            <p className="px-6 py-10 text-center text-sm text-gray-500">{t('emptyTripHistory')}</p>
          )}
          {trips.forbidden && (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
              <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
            </div>
          )}
          {trips.error && !trips.forbidden && (
            <p className="px-6 py-10 text-center text-sm text-red-600">
              {isApiError(trips.error) ? trips.error.message : t('loadFailed')}
            </p>
          )}
        </div>

        <OffsetPagination
          page={trips.page}
          totalPages={trips.totalPages}
          total={trips.total}
          onGoToPage={trips.goToPage}
          onNext={trips.next}
          onPrevious={trips.previous}
          pageSize={trips.pageSize}
          onPageSizeChange={trips.setPageSize}
          isLoading={trips.loading}
          className="border-t border-gray-100 bg-gray-50/30"
        />
      </div>

      <TripFormModal
        isOpen={formOpen}
        trip={editing}
        mode="historical"
        customers={catalogue.customers.items}
        vehicles={catalogue.vehicles.items}
        mayDispatch={can('dispatch.write')}
        cataloguesLoaded={catalogue.customers.data !== null}
        onClose={() => setFormOpen(false)}
        onSaved={saved}
        onCatalogueChanged={catalogue.reload}
      />
      <TripCostModal tripId={costFor} onClose={() => setCostFor(null)} />
      {exportFor && <BookingExportDialog tripId={exportFor} onClose={() => setExportFor(null)} />}
      <ArchiveTripDialog trip={archiving} onClose={() => setArchiving(null)} onArchived={trips.reload} />
    </div>
  );
}
