import { useState } from 'react';
import { Archive, Pencil, Plus, Truck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { OffsetPagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useTripCatalogue, useTripSchedules } from '@/hooks/trip';
import { archiveTripSchedule } from '@/api/tripSchedule';
import { isApiError } from '@/utils/errors';
import { cn } from '@/utils/cn';
import { formatCalendarDay, formatDateTime } from '@/utils/format/datetime';
import type { TripScheduleWithRefs } from '@/types/trip';
import { TripFormModal } from './components/TripFormModal';
import { TripStatusBadge } from './components/TripStatusBadge';
import { TripStatusSelect } from './components/TripStatusSelect';
import { TripCostModal } from './components/TripCostModal';
import { DriverAssignModal } from './components/DriverAssignModal';

/**
 * The dispatch board — the screen that replaces `LỊCH XE - CHI PHÍ XE.xlsx`.
 *
 * ★ THE FILTER BAR HERE IS REAL. `EmployeeManagementPage` renders its filters
 * inside a disabled `<fieldset>` because the members endpoint accepts only
 * `limit` and `cursor`; this endpoint accepts `from` and `to`, so these inputs
 * actually narrow the query on the server. Do not copy the disabled pattern
 * here, and do not filter the returned page in the browser — a page is not the
 * result set, so client-side filtering would hide rows without saying so.
 *
 * ★ AND THE PAGINATION IS THE OFFSET ONE. This is the only screen in the app
 * that can honestly show "page 2 of 3" and a total, because its date range
 * bounds the query (ADR-0003). Everything else uses `CursorPagination`.
 */
export default function TripSchedulePage() {
  const { t, language } = useLanguage();
  const { can } = useSession();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TripScheduleWithRefs | null>(null);
  const [archiving, setArchiving] = useState<TripScheduleWithRefs | null>(null);

  const canAdd = can('trip.create');
  const canManage = can('trip.write');
  // ★ A SEPARATE PERMISSION, AND A SEPARATE COLUMN CONDITION. Money is not
  // `trip.write`: an accountant may hold `cost.read` and no right to correct
  // the board at all, so gating the actions column on `canManage` alone would
  // hide the only control they need.
  const canViewCost = can('cost.read');
  const [costFor, setCostFor] = useState<string | null>(null);
  /** The trip whose driver is being chosen. `trip.write`, like every other correction. */
  const [assigning, setAssigning] = useState<TripScheduleWithRefs | null>(null);

  // The list, its date range and its page walk — see `useTripSchedules` for why
  // those three are one hook and not three pieces of page state.
  const trips = useTripSchedules();

  // The catalogues, for the form's two dropdowns. Read once per page rather
  // than per modal open: they are small, bounded lists, and re-reading them
  // every time the dialog opens would be a request for data that has not
  // changed. Archived rows are left out — a retired truck must not be offered
  // for a new trip.
  const catalogue = useTripCatalogue();

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (trip: TripScheduleWithRefs) => {
    setEditing(trip);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-blue-600" aria-hidden="true" />
          <h1 className="text-xl font-bold text-gray-900">{t('tripScheduleTitle')}</h1>
        </div>
        {canAdd && (
          <Button onClick={openAdd} className="gap-2 bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            {t('addTrip')}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 border-b border-gray-100 bg-gray-50/50 p-4">
          <div className="space-y-1">
            <label htmlFor="trip-from" className="text-xs font-medium text-gray-600">
              {t('dateFrom')}
            </label>
            <Input
              id="trip-from"
              type="date"
              value={trips.range.from}
              onChange={(event) => trips.setFrom(event.target.value)}
              className="h-9 w-[170px] bg-white"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="trip-to" className="text-xs font-medium text-gray-600">
              {t('dateTo')}
            </label>
            <Input
              id="trip-to"
              type="date"
              value={trips.range.to}
              onChange={(event) => trips.setTo(event.target.value)}
              className="h-9 w-[170px] bg-white"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-9 bg-white"
            onClick={trips.resetRange}
          >
            {t('thisMonth')}
          </Button>
        </div>

        <div
          className={cn(
            'overflow-x-auto transition-opacity',
            // Holding the previous page's rows while the next one loads is what
            // stops the table flashing empty. Dimming them says so, instead of
            // presenting stale rows as if they were the answer.
            trips.showingPreviousPage && 'opacity-60',
          )}
        >
          <Table>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead className="w-[50px] text-center font-semibold text-gray-600">
                  {t('colIndex')}
                </TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colDate')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colVehicle')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colDriver')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colCustomer')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colCargo')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colPickup')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colDelivery')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colNote')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colCreatedBy')}</TableHead>
                {(canManage || canViewCost) && (
                  <TableHead className="font-semibold text-gray-600">{t('colActions')}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {trips.items.map((trip, index) => (
                <TableRow key={trip.id} className="align-top transition-colors hover:bg-blue-50/30">
                  {/*
                    The `STT` column of the sheet, continued ACROSS pages: row 1
                    of page 2 is 51, not 1. Restarting the count per page would
                    make two different rows both "1" and break the one thing the
                    column is for — saying which row somebody means out loud.
                  */}
                  <TableCell className="text-center font-medium text-gray-500">
                    {trips.firstRowNumber + index}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-gray-900">
                    {formatCalendarDay(trip.scheduledOn, language)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium text-gray-900">
                    {trip.vehicle?.plate ?? <Unset />}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {/*
                      ★ WHO IS DRIVING, AND THE ONE CONTROL THAT CHANGES IT.
                      Operations assigns; the driver never does — the portal
                      has no such button and the server refuses a driver
                      account the route. Hidden on a finished trip for the
                      same reason the status dropdown is: the server refuses
                      every assignment write once a trip is done.
                    */}
                    <div className="flex items-center gap-2">
                      <span className={trip.driver ? 'text-gray-900' : 'text-gray-400'}>
                        {trip.driver?.displayName ?? t('driverUnassigned')}
                      </span>
                      {canManage && trip.status !== 'done' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-gray-600"
                          onClick={() => setAssigning(trip)}
                        >
                          {trip.driver ? t('changeDriver') : t('assignDriver')}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-900">{trip.customer?.name ?? <Unset />}</TableCell>
                  <TableCell>
                    <Prose value={trip.cargoInfo} />
                  </TableCell>
                  <TableCell>
                    <Leg
                      address={trip.pickupAddress}
                      contact={trip.pickupContact}
                      at={trip.pickupAt}
                    />
                  </TableCell>
                  <TableCell>
                    <Leg
                      address={trip.deliveryAddress}
                      contact={trip.deliveryContact}
                      at={trip.deliveryAt}
                    />
                  </TableCell>
                  <TableCell>
                    {/*
                      The same badge either way. A reader without `trip.write`
                      gets it as a label; a dispatcher gets it as the control
                      that moves the trip along the board — one click, its own
                      endpoint, no form.

                      ★ AND A FINISHED TRIP IS A LABEL FOR EVERYBODY. `done` is
                      terminal (BD-01), so the server refuses every move away
                      from it — offering the dropdown here would be offering a
                      control whose only possible outcome is a 409. The server
                      still decides; this just stops asking it a settled
                      question.
                    */}
                    {canManage && trip.status !== 'done' ? (
                      <TripStatusSelect tripId={trip.id} status={trip.status} />
                    ) : (
                      <TripStatusBadge status={trip.status} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Prose value={trip.note} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-gray-600">
                    {trip.createdByUser.displayName}
                  </TableCell>
                  {(canManage || canViewCost) && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 px-2 text-gray-600"
                          onClick={() => openEdit(trip)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">{t('edit')}</span>
                        </Button>
                        )}
                        {canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 px-2 text-gray-600"
                          onClick={() => setArchiving(trip)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                          {/*
                            Labelled "Lưu trữ", never "Xoá": the row survives
                            archiving, and a button that promises deletion over
                            an operation that keeps the record describes
                            something else.
                          */}
                          <span className="sr-only">{t('archive')}</span>
                        </Button>
                        )}
                        {/*
                          ★ ITS OWN PERMISSION, AND ITS OWN DIALOG. The amounts
                          are never in the board's data — they are fetched only
                          when this opens, and only for a caller holding
                          `cost.read`. A column here would put the company's
                          cost base in front of every signed-in account.
                        */}
                        {canViewCost && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 px-2 text-gray-600"
                            onClick={() => setCostFor(trip.id)}
                          >
                            <Wallet className="h-3.5 w-3.5" />
                            <span className="sr-only">{t('tripCost')}</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* The four states, in the order EmployeeManagementPage established. */}
          {!trips.loading && trips.items.length === 0 && !trips.error && (
            <p className="px-6 py-10 text-center text-sm text-gray-500">{t('emptyTrips')}</p>
          )}
          {trips.forbidden && (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
              <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
            </div>
          )}
          {trips.error && !trips.forbidden && (
            <p className="px-6 py-10 text-center text-sm text-red-600">
              {/*
                The server's own message, when there is one. A 422 here says
                which of the two dates is wrong — "the end of the range must not
                be before its start" — and replacing that with a generic
                "could not load" throws away the only useful part.
              */}
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
        vehicles={catalogue.vehicles.items}
        customers={catalogue.customers.items}
        // `data` is null until the read lands; `items` defaults to [], which
        // cannot tell an empty catalogue from an unread one.
        cataloguesLoaded={catalogue.vehicles.data !== null && catalogue.customers.data !== null}
        onClose={() => setFormOpen(false)}
        onSaved={trips.reload}
        onCatalogueChanged={catalogue.reload}
      />

      <TripCostModal tripId={costFor} onClose={() => setCostFor(null)} />
      <DriverAssignModal trip={assigning} onClose={() => setAssigning(null)} />

      <ArchiveTripDialog
        trip={archiving}
        onClose={() => setArchiving(null)}
        onArchived={trips.reload}
      />
    </div>
  );
}

/** A field the row genuinely has no value for — shown, not left blank. */
function Unset() {
  const { t } = useLanguage();
  return <span className="text-gray-400">{t('notSelected')}</span>;
}

/**
 * A multi-line cell from the workbook.
 *
 * `whitespace-pre-line` keeps the line breaks the source data has — an address
 * cell holds a company, a street, a ward and a phone on four lines — and the
 * width cap stops one long address from pushing every other column off screen.
 */
function Prose({ value }: Readonly<{ value: string | null }>) {
  if (!value) return <Unset />;
  return (
    <span className="block max-w-[22rem] whitespace-pre-line text-gray-700">{value}</span>
  );
}

/** One end of a trip: where, who, and when. */
function Leg({
  address,
  contact,
  at,
}: Readonly<{ address: string | null; contact: string | null; at: string | null }>) {
  const { language } = useLanguage();

  if (!address && !contact && !at) return <Unset />;

  return (
    <div className="max-w-[22rem] space-y-1 text-sm">
      {address && <span className="block whitespace-pre-line text-gray-900">{address}</span>}
      {contact && <span className="block whitespace-pre-line text-gray-500">{contact}</span>}
      {/*
        A full date and time, not just the hour: delivery routinely falls on a
        later day than the trip's own date, and showing `09:00` alone would
        quietly claim it happens the same day.
      */}
      {at && <span className="block font-medium text-blue-700">{formatDateTime(at, language)}</span>}
    </div>
  );
}

/**
 * Confirming an archive.
 *
 * ★ THE BODY SAYS WHAT ARCHIVING ACTUALLY DOES. The record is kept; the row
 * leaves the schedule. A dialog that said "delete permanently" would be false,
 * and one that said "remove" would leave the reader guessing which of the two
 * it meant — on an action they cannot undo from this screen.
 */
function ArchiveTripDialog({
  trip,
  onClose,
  onArchived,
}: Readonly<{
  trip: TripScheduleWithRefs | null;
  onClose: () => void;
  onArchived: () => void;
}>) {
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!trip) return;
    setBusy(true);
    setError(null);

    try {
      await archiveTripSchedule(trip.id);
      onArchived();
      onClose();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={trip !== null}
      onClose={onClose}
      title={t('confirmArchiveTripTitle')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>
            {busy ? t('saving') : t('archive')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{t('confirmArchiveTripBody')}</p>
        {trip && (
          <p className="text-sm font-medium text-gray-900">
            {`${formatCalendarDay(trip.scheduledOn, language)} · ${trip.vehicle?.plate ?? '—'} · ${trip.customer?.name ?? '—'}`}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
