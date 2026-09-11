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
import { formatPlate } from '@/utils/format';
import { formatMoney } from '@/utils/format/money';
import {
  TRIP_ASSIGNMENT_FILTERS,
  type TripAssignmentFilter,
  type TripScheduleWithRefs,
} from '@/types/trip';
import type { TranslationKey } from '@/types/translate';
import { TripScheduleExportButton } from '@/components/trip/TripScheduleExportButton';
import { TripFormModal } from './components/TripFormModal';
import { TripStatusBadge } from './components/TripStatusBadge';
import { TripStatusSelect } from './components/TripStatusSelect';
import { TripCostModal } from './components/TripCostModal';
import { DispatchPanel } from './components/DispatchPanel';

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
  // ★ A THIRD, NARROWER KEY, AND NOT EITHER OF THE TWO ABOVE. `cost.read` is
  // the ledger of what runs COST US and is 'global'; this is what each trip is
  // sold and bought for, which a department head arranging the run has to see.
  // A viewer without it is sent `null` for both figures whatever the trip
  // holds, so the columns are dropped rather than drawn full of em dashes.
  const mayPrice = can('trip.price.read');
  const [costFor, setCostFor] = useState<string | null>(null);
  /**
   * The trip whose crew is being dispatched. `trip.write`, like every other correction.
   *
   * ★ THE ROW IS RE-DERIVED FROM THE LIST ON EVERY RENDER, by id. The panel
   * shows `trip.assignments`, and every dispatch mutation re-reads the list;
   * holding the object clicked would keep showing the crew as it was before
   * the add until the panel was closed and reopened.
   *
   * ★ AND WHEN THE ROW LEAVES THE LIST, THE PANEL CLOSES — it does NOT fall
   * back to the object clicked. Crewing a trip from the "chờ phân công" tab
   * moves it out of that filter, so the clicked object is the one state the
   * dispatcher has just made untrue: the panel would sit there showing a trip
   * with no crew, over a list that no longer contains it. `useOffsetPages`
   * keeps the previous page's items across a refetch (`keepPreviousData`), so
   * an empty find here means the row really has gone, not that it is reloading.
   */
  const [assigningRow, setAssigningRow] = useState<TripScheduleWithRefs | null>(null);

  // The list, its date range and its page walk — see `useTripSchedules` for why
  // those three are one hook and not three pieces of page state.
  const trips = useTripSchedules();

  const assigning =
    assigningRow === null
      ? null
      : (trips.items.find((row) => row.id === assigningRow.id) ?? null);

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
        {/*
          ★ ABOVE THE DATE BAR, BECAUSE IT NARROWS WHAT THE DATE BAR RETURNS.
          Both are one query; putting the tabs inside the filter row would read
          as two independent controls, and the row that changes the fewest
          things belongs closest to the table.
        */}
        {/*
          ★ THE EXPORT SITS BESIDE THE TABS, NOT INSIDE THEM. A `role="tablist"`
          may hold tabs and nothing else, so the border and the padding moved
          out here and the tablist kept only its own row. `items-end` keeps the
          selected tab's underline flush with this container's border while the
          button — the same height — sits on the same line.
        */}
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-gray-100 px-4 pt-3">
          <AssignmentTabs
            value={trips.assignment}
            onChange={trips.setAssignment}
            unassignedCount={trips.unassignedCount}
          />
          {/*
            Only on "tất cả", because that is the only tab whose name matches
            what the file contains — see the component's own header.
          */}
          {trips.assignment === 'all' && <TripScheduleExportButton range={trips.range} />}
        </div>

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
                {/*
                  ★ THE TWO PRICE COLUMNS ARE ABSENT, NOT EMPTY, FOR A VIEWER
                  WHO MAY NOT SEE THEM. The server sends `null` for both to such
                  a caller whatever the trip holds, so a rendered column would
                  show an em dash on every row and read as "nothing is priced" —
                  a claim about the data that is not true. Dropping the columns
                  says nothing instead, which is the honest option.
                */}
                {mayPrice && (
                  <>
                    <TableHead className="text-right font-semibold text-gray-600">
                      {t('colSellPrice')}
                    </TableHead>
                    <TableHead className="text-right font-semibold text-gray-600">
                      {t('colPurchasePrice')}
                    </TableHead>
                  </>
                )}
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
                    {/*
                      ★ ONE LINE PER LORRY (ADR-0004). A trip carries any
                      number of them, each with its own driver; the row stays
                      one row and the cell grows. Formatted for reading, not
                      normalised: the catalogue stores the plate as somebody
                      typed it, so `50H49266` and `50H-49266` stop looking like
                      two lorries down one column.
                    */}
                    <Plates trip={trip} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {/*
                      ★ WHO IS DRIVING, AND THE ONE CONTROL THAT CHANGES IT.
                      Operations dispatches; the driver never does — the portal
                      has no such button and the server refuses a driver
                      account the route. Hidden on a finished trip for the
                      same reason the status dropdown is: the server refuses
                      every assignment write once a trip is finished.
                    */}
                    <Crew
                      trip={trip}
                      canDispatch={canManage && trip.status !== 'finished'}
                      onDispatch={() => setAssigningRow(trip)}
                    />
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

                      ★ AND A FINISHED TRIP IS A LABEL FOR EVERYBODY. `finished`
                      is terminal (BD-01), so the server refuses every move away
                      from it — offering the dropdown here would be offering a
                      control whose only possible outcome is a 409. The server
                      still decides; this just stops asking it a settled
                      question.
                    */}
                    {canManage && trip.status !== 'finished' ? (
                      <TripStatusSelect tripId={trip.id} status={trip.status} />
                    ) : (
                      <TripStatusBadge status={trip.status} />
                    )}
                  </TableCell>
                  {/*
                    ★ THE TWO AGREED CHARGES — what this run is sold for and what
                    it is bought for. They are the only amounts on the board, and
                    only for a head or the superadmin. The wallet button beside
                    them opens what the run COST us: a different ledger behind
                    `cost.read`, fetched when that dialog opens and never in this
                    list's data.

                    ★ FORMATTED, NEVER PARSED. `formatMoney` does string work —
                    the values are `NUMERIC(14,2)` carried as text precisely so
                    nothing rounds them, and `Number(...)` here would undo that
                    for the sake of a thousands separator.

                    ★ TESTED FOR TRUTHINESS RATHER THAN AGAINST `null`. A strict
                    `=== null` reads correctly against the contract and still
                    hands `undefined` to `formatMoney`, which unmounted the board
                    on the first fixture that predated the field. A missing price
                    and an empty one are the same fact, and neither is worth a
                    crash.
                  */}
                  {mayPrice && (
                    <>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">
                        {trip.sellPrice ? formatMoney(trip.sellPrice) : <Unset />}
                      </TableCell>
                      {/*
                        Lighter than the selling price on purpose: this is what
                        the run cost to buy, and the column people scan down is
                        the one they invoice from.
                      */}
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-600">
                        {trip.purchasePrice ? formatMoney(trip.purchasePrice) : <Unset />}
                      </TableCell>
                    </>
                  )}
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
            <p className="px-6 py-10 text-center text-sm text-gray-500">
              {/*
                ★ THE SENTENCE DEPENDS ON THE TAB. "Không có chuyến nào trong
                khoảng ngày này" under the uncrewed tab would say the month is
                empty when what happened is that every trip in it already has a
                driver — and a dispatcher who believes that goes looking for rows
                that were never missing.
              */}
              {t(TAB_EMPTY_MESSAGES[trips.assignment])}
            </p>
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
        customers={catalogue.customers.items}
        // `data` is null until the read lands; `items` defaults to [], which
        // cannot tell an empty catalogue from an unread one.
        cataloguesLoaded={catalogue.customers.data !== null}
        onClose={() => setFormOpen(false)}
        onSaved={trips.reload}
        onCatalogueChanged={catalogue.reload}
      />

      <TripCostModal tripId={costFor} onClose={() => setCostFor(null)} />
      {/* The lorries and their drivers — the catalogue's active lorries are
          what may be added; the panel leaves out the ones already on the trip. */}
      <DispatchPanel
        trip={assigning}
        vehicles={catalogue.vehicles.items}
        onClose={() => setAssigningRow(null)}
      />

      <ArchiveTripDialog
        trip={archiving}
        onClose={() => setArchiving(null)}
        onArchived={trips.reload}
      />
    </div>
  );
}

/** What each tab is called, and what an empty list under it means. */
const TAB_LABELS: Record<TripAssignmentFilter, TranslationKey> = {
  all: 'tripTabAll',
  unassigned: 'tripTabUnassigned',
  assigned: 'tripTabAssigned',
};

const TAB_EMPTY_MESSAGES: Record<TripAssignmentFilter, TranslationKey> = {
  all: 'emptyTrips',
  unassigned: 'emptyUnassignedTrips',
  assigned: 'emptyAssignedTrips',
};

/**
 * The crew line, as three tabs over one list.
 *
 * ★ THE MIDDLE TAB IS A WORK QUEUE, NOT A STATUS. A trip joins it the moment it
 * is entered and leaves it the moment somebody is put on the row — which is why
 * the count rides on the tab itself: dispatch needs to see that there is work
 * waiting without having to go and look for it.
 *
 * ★ AND EVERY ONE OF THEM IS A SERVER QUERY. Each tab is its own `?assignment=`
 * with its own `total`, so the pagination underneath always describes the list
 * on screen. Filtering `trips.items` here instead would break the one promise
 * this screen's pagination makes.
 *
 * `role="tablist"` with real buttons rather than links: the tab is not in the
 * URL, so there is nothing to navigate to, and a screen reader is told these
 * three are alternatives rather than three unrelated buttons.
 */
function AssignmentTabs({
  value,
  onChange,
  unassignedCount,
}: Readonly<{
  value: TripAssignmentFilter;
  onChange: (filter: TripAssignmentFilter) => void;
  unassignedCount: number | null;
}>) {
  const { t } = useLanguage();

  // No border and no outer padding here: those belong to the row that wraps
  // this tablist and the export button beside it. A tablist owns only its tabs.
  return (
    <div
      role="tablist"
      aria-label={t('tripTabsLabel')}
      className="flex flex-wrap items-center gap-1"
    >
      {TRIP_ASSIGNMENT_FILTERS.map((filter) => {
        const selected = filter === value;
        // Zero is worth showing on the tab you are standing on — "0" is the
        // answer to "is anything waiting?" — but a badge on an unselected tab
        // that says nothing is waiting is just noise.
        const showCount =
          filter === 'unassigned' && unassignedCount !== null && (selected || unassignedCount > 0);

        return (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(filter)}
            className={cn(
              'flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              selected
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t(TAB_LABELS[filter])}
            {showCount && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  selected ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700',
                )}
              >
                {unassignedCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A field the row genuinely has no value for — shown, not left blank. */
function Unset() {
  const { t } = useLanguage();
  return <span className="text-gray-400">{t('notSelected')}</span>;
}

/** Every plate on the trip on one line, for a sentence that names the row. */
const platesOf = (trip: TripScheduleWithRefs): string =>
  trip.assignments
    .map((turn) => (turn.vehicle ? formatPlate(turn.vehicle.plate) : ''))
    .filter(Boolean)
    .join('; ');

/**
 * The lorries on the trip, one per line.
 *
 * ★ A LEGACY LORRY IS NAMED AS SUCH. A trip booked before dispatch became a
 * pair may still carry `vehicleId` with no assignment behind it; the board
 * says "planned vehicle (legacy)" rather than a plate it does not have, so
 * Operations knows to dispatch the trip again as a pair.
 *
 * ★ SONAR S1874 ("'vehicleId' is deprecated") IS EXPECTED HERE AND MUST NOT BE
 * "FIXED" BY DELETING THE READ. `assignment.vehicle_id` is the canonical source
 * and it cannot answer this one: the read happens only where
 * `assignments.length === 0`, and migration 0029 case F leaves precisely those
 * rows uncrewed by design — a lorry with no driver is not an assignment. The
 * legacy column is therefore the only record that a lorry was ever planned, and
 * removing the read would render those trips as an ordinary `Unset`, losing the
 * signal that they need re-dispatching. Deprecated means no new WRITER — nothing
 * has written the column since 0027 — not that the existing rows went away.
 */
function Plates({ trip }: Readonly<{ trip: TripScheduleWithRefs }>) {
  const { t } = useLanguage();
  if (trip.assignments.length === 0) {
    return trip.vehicleId ? (
      <span className="text-xs font-normal text-amber-700">{t('dispatchLegacyBadge')}</span>
    ) : (
      <Unset />
    );
  }
  return (
    <ul className="space-y-0.5">
      {trip.assignments.map((turn) => (
        <li key={turn.id}>
          {turn.vehicle ? (
            formatPlate(turn.vehicle.plate)
          ) : (
            <span className="text-xs font-normal text-amber-700">{t('dispatchMissingVehicle')}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The drivers on the trip — each named once, however many lorries they hold —
 * with the count when there is more than one lorry, and the one control that
 * changes the crew.
 */
function Crew({
  trip,
  canDispatch,
  onDispatch,
}: Readonly<{ trip: TripScheduleWithRefs; canDispatch: boolean; onDispatch: () => void }>) {
  const { t } = useLanguage();
  // ★ DEDUPED BY ID, KEYED BY ID, SHOWN BY NAME. Two different drivers may
  // share a display name; folding them by name would show one person.
  const drivers = [
    ...new Map(trip.assignments.map((turn) => [turn.driver.id, turn.driver] as const)).values(),
  ];
  const lorries = trip.assignments.length;

  return (
    <div className="flex items-start gap-2">
      <div>
        {drivers.length === 0 ? (
          <span className="text-gray-400">{t('driverUnassigned')}</span>
        ) : (
          <ul className="space-y-0.5 text-gray-900">
            {drivers.map((driver) => (
              <li key={driver.id}>{driver.displayName}</li>
            ))}
          </ul>
        )}
        {lorries > 1 ? (
          <span className="block text-xs text-gray-500">
            {`${lorries} ${t('dispatchVehicleUnit')} · ${drivers.length} ${t('dispatchDriverUnit')}`}
          </span>
        ) : null}
      </div>
      {canDispatch && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs text-gray-600"
          onClick={onDispatch}
        >
          {lorries > 0 ? t('dispatchManage') : t('assignDriver')}
        </Button>
      )}
    </div>
  );
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
            {`${formatCalendarDay(trip.scheduledOn, language)} · ${platesOf(trip) || '—'} · ${trip.customer?.name ?? '—'}`}
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
