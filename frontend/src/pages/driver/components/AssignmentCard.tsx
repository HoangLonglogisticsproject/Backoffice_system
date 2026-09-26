import { Link } from 'react-router-dom';
import { ChevronRight, Truck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatPlate } from '@/utils/format';
import { formatTime } from '@/utils/format/datetime';
import { OPENED_FROM_SCHEDULE } from '@/utils/driverSchedule';
import type { DriverTrip } from '@/types/driver';

/**
 * One assignment on the schedule: when to be there, from where, to where, in
 * which lorry — in that order, because that is the order a driver needs it.
 *
 * ★ ONE CARD PER ASSIGNMENT, OPENED BY ITS ID (ADR-0004, DL-115). A driver on
 * two lorries of one trip holds two turns with two timelines, so they are two
 * cards; the plate is what tells them apart, and it is on the card.
 *
 * ★ THE WHOLE CARD IS ONE TAP TARGET, AND ONE SHORT LINK. A thumb on a moving
 * lorry does not reliably hit a caption, so "Xem chuyến" stretches over the
 * card (`after:inset-0`). A screen reader hears one link per card, named by
 * its time and plate — not the whole card read out as a link name — and there
 * is no control nested inside another.
 *
 * ★ NO STATUS HERE, AND THAT IS THE DATA'S ANSWER, NOT A DESIGN CHOICE. The
 * list endpoint carries no execution or completion state (contract §5.4.1);
 * the detail leads with it. No customer either: the route and the time are
 * the job, and the customer is on the detail.
 */
export function AssignmentCard({ assignment }: Readonly<{ assignment: DriverTrip }>) {
  const { t, language } = useLanguage();
  const pickupAt = assignment.scheduledPickupAt;
  const time = pickupAt ? formatTime(pickupAt, language) : null;
  const plate = formatPlate(assignment.vehicle?.plate) || t('driverNotSet');

  return (
    <Card className="relative transition-colors hover:ring-foreground/20 active:bg-muted/60 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50">
      <CardContent className="space-y-3">
        {time ? (
          <p className="flex items-baseline gap-2">
            <span className="text-2xl leading-none font-semibold tabular-nums">{time}</span>{' '}
            <span className="text-xs text-muted-foreground">{t('fieldPickupAt')}</span>
          </p>
        ) : (
          <p className="font-medium text-muted-foreground">{t('driverNoPickupTime')}</p>
        )}

        <ol>
          <RouteStop label={t('driverPickup')} address={assignment.pickupAddress} />
          <RouteStop label={t('driverDelivery')} address={assignment.deliveryAddress} />
        </ol>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="flex min-w-0 items-center gap-2 font-medium">
            <Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('driverVehicle')}:</span>{' '}
            <span className="truncate">{plate}</span>
          </p>
          <Link
            to={`/driver/assignments/${encodeURIComponent(assignment.assignment.id)}`}
            state={OPENED_FROM_SCHEDULE}
            className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-blue-700 outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            {t('driverViewTrip')}
            <span className="sr-only">
              , {time ?? t('driverNoPickupTime')}, {t('driverVehicle')} {plate}
            </span>
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One end of the route. The first stop draws the line down to the second, so
 * the two read as one journey however many lines each address wraps to.
 *
 * ★ TWO LINES OF ADDRESS, NOT ONE. A Vietnamese address is long and its end —
 * the ward, the district — is often what tells two warehouses apart; the
 * detail shows it whole.
 */
function RouteStop({ label, address }: Readonly<{ label: string; address: string | null }>) {
  const { t } = useLanguage();

  return (
    <li className="group/stop relative flex gap-3 first:pb-3 first:before:absolute first:before:top-4 first:before:-bottom-1 first:before:left-1.25 first:before:w-px first:before:bg-border">
      <span
        aria-hidden
        className="relative mt-1 size-2.75 shrink-0 rounded-full border-2 border-blue-600 bg-background group-last/stop:bg-blue-600"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={address ? 'line-clamp-2 text-sm font-medium wrap-anywhere' : 'text-sm text-muted-foreground'}>
          {address ?? t('driverNotSet')}
        </p>
      </div>
    </li>
  );
}

/** The card's shape while the schedule loads: time, two stops, the lorry row. */
export function AssignmentCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-20" />
        <div className="space-y-3">
          {[0, 1].map((stop) => (
            <div key={stop} className="flex gap-3">
              <Skeleton className="mt-1 size-2.75 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}
