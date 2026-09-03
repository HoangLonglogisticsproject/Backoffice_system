import { AlertTriangle, Check, Circle, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import { executionSteps, isOverdue, lateByMinutes, nextEvent } from '@/utils/driverExecution';
import { formatDateTime } from '@/utils/format/datetime';
import type { TranslationKey } from '@/types/translate';
import type { DriverTripDetail, ExecutionEventType } from '@/types/driver';

/**
 * Where the driver is, and the one thing they may do next.
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

interface Props {
  trip: DriverTripDetail;
  /** Injected so a test can pin "now" — the overdue markers depend on it. */
  now: Date;
  onReport: (type: ExecutionEventType) => void;
  reporting: boolean;
  /** The phone is being asked where it is. The button says so instead of spinning mutely. */
  locating?: boolean;
}

export function ExecutionTimeline({
  trip,
  now,
  onReport,
  reporting,
  locating = false,
}: Readonly<Props>) {
  const { t, language } = useLanguage();

  const steps = executionSteps(trip);
  const next = nextEvent(trip.events);

  return (
    <section className="rounded-xl border border-border bg-background p-4">
      <h2 className="mb-4 text-sm font-semibold">{t('driverProgress')}</h2>

      <ol className="space-y-3">
        {steps.map((step) => {
          const overdue = isOverdue(step, now);
          const late =
            step.state === 'done' ? lateByMinutes(step.scheduledAt, step.actualAt, now) : null;

          return (
            <li key={step.type} className="flex gap-3">
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
                <p
                  className={cn(
                    'text-sm',
                    step.state === 'upcoming' ? 'text-muted-foreground' : 'font-medium',
                  )}
                >
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
        })}
      </ol>

      {next ? (
        <NextAction
          next={next}
          located={
            next === 'PICKUP_CONFIRMED'
              ? trip.pickupLocation !== null
              : trip.deliveryLocation !== null
          }
          reporting={reporting}
          locating={locating}
          onReport={onReport}
        />
      ) : (
        <p className="mt-5 rounded-lg bg-muted/60 px-3 py-2 text-center text-sm text-muted-foreground">
          {t('driverAllStepsDone')}
        </p>
      )}
    </section>
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
            'mt-5 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs',
            unlocated
              ? 'bg-destructive/5 font-medium text-destructive'
              : 'bg-muted/60 text-muted-foreground',
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
        className={cn('h-12 w-full text-base', geofenced ? 'mt-3' : 'mt-5')}
        disabled={busy || unlocated}
        onClick={() => onReport(next)}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {locating ? t('driverLocating') : t(ACTION_LABEL[next])}
      </Button>
    </>
  );
}
