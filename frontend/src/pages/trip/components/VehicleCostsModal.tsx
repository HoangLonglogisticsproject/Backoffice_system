import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchVehicleCosts } from '@/api/vehicleCost';
import { tripKeys } from '@/hooks/trip/keys';
import { isApiError } from '@/utils/errors';
import { currentMonthRange, formatCalendarDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import type { VehicleCost } from '@/types/vehicleCost';

/**
 * One lorry, and what it has cost — "Chi phí xe" (0034).
 *
 * ★ READ ONLY, AND THE LORRY'S MONEY ONLY. These rows come from the vehicle
 * ledger, which no trip total reads. "Chuyến liên quan" is optional provenance
 * — where a cost arose, when it arose on a trip — never the trip it is charged
 * to. Nothing here records, voids or reallocates.
 *
 * The range opens on the business month and is the server's query, not a
 * filter over a page — the total is the server's sum of the whole range.
 */
interface Props {
  vehicle: { id: string; display: string; note: string | null; dailyFuelCheckRequired: boolean; archived: boolean };
  onClose: () => void;
}

export function VehicleCostsModal({ vehicle, onClose }: Readonly<Props>) {
  const { t } = useLanguage();
  const [range, setRange] = useState(currentMonthRange);
  // A half-typed day is '' — nothing is asked until both ends are days, in order.
  const askable = range.from !== '' && range.to !== '' && range.from <= range.to;

  const costs = useQuery({
    queryKey: tripKeys.vehicleCosts(vehicle.id, range),
    queryFn: () => fetchVehicleCosts(vehicle.id, range),
    enabled: askable,
  });
  const page = costs.data;

  return (
    <Modal isOpen onClose={onClose} title={vehicle.display} className="max-w-4xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <StatusPill tone={vehicle.archived ? 'gray' : 'green'}>
            {t(vehicle.archived ? 'statusArchived' : 'statusActive')}
          </StatusPill>
          <span>
            {t('fuelPolicyLabel')}:{' '}
            <span className="font-medium text-gray-900">
              {t(vehicle.dailyFuelCheckRequired ? 'fuelPolicyRequired' : 'fuelPolicyNotApplicable')}
            </span>
          </span>
          {vehicle.note && <span className="text-gray-500">· {vehicle.note}</span>}
        </div>

        <section aria-labelledby="vehicle-costs-heading" className="space-y-3">
          <h3 id="vehicle-costs-heading" className="text-base font-semibold text-gray-900">
            {t('vehicleCostsSection')}
          </h3>

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
      </div>
    </Modal>
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

function CostRow({ cost }: Readonly<{ cost: VehicleCost }>) {
  const { t, language } = useLanguage();
  const trip = cost.sourceTrip;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{formatCalendarDay(cost.businessDate, language)}</TableCell>
      <TableCell>{t('costFuel')}</TableCell>
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
