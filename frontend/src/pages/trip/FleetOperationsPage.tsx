import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { fetchFleetBoard } from '@/api/fleetOperations';
import { holdsFleetMoney, tripKeys } from '@/hooks/trip/keys';
import { useBusinessToday } from '@/hooks/useBusinessToday';
import type { FuelObligation } from '@/types/driver';
import type { FleetVehicleDay, FleetVehicleState } from '@/types/fleet';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { FleetVehicleModal } from './components/FleetVehicleModal';
import { focusOf, FUEL_LABEL, FUEL_TONE, ISSUE_LABEL, STATE_LABEL, STATE_TONE } from './components/fleetLabels';

/**
 * "Điều hành xe" — under ĐIỀU PHỐI, one row per lorry for the chosen business
 * day: is it running, waiting or idle, who drives it, and has it answered its
 * beginning-of-shift fuel check.
 *
 * ★ DISPATCH'S SCREEN: `dispatch.write`, as the route behind it. Sales,
 * Accounting and Customer Service read Lịch xe (`trip.read`) but not this
 * board; the menu does not offer it to them and the server refuses it.
 *
 * ★ THE SERVER DERIVES EVERY STATE, IN ONE STATEMENT. This screen only filters
 * what came back. ponytail: the filters are client-side over the day's rows —
 * a fleet is tens of lorries; move them into the query when it is hundreds.
 *
 * ★ THE MONEY IS THE SERVER'S TO SEND. Without `cost.read` the amounts arrive
 * as `null` (never selected), and the screen says so instead of a blank.
 */

/** "Cát Lái" is found by "cat lai": Vietnamese marks folded away, đ as d. */
const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

type Filters = { state: FleetVehicleState | ''; driver: string; fuel: FuelObligation | ''; search: string };
const NO_FILTERS: Filters = { state: '', driver: '', fuel: '', search: '' };

const matches = (row: FleetVehicleDay, filters: Filters): boolean => {
  if (filters.state && row.state !== filters.state) return false;
  if (filters.fuel && row.fuel.obligation !== filters.fuel) return false;
  if (filters.driver && !row.drivers.some((driver) => driver.id === filters.driver)) return false;
  const needle = fold(filters.search.trim());
  if (!needle) return true;
  const haystack = [
    row.vehicle.plate,
    formatPlate(row.vehicle.plate),
    ...row.drivers.map((driver) => driver.displayName),
    ...row.turns.flatMap((turn) => [turn.customerName ?? '', turn.pickupName ?? '', turn.deliveryName ?? '']),
  ];
  return haystack.some((text) => fold(text).includes(needle));
};

export default function FleetOperationsPage() {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const today = useBusinessToday();
  const [day, setDay] = useState(today);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const mayRead = can('dispatch.write');
  const withMoney = can('cost.read');
  const queryClient = useQueryClient();

  const board = useQuery({
    queryKey: tripKeys.fleet(day, withMoney),
    queryFn: () => fetchFleetBoard(day),
    enabled: mayRead && day !== '',
    // The board moves as drivers tap; a minute old is still "now" for a dispatcher.
    refetchInterval: 60_000,
  });
  const data = board.data;
  const rows = useMemo(() => (data ? data.vehicles.filter((row) => matches(row, filters)) : []), [data, filters]);
  const drivers = useMemo(() => {
    const all = new Map((data?.vehicles ?? []).flatMap((row) => row.drivers.map((driver) => [driver.id, driver] as const)));
    return [...all.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
  }, [data]);
  const open = data?.vehicles.find((row) => row.vehicle.id === openId) ?? null;

  // ★ THE MONEY DOES NOT OUTLIVE THE PERMISSION — as `useTripCost`: days read
  // with amounts, and the lorries' ledgers, are dropped, not refetched.
  useEffect(() => {
    if (withMoney) return;
    queryClient.removeQueries({ queryKey: tripKeys.fleets(), predicate: (query) => holdsFleetMoney(query.queryKey) });
    queryClient.removeQueries({ queryKey: [...tripKeys.all, 'money'] });
  }, [withMoney, queryClient]);

  if (!mayRead) {
    return (
      // Lịch xe is mentioned only to someone who may actually open it.
      <PageHeader title={t('fleetOperations')} subtitle={t(can('trip.read') ? 'fleetNoAccessTripSchedule' : 'fleetNoAccess')} />
    );
  }

  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const cards: Array<{ key: string; label: TranslationKey; value: number | undefined; active: boolean; apply: Partial<Filters> }> = [
    { key: 'total', label: 'fleetCardTotal', value: data?.summary.total, active: !filters.state && !filters.fuel, apply: { state: '', fuel: '' } },
    { key: 'running', label: 'fleetCardRunning', value: data?.summary.running, active: filters.state === 'running', apply: { state: 'running', fuel: '' } },
    { key: 'waiting', label: 'fleetCardWaiting', value: data?.summary.waiting, active: filters.state === 'waiting', apply: { state: 'waiting', fuel: '' } },
    { key: 'unassigned', label: 'fleetCardUnassigned', value: data?.summary.unassigned, active: filters.state === 'unassigned', apply: { state: 'unassigned', fuel: '' } },
    { key: 'fuel', label: 'fleetCardFuelMissing', value: data?.summary.fuelMissing, active: filters.fuel === 'REQUIRED_MISSING', apply: { state: '', fuel: 'REQUIRED_MISSING' } },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('fleetOperations')}
        subtitle={t('fleetSubtitle')}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="fleet-day" className="text-xs font-medium text-gray-600">
                {t('fleetDate')}
              </label>
              <DateInput id="fleet-day" value={day} onChange={setDay} />
            </div>
            <Button type="button" variant="outline" onClick={() => setDay(today)} disabled={day === today}>
              {t('fleetToday')}
            </Button>
          </div>
        }
      />

      {/* The five numbers of the day. Each one is also the filter that shows its lorries. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            aria-pressed={card.active}
            onClick={() => set(card.apply)}
            className={cn(
              'rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              card.active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-100',
              card.key === 'fuel' && (card.value ?? 0) > 0 && 'bg-red-50/50',
            )}
          >
            <span className="block text-xs font-medium text-gray-500">{t(card.label)}</span>
            <span className="mt-1 block text-2xl font-semibold text-gray-900 tabular-nums">{card.value ?? '—'}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <Input
            aria-label={t('fleetSearch')}
            placeholder={t('fleetSearch')}
            value={filters.search}
            onChange={(event) => set({ search: event.target.value })}
            className="pl-8"
          />
        </div>
        <FilterSelect id="fleet-state" label={t('fleetColState')} value={filters.state} onChange={(state) => set({ state: state as Filters['state'] })}>
          {(Object.keys(STATE_LABEL) as FleetVehicleState[]).map((state) => (
            <option key={state} value={state}>
              {t(STATE_LABEL[state])}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect id="fleet-driver" label={t('fleetColDrivers')} value={filters.driver} onChange={(driver) => set({ driver })}>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.displayName}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect id="fleet-fuel" label={t('fleetColFuel')} value={filters.fuel} onChange={(fuel) => set({ fuel: fuel as Filters['fuel'] })}>
          {(Object.keys(FUEL_LABEL) as FuelObligation[]).map((fuel) => (
            <option key={fuel} value={fuel}>
              {t(FUEL_LABEL[fuel])}
            </option>
          ))}
        </FilterSelect>
      </div>

      {data && !data.withMoney ? <p className="text-xs text-gray-500">{t('fleetMoneyHidden')}</p> : null}
      {board.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {t('loadFailed')}
        </p>
      ) : null}
      {board.isLoading ? <p className="py-8 text-center text-sm text-gray-500">{t('driverLoading')}</p> : null}

      {data ? (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
          <Table aria-label={`${t('fleetOperations')} · ${formatCalendarDay(data.businessDate, language)}`}>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead>{t('fleetColVehicle')}</TableHead>
                <TableHead>{t('fleetColState')}</TableHead>
                <TableHead>{t('fleetColDrivers')}</TableHead>
                <TableHead>{t('fleetColTrip')}</TableHead>
                <TableHead>{t('fleetColFuel')}</TableHead>
                <TableHead className="text-right whitespace-normal">{t('fleetColFuelDay')}</TableHead>
                <TableHead>{t('fleetColIssues')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-gray-500">
                    {t('fleetEmpty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => <FleetRow key={row.vehicle.id} row={row} onOpen={() => setOpenId(row.vehicle.id)} />)
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {open && data ? (
        <FleetVehicleModal day={data} row={open} canReadCosts={withMoney} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: Readonly<{ id: string; label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }>) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-gray-600">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
      >
        <option value="">{t('fleetFilterAll')}</option>
        {children}
      </select>
    </div>
  );
}

function FleetRow({ row, onOpen }: Readonly<{ row: FleetVehicleDay; onOpen: () => void }>) {
  const { t } = useLanguage();
  const { current: focus, next } = focusOf(row);
  const plate = formatPlate(row.vehicle.plate);
  return (
    <TableRow>
      <TableCell className="font-semibold whitespace-nowrap text-gray-900">
        {plate}
        {row.vehicle.archived ? <span className="ml-1 text-xs font-normal text-gray-500">({t('statusArchived')})</span> : null}
      </TableCell>
      <TableCell>
        <StatusPill tone={STATE_TONE[row.state]}>{t(STATE_LABEL[row.state])}</StatusPill>
      </TableCell>
      {/* The driver of the turn the row speaks for — never a list that could name somebody else's run. */}
      <TableCell className="max-w-40 text-sm whitespace-normal">
        {focus?.driver.displayName ?? '—'}
        {row.drivers.length > 1 ? <span className="block text-xs text-gray-500">+{row.drivers.length - 1}</span> : null}
      </TableCell>
      <TableCell className="max-w-64 text-sm whitespace-normal">
        {focus ? (
          <>
            <span className="line-clamp-1">
              {focus.pickupName ?? '—'} → {focus.deliveryName ?? '—'}
            </span>
            <span className="block text-xs text-gray-500 tabular-nums">
              {focus.progress.reached}/4
              {row.turns.length > 1 ? ` · ${row.turns.length} ${t('fleetTurns')}` : ''}
            </span>
            {next ? (
              <span className="block text-xs text-gray-500">
                {t('fleetNext')}: {next.pickupName ?? '—'} → {next.deliveryName ?? '—'}
              </span>
            ) : null}
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="max-w-44 whitespace-normal">
        <StatusPill tone={FUEL_TONE[row.fuel.obligation]}>{t(FUEL_LABEL[row.fuel.obligation])}</StatusPill>
      </TableCell>
      <TableCell className="text-right text-sm whitespace-nowrap tabular-nums">
        {row.fuel.totalAmount === null ? null : <span className="block font-medium">{formatMoney(row.fuel.totalAmount)}</span>}
        <span className="text-xs text-gray-500">
          {row.fuel.fills} {t('vehicleCostsTransactions')}
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {row.fuel.issues.map((issue) => (
            <StatusPill key={issue} tone="amber">
              {t(ISSUE_LABEL[issue])}
            </StatusPill>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" size="sm" variant="outline" onClick={onOpen}>
          {t('vehicleViewDetail')}
          <span className="sr-only"> {plate}</span>
          <ChevronRight aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}
