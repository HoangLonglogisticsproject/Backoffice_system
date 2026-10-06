import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, Pencil } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchVehicleCosts } from '@/api/vehicleCost';
import { tripKeys } from '@/hooks/trip/keys';
import { isApiError } from '@/utils/errors';
import { currentMonthRange, formatCalendarDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import type { TranslationKey } from '@/types/translate';
import type { VehicleCost, VehicleCostCategory } from '@/types/vehicleCost';

/**
 * One lorry, as an object — "Tổng quan", then whatever the lorry has.
 *
 * ★ SECTIONS ARE TABS, SO THE CATALOGUE NEVER GROWS ANOTHER ICON. The table
 * opens this one view; maintenance, papers or activity arrive as one more
 * `TabsTrigger` here, never as a fourth button on every row.
 *
 * ★ A SECTION IS READ ONLY WHEN IT IS OPEN. Inactive panels are not mounted,
 * so the lorry's costs are fetched when "Chi phí xe" is chosen — opening the
 * lorry asks nothing new of the server.
 */
type Section = 'overview' | 'costs';

interface Props {
  vehicle: { id: string; display: string; note: string | null; dailyFuelCheckRequired: boolean; archived: boolean };
  /** "Chi phí xe" is `cost.read`, exactly as the route behind it asks. */
  canReadCosts: boolean;
  /** Edit and archive are `trip.write`; a retired lorry takes neither. */
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onClose: () => void;
}

export function VehicleDetailModal({ vehicle, canReadCosts, canManage, onEdit, onArchive, onClose }: Readonly<Props>) {
  const { t } = useLanguage();
  const [section, setSection] = useState<Section>('overview');

  return (
    <Modal isOpen onClose={onClose} title={vehicle.display} className="max-w-4xl">
      <Tabs value={section} onValueChange={(next) => setSection(next === 'costs' ? 'costs' : 'overview')}>
        <TabsList aria-label={t('vehicleDetailSections')}>
          <TabsTrigger value="overview">{t('vehicleOverview')}</TabsTrigger>
          {canReadCosts && <TabsTrigger value="costs">{t('vehicleCostsSection')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <OverviewPanel vehicle={vehicle} canManage={canManage} onEdit={onEdit} onArchive={onArchive} />
        </TabsContent>
        {canReadCosts && (
          <TabsContent value="costs">
            <VehicleCostsPanel vehicleId={vehicle.id} />
          </TabsContent>
        )}
      </Tabs>
    </Modal>
  );
}

function OverviewPanel({
  vehicle,
  canManage,
  onEdit,
  onArchive,
}: Readonly<Pick<Props, 'vehicle' | 'canManage' | 'onEdit' | 'onArchive'>>) {
  const { t } = useLanguage();
  return (
    <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label={t('colVehicle')}>
          <span className="font-semibold text-gray-900">{vehicle.display}</span>
        </Fact>
        <Fact label={t('colStatus')}>
          <StatusPill tone={vehicle.archived ? 'gray' : 'green'}>
            {t(vehicle.archived ? 'statusArchived' : 'statusActive')}
          </StatusPill>
        </Fact>
        <Fact label={t('fuelPolicyLabel')}>
          {t(vehicle.dailyFuelCheckRequired ? 'fuelPolicyRequired' : 'fuelPolicyNotApplicable')}
        </Fact>
        <Fact label={t('colNote')}>{vehicle.note ?? '—'}</Fact>
      </dl>

      {/* A retired lorry is refused edits by the server (409); the actions are
          not offered rather than offered and refused. */}
      {canManage && !vehicle.archived && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
          <Button type="button" variant="outline" className="gap-2" onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden />
            {t('editVehicle')}
          </Button>
          <Button type="button" variant="outline" className="gap-2" onClick={onArchive}>
            <Archive className="h-4 w-4" aria-hidden />
            {t('archiveVehicle')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

/**
 * "Chi phí xe" — the lorry's own ledger (0034), read only.
 *
 * ★ THE LORRY'S MONEY ONLY. These rows come from the vehicle ledger, which no
 * trip total reads. "Chuyến liên quan" is optional provenance — where a cost
 * arose, when it arose on a trip — never the trip it is charged to.
 *
 * The range opens on the business month and is the server's query, not a
 * filter over a page — the total is the server's sum of the whole range.
 */
export function VehicleCostsPanel({ vehicleId }: Readonly<{ vehicleId: string }>) {
  const { t } = useLanguage();
  const [range, setRange] = useState(currentMonthRange);
  // A half-typed day is '' — nothing is asked until both ends are days, in order.
  const askable = range.from !== '' && range.to !== '' && range.from <= range.to;

  const costs = useQuery({
    queryKey: tripKeys.vehicleCosts(vehicleId, range),
    queryFn: () => fetchVehicleCosts(vehicleId, range),
    enabled: askable,
  });
  const page = costs.data;

  return (
    <section className="space-y-3">
      <RangeBar range={range} onChange={setRange} />

      {page && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-sm text-gray-600">
            {t('vehicleCostsTotal')}:{' '}
            <span className="text-lg font-semibold text-gray-900 tabular-nums">{formatMoney(page.totalAmount)}</span>
          </p>
          <p className="text-sm text-gray-600">
            {page.total} {t('vehicleCostsTransactions')}
          </p>
        </div>
      )}

      {!askable && <p className="text-sm text-amber-700">{t('vehicleCostsRangeInvalid')}</p>}
      {costs.isError && (
        <p role="alert" className="text-sm text-red-600">
          {t(isApiError(costs.error) && costs.error.status === 422 ? 'vehicleCostsRangeInvalid' : 'loadFailed')}
        </p>
      )}
      {costs.isLoading && <p className="text-sm text-gray-500">{t('driverLoading')}</p>}

      {page?.items.length === 0 && (
        <p className="py-6 text-center text-sm text-gray-500">{t('vehicleCostsEmpty')}</p>
      )}
      {page && page.items.length > 0 && <CostTable items={page.items} />}
      {page && page.total > page.items.length && (
        <p className="text-xs text-amber-700">
          {t('vehicleCostsShowing')} {page.items.length}/{page.total} {t('vehicleCostsLatest')}{' '}
          {t('vehicleCostsTruncated')}
        </p>
      )}

      <p className="text-xs text-gray-500">{t('vehicleCostsNotTripCost')}</p>
    </section>
  );
}

function RangeBar({
  range,
  onChange,
}: Readonly<{ range: { from: string; to: string }; onChange: (range: { from: string; to: string }) => void }>) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="vehicle-costs-from" className="text-xs font-medium text-gray-600">
          {t('dateFrom')}
        </label>
        <DateInput id="vehicle-costs-from" value={range.from} onChange={(from) => onChange({ ...range, from })} />
      </div>
      <div className="space-y-1">
        <label htmlFor="vehicle-costs-to" className="text-xs font-medium text-gray-600">
          {t('dateTo')}
        </label>
        <DateInput id="vehicle-costs-to" value={range.to} onChange={(to) => onChange({ ...range, to })} />
      </div>
      <Button type="button" variant="outline" onClick={() => onChange(currentMonthRange())}>
        {t('thisMonth')}
      </Button>
    </div>
  );
}

function CostTable({ items }: Readonly<{ items: VehicleCost[] }>) {
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-gray-100">
      <Table>
        <TableHeader className="bg-gray-50/50">
          <TableRow>
            <TableHead>{t('vehicleCostsColDate')}</TableHead>
            <TableHead>{t('vehicleCostsColCategory')}</TableHead>
            <TableHead className="text-right">{t('vehicleCostsColAmount')}</TableHead>
            <TableHead className="text-right">{t('vehicleCostsColLiters')}</TableHead>
            <TableHead className="text-right">{t('vehicleCostsColOdometer')}</TableHead>
            <TableHead>{t('vehicleCostsColSource')}</TableHead>
            <TableHead>{t('vehicleCostsColTrip')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((cost) => (
            <CostRow key={cost.id} cost={cost} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** One label per heading. A new heading is a compile error here — never shown as fuel. */
const CATEGORY_LABEL: Record<VehicleCostCategory, TranslationKey> = { fuel: 'costFuel' };

function CostRow({ cost }: Readonly<{ cost: VehicleCost }>) {
  const { t, language } = useLanguage();
  const trip = cost.sourceTrip;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{formatCalendarDay(cost.businessDate, language)}</TableCell>
      <TableCell>{t(CATEGORY_LABEL[cost.category])}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">{formatMoney(cost.amount)}</TableCell>
      <TableCell className="text-right tabular-nums">{cost.liters ? formatMoney(cost.liters) : '—'}</TableCell>
      <TableCell className="text-right tabular-nums">
        {cost.odometerKm === null ? '—' : formatMoney(String(cost.odometerKm))}
      </TableCell>
      <TableCell>
        <span className="block">
          {t(cost.source === 'driver_portal' ? 'vehicleCostsSourceDriver' : 'vehicleCostsSourceBackoffice')}
        </span>
        <span className="block text-xs text-gray-500">{cost.createdByUser.displayName}</span>
      </TableCell>
      <TableCell className="text-gray-600">
        {trip ? (
          <>
            <span className="block whitespace-nowrap">{formatCalendarDay(trip.scheduledOn, language)}</span>
            <span className="block text-xs text-gray-500">{trip.customerName ?? '—'}</span>
          </>
        ) : (
          '—'
        )}
      </TableCell>
    </TableRow>
  );
}
