import { AlertTriangle, Check, Circle, Clock, Loader2, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import { executionSteps, isOverdue, lateByMinutes, nextEvent, type ExecutionStep } from '@/utils/driverExecution';
import { formatDateTime } from '@/utils/format/datetime';
import type { TranslationKey } from '@/types/translate';
import type { DriverTripDetail, ExecutionEventType } from '@/types/driver';
import { FactRow } from './FactRow';

/**
 * One end of the trip — the pickup or the delivery — as a job to finish.
 *
 * Where it is, who to call, when it was planned, the two events it takes
 * (arrive, confirm) with the plan and the fact on separate lines, and ONE
 * button: the next thing the driver may do here.
 *
 * ★ ONE BUTTON, NEVER FOUR. Showing every event and letting the server refuse
 * three of them teaches somebody standing beside a lorry to guess. `nextEvent`
 * decides which step is live; the rest are history or not yet reachable.
 *
 * ★ SCHEDULED AND ACTUAL ARE NEVER THE SAME LINE. A driver has to be able to
 * see that they were due at 09:00 and arrived at 09:40 — collapsing them into
 * one timestamp is how a delay becomes invisible to the person who caused it.
 *
 * ⚠ NO SLA ANYWHERE. "Past the planned time" is a comparison the clock makes.
 * How late is too late has never been decided, so this never says "late" as a
 * judgement — it shows the minutes and lets a person read them.
 */

const STEP_LABEL: Record<ExecutionEventType, TranslationKey> = {
  ARRIVED_PICKUP: 'driverStepArrivedPickup',
  PICKUP_CONFIRMED: 'driverStepPickupConfirmed',
  ARRIVED_DELIVERY: 'driverStepArrivedDelivery',
  DELIVERY_CONFIRMED: 'driverStepDeliveryConfirmed',
};

const ACTION_LABEL: Record<ExecutionEventType, TranslationKey> = {
  ARRIVED_PICKUP: 'driverActionArrivedPickup',
  PICKUP_CONFIRMED: 'driverActionPickupConfirmed',
  ARRIVED_DELIVERY: 'driverActionArrivedDelivery',
  DELIVERY_CONFIRMED: 'driverActionDeliveryConfirmed',
};

type End = 'pickup' | 'delivery';

const EVENTS_OF: Record<End, readonly ExecutionEventType[]> = {
  pickup: ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED'],
  delivery: ['ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'],
};

interface Props {
  end: End;
  trip: DriverTripDetail;
  /** Injected so a test can pin "now" — the overdue markers depend on it. */
  now: Date;
  onReport: (type: ExecutionEventType) => void;
  reporting: boolean;
  /** The phone is being asked where it is. The button says so instead of spinning mutely. */
  locating?: boolean;
}

export function MilestoneCard({ end, trip, now, onReport, reporting, locating = false }: Readonly<Props>) {
  const { t, language } = useLanguage();

  const steps = executionSteps(trip).filter((step) => EVENTS_OF[end].includes(step.type));
  const next = nextEvent(trip.events);
  const live = next !== null && EVENTS_OF[end].includes(next);
  const done = steps.every((step) => step.state === 'done');

  const address = end === 'pickup' ? trip.pickupAddress : trip.deliveryAddress;
  const contact = end === 'pickup' ? trip.pickupContact : trip.deliveryContact;
  const scheduledAt = end === 'pickup' ? trip.scheduledPickupAt : trip.scheduledDeliveryAt;
  const located = end === 'pickup' ? trip.pickupLocation !== null : trip.deliveryLocation !== null;

  return (
    <Card className={cn(live && 'ring-primary/60', !live && !done && 'opacity-80')}>
      <CardHeader>
        <CardTitle>{t(end === 'pickup' ? 'driverPickup' : 'driverDelivery')}</CardTitle>
        <CardAction>
          <StagePill done={done} live={live} />
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        <FactRow icon={<MapPin />} label={t('driverAddress')} value={address} emphasis />
        <FactRow icon={<Phone />} label={t('driverContact')} value={contact} />
        <FactRow
          icon={<Clock />}
          label={t('driverScheduled')}
          value={scheduledAt ? formatDateTime(scheduledAt, language) : null}
        />

        <ol className="space-y-2.5 border-t border-border pt-3">
          {steps.map((step) => (
            <StepRow key={step.type} step={step} now={now} />
          ))}
        </ol>
      </CardContent>

      {live && next ? (
        <CardFooter className="flex-col items-stretch gap-3">
          <NextAction
            next={next}
            located={located}
            reporting={reporting}
            locating={locating}
            onReport={onReport}
          />
        </CardFooter>
      ) : null}

      {end === 'delivery' && next === null ? (
        <CardFooter>
          <p className="w-full text-center text-sm text-muted-foreground">{t('driverAllStepsDone')}</p>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function StagePill({ done, live }: Readonly<{ done: boolean; live: boolean }>) {
  const { t } = useLanguage();
  if (done) return <StatusPill tone="green">{t('driverStepDone')}</StatusPill>;
  if (live) return <StatusPill tone="amber">{t('driverStageCurrent')}</StatusPill>;
  return <StatusPill tone="gray">{t('driverStepWaiting')}</StatusPill>;
}

/** One event: its label, the plan, the fact, and whether the plan has passed. */
function StepRow({ step, now }: Readonly<{ step: ExecutionStep; now: Date }>) {
  const { t, language } = useLanguage();
  const overdue = isOverdue(step, now);
  const late = step.state === 'done' ? lateByMinutes(step.scheduledAt, step.actualAt, now) : null;

  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
          step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
          step.state === 'current' && 'border-primary text-primary',
          step.state === 'upcoming' && 'border-border text-muted-foreground',
        )}
      >
        {step.state === 'done' ? <Check className="size-3.5" /> : <Circle className="size-2.5" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', step.state === 'upcoming' ? 'text-muted-foreground' : 'font-medium')}>
          {t(STEP_LABEL[step.type])}
        </p>

        {/* The plan and the fact, on separate lines and labelled. */}
        {step.scheduledAt ? (
          <p className="text-xs text-muted-foreground">
            {t('driverScheduled')}: {formatDateTime(step.scheduledAt, language)}
          </p>
        ) : null}

        {step.actualAt ? (
          <p className="text-xs text-foreground">
            {t('driverActual')}: {formatDateTime(step.actualAt, language)}
            {late !== null && late > 0 ? (
              <span className="ml-1 text-muted-foreground">
                ({t('driverLateBy')} {late} {t('driverMinutes')})
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('driverStepWaiting')}</p>
        )}

        {overdue ? (
          <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {t('driverOverdue')}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** The two confirmations are geofenced; the two arrivals are not. */
const isGeofenced = (type: ExecutionEventType): boolean =>
  type === 'PICKUP_CONFIRMED' || type === 'DELIVERY_CONFIRMED';

/**
 * The one button, and what is said above it.
 *
 * ★ THE LOCATION CHECK IS ANNOUNCED BEFORE THE TAP, at both ends of the trip.
 * A permission prompt that appears with no warning gets refused; and a point
 * the office has not located yet is the office's problem — said here, and the
 * button is DISABLED for it, because the server refuses that confirmation
 * without exception and a driver retrying a button that cannot succeed learns
 * nothing.
 */
function NextAction({
  next,
  located,
  reporting,
  locating,
  onReport,
}: Readonly<{
  next: ExecutionEventType;
  /** Whether the point this milestone is measured against has coordinates. */
  located: boolean;
  reporting: boolean;
  locating: boolean;
  onReport: (type: ExecutionEventType) => void;
}>) {
  const { t } = useLanguage();

  const geofenced = isGeofenced(next);
  const unlocated = geofenced && !located;
  const busy = reporting || locating;

  return (
    <>
      {geofenced ? (
        <p
          className={cn(
            'flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs',
            unlocated ? 'bg-destructive/5 font-medium text-destructive' : 'bg-muted/60 text-muted-foreground',
          )}
        >
          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t(unlocated ? 'driverPickupNoCoordinates' : 'driverPickupNeedsLocation')}
        </p>
      ) : null}
      <Button
        size="lg"
        // Full width and tall: this is the primary action of the whole
        // screen and it is pressed with a thumb, outdoors.
        className="h-12 w-full text-base"
        disabled={busy || unlocated}
        onClick={() => onReport(next)}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {locating ? t('driverLocating') : t(ACTION_LABEL[next])}
      </Button>
    </>
  );
}
