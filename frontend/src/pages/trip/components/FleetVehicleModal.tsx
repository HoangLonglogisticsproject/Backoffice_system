import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '@/components/common/StatusPill';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchVehicleCosts } from '@/api/vehicleCost';
import { tripKeys } from '@/hooks/trip/keys';
import type { ExecutionEventType } from '@/types/driver';
import type { FleetBoard, FleetTurn, FleetVehicleDay } from '@/types/fleet';
import type { TranslationKey } from '@/types/translate';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay, formatDateTime, formatTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { FUEL_LABEL, FUEL_TONE, ISSUE_LABEL, STATE_LABEL, STATE_TONE } from './fleetLabels';
import { VehicleCostsPanel } from './VehicleDetailModal';

/**
 * One lorry's day, opened from "Điều hành xe": Tổng quan, Lịch chạy, Nhiên
 * liệu, Chi phí.
 *
 * ★ "NHIÊN LIỆU" KEEPS TWO THINGS APART. "Khai nhiên liệu đầu ca" is the
 * day's one check and how it was answered; "Giao dịch nhiên liệu trong ngày"
 * is every fill on the lorry's ledger that day — the declaration's own fill
 * among them, marked. The transactions are the catalogue's "Chi phí xe" read
 * for this one day (same route, same cache), so the two never disagree.
 *
 * ★ "CHI PHÍ" IS THE CATALOGUE'S LEDGER, REUSED — and `cost.read`, as its route.
 */
type Section = 'overview' | 'schedule' | 'fuel' | 'costs';
const SECTIONS: readonly Section[] = ['overview', 'schedule', 'fuel', 'costs'];

const PROGRESS_LABEL: Record<ExecutionEventType, TranslationKey> = {
  ARRIVED_PICKUP: 'driverProgressNotStarted',
  PICKUP_CONFIRMED: 'driverStatusAtPickup',
  ARRIVED_DELIVERY: 'driverStatusInTransit',
  DELIVERY_CONFIRMED: 'driverStatusAtDelivery',
};

const progressLabel = (turn: FleetTurn): TranslationKey => {
  if (turn.closed) return 'driverStatusClosed';
  return turn.progress.next ? PROGRESS_LABEL[turn.progress.next] : 'fleetAwaitingApproval';
};

export function FleetVehicleModal({
  day,
  row,
  canReadCosts,
  onClose,
}: Readonly<{ day: FleetBoard; row: FleetVehicleDay; canReadCosts: boolean; onClose: () => void }>) {
  const { t, language } = useLanguage();
  const [section, setSection] = useState<Section>('overview');
  const title = `${formatPlate(row.vehicle.plate)} · ${formatCalendarDay(day.businessDate, language)}`;

  return (
    <Modal isOpen onClose={onClose} title={title} className="max-w-4xl">
      <Tabs
        value={section}
        onValueChange={(next) => setSection(SECTIONS.find((candidate) => candidate === next) ?? 'overview')}
      >
        <TabsList aria-label={t('fleetDetailSections')}>
          <TabsTrigger value="overview">{t('fleetTabOverview')}</TabsTrigger>
          <TabsTrigger value="schedule">{t('fleetTabSchedule')}</TabsTrigger>
          <TabsTrigger value="fuel">{t('fleetTabFuel')}</TabsTrigger>
          {canReadCosts && <TabsTrigger value="costs">{t('fleetTabCosts')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <Overview row={row} />
        </TabsContent>
        <TabsContent value="schedule">
          <Schedule turns={row.turns} />
        </TabsContent>
        <TabsContent value="fuel">
          <FuelPanel day={day} row={row} canReadCosts={canReadCosts} />
        </TabsContent>
        {canReadCosts && (
          <TabsContent value="costs">
            <VehicleCostsPanel vehicleId={row.vehicle.id} />
          </TabsContent>
        )}
      </Tabs>
    </Modal>
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

function Overview({ row }: Readonly<{ row: FleetVehicleDay }>) {
  const { t } = useLanguage();
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <Fact label={t('fleetColState')}>
        <StatusPill tone={STATE_TONE[row.state]}>{t(STATE_LABEL[row.state])}</StatusPill>
      </Fact>
      <Fact label={t('fleetColDrivers')}>{row.drivers.map((driver) => driver.displayName).join(', ') || '—'}</Fact>
      <Fact label={t('fleetColFuel')}>
        <StatusPill tone={FUEL_TONE[row.fuel.obligation]}>{t(FUEL_LABEL[row.fuel.obligation])}</StatusPill>
      </Fact>
      <Fact label={t('fleetTabSchedule')}>
        {row.turns.length} {t('fleetTurns')}
      </Fact>
      <Fact label={t('fuelPolicyLabel')}>
        {t(row.vehicle.dailyFuelCheckRequired ? 'fuelPolicyRequired' : 'fuelPolicyNotApplicable')}
      </Fact>
      <Fact label={t('fleetColIssues')}>
        {row.fuel.issues.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.fuel.issues.map((issue) => (
              <StatusPill key={issue} tone="amber">
                {t(ISSUE_LABEL[issue])}
              </StatusPill>
            ))}
          </span>
        )}
      </Fact>
    </dl>
  );
}

function Schedule({ turns }: Readonly<{ turns: FleetTurn[] }>) {
  const { t, language } = useLanguage();
  if (turns.length === 0) return <p className="py-6 text-center text-sm text-gray-500">{t('fleetNoTurns')}</p>;
  return (
    <ol className="divide-y divide-gray-100 rounded-lg border border-gray-100">
      {turns.map((turn) => (
        <li key={turn.assignmentId} className="flex flex-wrap items-start justify-between gap-3 p-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-gray-900">
              {turn.scheduledPickupAt ? `${formatTime(turn.scheduledPickupAt, language)} · ` : ''}
              {turn.pickupName ?? '—'} → {turn.deliveryName ?? '—'}
            </p>
            <p className="text-xs text-gray-500">
              {formatCalendarDay(turn.scheduledOn, language)} · {turn.customerName ?? '—'} · {turn.driver.displayName}
            </p>
          </div>
          <p className="text-sm whitespace-nowrap">
            <span className="font-semibold tabular-nums">{turn.progress.reached}/4</span> · {t(progressLabel(turn))}
          </p>
        </li>
      ))}
    </ol>
  );
}

function FuelPanel({ day, row, canReadCosts }: Readonly<{ day: FleetBoard; row: FleetVehicleDay; canReadCosts: boolean }>) {
  const { t, language } = useLanguage();
  const { check } = row.fuel;
  const range = { from: day.businessDate, to: day.businessDate };
  const fills = useQuery({
    queryKey: tripKeys.vehicleCosts(row.vehicle.id, range),
    queryFn: () => fetchVehicleCosts(row.vehicle.id, range),
    enabled: canReadCosts,
  });

  return (
    <div className="space-y-5">
      <section aria-labelledby="fleet-check" className="space-y-2">
        <h3 id="fleet-check" className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
          {t('fleetCheckSection')}
        </h3>
        <StatusPill tone={FUEL_TONE[row.fuel.obligation]}>{t(FUEL_LABEL[row.fuel.obligation])}</StatusPill>
        {check ? (
          <dl className="grid gap-4 rounded-lg bg-gray-50 p-3 sm:grid-cols-3">
            <Fact label={t('fleetCheckBy')}>{check.declaredBy.displayName}</Fact>
            <Fact label={t('fleetCheckAt')}>{formatDateTime(check.declaredAt, language)}</Fact>
            {check.amount !== null ? <Fact label={t('fleetCheckAmount')}>{formatMoney(check.amount)}</Fact> : null}
          </dl>
        ) : (
          <p className="text-sm text-gray-600">
            {t(row.fuel.obligation === 'REQUIRED_MISSING' ? 'fleetCheckMissing' : 'fleetCheckNotRequired')}
          </p>
        )}
      </section>

      <section aria-labelledby="fleet-fills" className="space-y-2">
        <h3 id="fleet-fills" className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
          {t('fleetFillsSection')}
        </h3>
        {canReadCosts ? (
          <>
            {fills.data ? (
              <p className="text-sm text-gray-600">
                {t('fleetFillsTotal')}:{' '}
                <span className="text-lg font-semibold text-gray-900 tabular-nums">{formatMoney(fills.data.totalAmount)}</span>{' '}
                · {fills.data.total} {t('vehicleCostsTransactions')}
              </p>
            ) : null}
            {fills.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {t('loadFailed')}
              </p>
            ) : null}
            {fills.data?.items.length === 0 ? <p className="text-sm text-gray-500">{t('fleetFillsNone')}</p> : null}
            {fills.data && fills.data.items.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <Table>
                  <TableHeader className="bg-gray-50/50">
                    <TableRow>
                      <TableHead>{t('fleetCheckAt')}</TableHead>
                      <TableHead>{t('vehicleCostsColSource')}</TableHead>
                      <TableHead className="text-right">{t('vehicleCostsColAmount')}</TableHead>
                      <TableHead className="text-right">{t('vehicleCostsColLiters')}</TableHead>
                      <TableHead className="text-right">{t('vehicleCostsColOdometer')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fills.data.items.map((fill) => (
                      <TableRow key={fill.id}>
                        <TableCell className="whitespace-nowrap">{formatTime(fill.createdAt, language)}</TableCell>
                        <TableCell>
                          <StatusPill tone={fill.id === check?.vehicleCostId ? 'blue' : 'gray'}>
                            {t(fill.id === check?.vehicleCostId ? 'fleetFillFromCheck' : 'fleetFillLater')}
                          </StatusPill>
                          <span className="block text-xs text-gray-500">{fill.createdByUser.displayName}</span>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatMoney(fill.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fill.liters ? formatMoney(fill.liters) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fill.odometerKm === null ? '—' : formatMoney(String(fill.odometerKm))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-gray-600">
            {row.fuel.fills} {t('vehicleCostsTransactions')} · {t('fleetMoneyHidden')}
          </p>
        )}
      </section>
    </div>
  );
}
