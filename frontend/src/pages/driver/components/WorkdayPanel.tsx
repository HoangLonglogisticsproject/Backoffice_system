import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Fuel, Truck } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DriverEmptyState } from '@/components/driver/DriverEmptyState';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyWorkday, useWorkdayFuel } from '@/hooks/driver';
import type { DriverWorkday, DriverWorkdayTurn, FuelObligation } from '@/types/driver';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';
import { currentAndNext, OPENED_FROM_SCHEDULE } from '@/utils/driverSchedule';
import { formatPlate } from '@/utils/format';
import { formatTime } from '@/utils/format/datetime';
import { DailyFuelDialog } from './DailyFuelDialog';
import { DriverLoadError } from './DriverLoadError';

/**
 * "Hôm nay" — the tab a driver opens on: each lorry they drive
 * today, its fuel answer, the trip they are on and the one after it.
 *
 * ★ EVERYTHING HERE IS THE SERVER'S ANSWER. Which turns are today's work, how
 * far each has got and whether the lorry's check is answered come from
 * `GET /driver/workday`; this file only picks the current and the next turn
 * out of a list already in order.
 *
 * ★ TWO FUEL ACTIONS, NEVER CONFUSED. "Khai nhiên liệu đầu ca" answers the
 * day's check — offered while it is owed and a turn is still open to answer
 * through. "Ghi nhận đổ nhiên liệu" records one more fill and leaves the check
 * alone — offered once the check is answered, or when nothing is left open to
 * answer it through. One lorry, one fill at a time: never both buttons for the
 * same fill, so nobody declares at noon what they bought at noon.
 */

type Lorry = DriverWorkday['vehicles'][number];

const FUEL_LABEL: Record<FuelObligation, TranslationKey> = {
  NOT_REQUIRED: 'fuelObligationNotRequired',
  REQUIRED_MISSING: 'fuelObligationMissing',
  FUEL_ADDED: 'fuelObligationAdded',
  NO_FUEL: 'fuelObligationNone',
};

const FUEL_TONE: Record<FuelObligation, string> = {
  NOT_REQUIRED: 'bg-muted text-muted-foreground',
  REQUIRED_MISSING: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  FUEL_ADDED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
  NO_FUEL: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
};

/** Named by the step still owed — the words the trip screen already uses. */
const PROGRESS_LABEL: Record<NonNullable<DriverWorkdayTurn['progress']['next']>, TranslationKey> = {
  ARRIVED_PICKUP: 'driverProgressNotStarted',
  PICKUP_CONFIRMED: 'driverStatusAtPickup',
  ARRIVED_DELIVERY: 'driverStatusInTransit',
  DELIVERY_CONFIRMED: 'driverStatusAtDelivery',
};

const progressLabel = (turn: DriverWorkdayTurn): TranslationKey => {
  if (turn.closed) return 'driverStatusClosed';
  return turn.progress.next ? PROGRESS_LABEL[turn.progress.next] : 'driverStatusAwaitingCompletion';
};

type FuelAction = { kind: 'check' | 'fill'; lorry: Lorry; assignmentId: string };

export function WorkdayPanel({ onSeeUpcoming }: Readonly<{ onSeeUpcoming: () => void }>) {
  // Nothing in this component body needs a translation any more — the empty
  // state and the cards each ask for their own.
  const { workday, loading, error, reload } = useMyWorkday();
  const { declareCheck, recordFill } = useWorkdayFuel();
  const [action, setAction] = useState<FuelAction | null>(null);

  const lorries = workday?.vehicles ?? [];

  return (
    <section className="space-y-3">
      {/*
        ★ NO HEADING OF ITS OWN ANY MORE. This used to be a card above the tabs
        titled "Ca làm việc hôm nay"; it IS the "Hôm nay" tab now, and the tab is
        what names it — a `tabpanel` is already labelled by its tab, so a second
        heading would say the same thing twice to a screen reader.
      */}
      {loading && !workday ? <Skeleton className="h-40 w-full rounded-xl" /> : null}

      {/* ★ THE ERROR IS SHOWN, NOT SWALLOWED. The panel used to return `null`
          and let the schedule list below report the failure — it is the whole
          tab now, so a silent `null` would read as "no work today", which is a
          different and much worse sentence than "could not load". */}
      {error ? <DriverLoadError error={error} onRetry={reload} /> : null}

      {!loading && !error && lorries.length === 0 ? (
        <DriverEmptyState
          title="driverEmptyTitle"
          message="driverWorkdayEmpty"
          action={{
            label: 'driverEmptySeeUpcoming',
            icon: <CalendarDays aria-hidden />,
            onClick: onSeeUpcoming,
          }}
        />
      ) : null}

      {lorries.length > 0 ? (
        <ul className="space-y-3">
          {lorries.map((lorry) => (
            <li key={lorry.vehicle.id}>
              <LorryCard lorry={lorry} onFuel={setAction} />
            </li>
          ))}
        </ul>
      ) : null}

      {action ? (
        <DailyFuelDialog
          // A fresh dialog each time, so each opening carries its own key.
          key={`${action.kind}-${action.assignmentId}`}
          mode={action.kind}
          plate={action.lorry.vehicle.plate}
          saving={declareCheck.isPending || recordFill.isPending}
          onSubmit={(input) => {
            if (action.kind === 'check') return declareCheck.mutateAsync({ assignmentId: action.assignmentId, input });
            if (input.outcome !== 'fuel_added') throw new Error('A fill always adds fuel.');
            const { outcome: _outcome, ...fill } = input;
            return recordFill.mutateAsync({ assignmentId: action.assignmentId, input: fill });
          }}
          onDeclared={() => setAction(null)}
          onClose={() => setAction(null)}
        />
      ) : null}
    </section>
  );
}

function LorryCard({ lorry, onFuel }: Readonly<{ lorry: Lorry; onFuel: (action: FuelAction) => void }>) {
  const { t, language } = useLanguage();
  const { current, next } = currentAndNext(lorry.turns);
  const plate = formatPlate(lorry.vehicle.plate);
  // Any of today's turns may carry a fill; the one in hand is the natural provenance.
  const fillThrough = current ?? lorry.turns[lorry.turns.length - 1] ?? null;
  // The check is answered through a turn whose trip is still open — the server's rule too.
  const checkThrough = lorry.turns.find((turn) => !turn.closed) ?? null;
  const canDeclare = lorry.fuel === 'REQUIRED_MISSING' && checkThrough !== null;
  const canFill = lorry.fuelOnVehicle && !canDeclare && fillThrough !== null;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <Truck className="size-5 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('driverVehicle')}:</span> {plate}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-muted-foreground">{t('driverWorkdayFuel')}:</span>{' '}
            <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-medium', FUEL_TONE[lorry.fuel])}>
              {t(FUEL_LABEL[lorry.fuel])}
            </span>
          </p>
        </div>

        {current ? (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('driverWorkdayCurrent')}</p>
            <RouteLine turn={current} />
            <Progress turn={current} />
            <Link
              to={`/driver/assignments/${encodeURIComponent(current.assignment.id)}`}
              state={OPENED_FROM_SCHEDULE}
              className={cn(buttonVariants({ size: 'lg' }), 'h-12 w-full text-base')}
            >
              {t('driverWorkdayContinue')}
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('driverWorkdayAllDone')}</p>
        )}

        {next ? (
          <div className="text-sm">
            <p className="text-xs font-medium text-muted-foreground">{t('driverWorkdayNext')}</p>
            <p className="font-medium">
              {next.scheduledPickupAt ? `${formatTime(next.scheduledPickupAt, language)} · ` : ''}
              <RouteText turn={next} />
            </p>
          </div>
        ) : null}

        {canDeclare && checkThrough ? (
          <Button
            variant="outline"
            size="lg"
            className="h-12 w-full"
            onClick={() => onFuel({ kind: 'check', lorry, assignmentId: checkThrough.assignment.id })}
          >
            <Fuel className="size-4" aria-hidden />
            {t('driverWorkdayDeclare')}
          </Button>
        ) : null}
        {canFill && fillThrough ? (
          <Button
            variant="outline"
            size="lg"
            className="h-12 w-full"
            onClick={() => onFuel({ kind: 'fill', lorry, assignmentId: fillThrough.assignment.id })}
          >
            <Fuel className="size-4" aria-hidden />
            {t('driverWorkdayRecordFill')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RouteText({ turn }: Readonly<{ turn: DriverWorkdayTurn }>) {
  const { t } = useLanguage();
  return (
    <>
      {turn.pickupAddress ?? t('driverNotSet')} → {turn.deliveryAddress ?? t('driverNotSet')}
    </>
  );
}

function RouteLine({ turn }: Readonly<{ turn: DriverWorkdayTurn }>) {
  return (
    <p className="line-clamp-2 text-sm font-medium wrap-anywhere">
      <RouteText turn={turn} />
    </p>
  );
}

/** Four steps as four bars and in words — "2/4 · Đang vận chuyển" — never colour alone. */
function Progress({ turn }: Readonly<{ turn: DriverWorkdayTurn }>) {
  const { t } = useLanguage();
  const reached = turn.progress.reached;
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden className="flex gap-1">
        {[0, 1, 2, 3].map((step) => (
          <span key={step} className={cn('h-1.5 w-6 rounded-full', step < reached ? 'bg-blue-600' : 'bg-border')} />
        ))}
      </div>
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{reached}/4</span> · {t(progressLabel(turn))}
      </p>
    </div>
  );
}
