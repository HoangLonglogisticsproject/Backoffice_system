import { useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OffsetPagination } from '@/components/ui/pagination';
import { TripScheduleExportButton } from '@/components/trip/TripScheduleExportButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useTripCatalogue, useTripSchedules } from '@/hooks/trip';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { TripScheduleWithRefs } from '@/types/trip';
import { ArchiveTripDialog } from './components/ArchiveTripDialog';
import { DispatchPanel } from './components/DispatchPanel';
import { NoTripAccess } from './components/NoTripAccess';
import { TripCostModal } from './components/TripCostModal';
import { TripFormModal } from './components/TripFormModal';
import { OperationalBookingDialog } from './booking/OperationalBookingDialog';
import { TripRangeFilters } from './components/TripRangeFilters';
import { AssignmentTabs } from './schedule/AssignmentTabs';
import { BookingDetail } from './schedule/BookingDetail';
import { BookingList } from './schedule/BookingList';
import { useSelectedBooking } from './schedule/useSelectedBooking';

/**
 * Lịch xe — the workspace for bookings still to run or running: a list to scan
 * and the selected booking beside it. Finished trips are Lịch sử chuyến's.
 *
 * ★ ORCHESTRATION ONLY. The list, its filters and its page walk are
 * `useTripSchedules` — one query, the server's, unchanged by this screen; the
 * list and the panel render it; this component holds which booking is
 * selected and which dialog is open.
 *
 * ★ THE FILTERS ARE REAL AND THE PAGINATION IS THE OFFSET ONE (ADR-0003): the
 * range, the tab and the order all go to the server, and nothing here narrows
 * or sorts a page in the browser.
 */
export default function TripSchedulePage() {
  const { t } = useLanguage();
  const { can } = useSession();
  // Below this the side column is too narrow beside the app's sidebar, so the
  // detail opens as a dialog instead.
  const wide = useMediaQuery('(min-width: 1280px)');

  const trips = useTripSchedules('operational');
  // Customers and lorries for the form and the dispatch panel — small bounded
  // lists, read once per page; archived rows are left out.
  const catalogue = useTripCatalogue();
  const detail = useSelectedBooking(trips.items);
  const assigning = useSelectedBooking(trips.items);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TripScheduleWithRefs | null>(null);
  const [archiving, setArchiving] = useState<TripScheduleWithRefs | null>(null);
  const [costFor, setCostFor] = useState<string | null>(null);

  const openForm = (trip: TripScheduleWithRefs | null) => {
    setEditing(trip);
    setFormOpen(true);
  };

  // ★ THE SCREEN ITSELF SAYS NO, not only the menu: without `trip.read` every
  // read below is a 403.
  if (!can('trip.read')) return <NoTripAccess />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-blue-600" aria-hidden="true" />
          <h1 className="text-xl font-bold text-gray-900">{t('tripScheduleTitle')}</h1>
        </div>
        {can('trip.create') && (
          <Button onClick={() => openForm(null)} className="gap-2 bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            {t('addTrip')}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        {/* The tabs narrow what the date bar returns, so they sit above it; the
            export sits beside them, never inside a tablist. Only "tất cả" is a
            tab whose name matches what the file contains. */}
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-gray-100 px-4 pt-3">
          <AssignmentTabs value={trips.assignment} onChange={trips.setAssignment} unassignedCount={trips.unassignedCount} />
          {trips.assignment === 'all' && <TripScheduleExportButton range={trips.range} customer={trips.appliedCustomer} />}
        </div>
        <TripRangeFilters trips={trips} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <BookingList trips={trips} selectedId={detail.selected?.id ?? null} onSelect={detail.select} onArchive={setArchiving} />
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
        </section>

        <BookingDetail
          trip={detail.selected}
          wide={wide}
          onClose={detail.clear}
          onAssign={assigning.select}
          onEdit={openForm}
          onCosts={setCostFor}
        />
      </div>

      {/* "Thêm chuyến" books work still to run, in the booking workspace; a
          past run is recorded from Lịch sử chuyến instead. */}
      <OperationalBookingDialog
        isOpen={formOpen && editing === null}
        customers={catalogue.customers.items}
        vehicles={catalogue.vehicles.items}
        // Crewing on create is `dispatch.write`, which `trip.create` does not imply.
        mayDispatch={can('dispatch.write')}
        // `data` is null until the read lands; `items` cannot tell empty from unread.
        cataloguesLoaded={catalogue.customers.data !== null}
        onClose={() => setFormOpen(false)}
        onSaved={trips.reload}
        onCatalogueChanged={catalogue.reload}
      />
      {/* "Sửa" corrects a booking in the trip form, as before. */}
      <TripFormModal
        isOpen={formOpen && editing !== null}
        trip={editing}
        mode="operational"
        customers={catalogue.customers.items}
        vehicles={catalogue.vehicles.items}
        mayDispatch={can('dispatch.write')}
        cataloguesLoaded={catalogue.customers.data !== null}
        onClose={() => setFormOpen(false)}
        onSaved={trips.reload}
        onCatalogueChanged={catalogue.reload}
      />
      <TripCostModal tripId={costFor} onClose={() => setCostFor(null)} />
      <DispatchPanel trip={assigning.selected} vehicles={catalogue.vehicles.items} onClose={assigning.clear} />
      <ArchiveTripDialog trip={archiving} onClose={() => setArchiving(null)} onArchived={trips.reload} />
    </div>
  );
}
