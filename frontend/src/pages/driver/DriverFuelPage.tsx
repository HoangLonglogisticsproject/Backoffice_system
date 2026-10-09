import { useState } from 'react';
import { Fuel, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyWorkday } from '@/hooks/driver';
import { useMyFuelSubmissions } from '@/hooks/driver/fuel';
import { useBusinessToday } from '@/hooks/useBusinessToday';
import type { DriverFuelSubmission, FuelReviewStatus } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';
import { fuelActionOf, type FuelAction } from '@/utils/driverFuel';
import { formatPlate } from '@/utils/format';
import { formatTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { FUEL_STATUS_LABEL, FUEL_STATUS_TONE } from '@/utils/fuelStatus';
import { DriverLoadError } from './components/DriverLoadError';
import { FuelSubmissionDialog } from './components/FuelSubmissionDialog';
import { WorkdayFuelDialog } from './components/WorkdayFuelDialog';

type Tab = 'today' | 'waiting' | 'needs_info' | 'done' | 'rejected';
const TABS: Array<{ key: Tab; label: TranslationKey; statuses?: FuelReviewStatus[] }> = [
  { key: 'today', label: 'driverFuelTabToday' },
  { key: 'waiting', label: 'driverFuelTabWaiting', statuses: ['submitted'] },
  { key: 'needs_info', label: 'driverFuelTabNeedsInfo', statuses: ['needs_info'] },
  { key: 'done', label: 'driverFuelTabDone', statuses: ['approved', 'paid'] },
  { key: 'rejected', label: 'driverFuelTabRejected', statuses: ['rejected'] },
];

/**
 * "Nhiên liệu" — the driver's fuel, phone first.
 *
 * ★ "TÔI VỪA ĐỔ DẦU CHO XE TÔI ĐANG CHẠY." The buttons come from today's work:
 * one per lorry the driver runs today, through that day's turn — the server
 * names the lorry and the day. No ledger, no cost, no matching: a fill and its
 * photos go to Accounting, and this page shows where each one stands —
 * waiting, asked about, approved, paid or refused.
 */
export default function DriverFuelPage() {
  const { t } = useLanguage();
  const today = useBusinessToday();
  const [tab, setTab] = useState<Tab>('today');
  const [action, setAction] = useState<FuelAction | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { workday, loading: dayLoading } = useMyWorkday();
  const chosen = TABS.find((entry) => entry.key === tab) ?? TABS[0];
  const list = useMyFuelSubmissions(tab === 'today' ? { day: today } : { statuses: chosen?.statuses });
  const asked = useMyFuelSubmissions({ statuses: ['needs_info'] });
  const actions = (workday?.vehicles ?? []).flatMap((lorry) => {
    const next = fuelActionOf(lorry);
    return next ? [next] : [];
  });

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t('driverFuelNav')}</h1>
        <p className="text-sm text-muted-foreground">{t('driverFuelPageIntro')}</p>
      </header>

      <section aria-label={t('driverFuelRecordTitle')} className="space-y-2">
        {dayLoading && !workday ? <Skeleton className="h-14 w-full rounded-xl" /> : null}
        {actions.map((next) => (
          <Button key={next.lorry.vehicle.id} size="lg" className="h-14 w-full justify-start text-base" onClick={() => setAction(next)}>
            <Plus className="size-5" aria-hidden />
            {t(next.kind === 'check' ? 'driverWorkdayDeclare' : 'driverFuelRecord')} · {formatPlate(next.lorry.vehicle.plate)}
          </Button>
        ))}
        {!dayLoading && actions.length === 0 ? <p className="text-sm text-muted-foreground">{t('driverFuelNoLorryToday')}</p> : null}
      </section>

      <div role="tablist" aria-label={t('driverFuelNav')} className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              'min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium',
              tab === entry.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
            )}
          >
            {t(entry.label)}
            {entry.key === 'needs_info' && (asked.data?.length ?? 0) > 0 ? ` (${asked.data?.length})` : ''}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={t(chosen?.label ?? 'driverFuelTabToday')} className="space-y-2">
        {list.isLoading ? <Skeleton className="h-24 w-full rounded-xl" /> : null}
        {list.error ? <DriverLoadError error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data?.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t('driverFuelEmpty')}</p> : null}
        <ul className="space-y-2">
          {(list.data ?? []).map((fill) => (
            <li key={fill.fuelTransactionId}>
              <SubmissionCard fill={fill} onOpen={() => setOpen(fill.fuelTransactionId)} />
            </li>
          ))}
        </ul>
      </div>

      {action ? <WorkdayFuelDialog key={`${action.kind}-${action.assignmentId}`} action={action} onDone={() => setAction(null)} /> : null}
      {open ? <FuelSubmissionDialog id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function SubmissionCard({ fill, onOpen }: Readonly<{ fill: DriverFuelSubmission; onOpen: () => void }>) {
  const { t, language } = useLanguage();
  return (
    <Card>
      <CardContent className="p-0">
        <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 p-4 text-left">
          <Fuel className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{formatPlate(fill.vehicle.plate)}</span>
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', FUEL_STATUS_TONE[fill.status])}>
                {t(FUEL_STATUS_LABEL[fill.status])}
              </span>
            </span>
            <span className="block text-sm tabular-nums">
              {formatMoney(fill.amount)} đ{fill.liters ? ` · ${fill.liters} L` : ''} · {formatTime(fill.recordedAt, language)}
            </span>
            {fill.statusNote && (fill.status === 'needs_info' || fill.status === 'rejected') ? (
              <span className="block text-sm text-amber-900">“{fill.statusNote}”</span>
            ) : null}
            <span className="block text-xs text-muted-foreground">
              {fill.evidenceCount} {t('driverPhotoCount')}
            </span>
          </span>
        </button>
      </CardContent>
    </Card>
  );
}
