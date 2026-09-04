import { Link } from 'react-router-dom';
import { ChevronRight, Clock, Flag, MapPin, Truck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/common/PageHeader';
import { QueueStates } from '@/components/common/DecisionQueue';
import { StatusPill } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyTrips } from '@/hooks/driver';
import { driverErrorKey } from '@/utils/driverErrors';
import { formatCalendarDay, formatTime } from '@/utils/format/datetime';
import type { DriverTrip } from '@/types/driver';

/**
 * What am I driving.
 *
 * ★ THE LIST TAKES NO PARAMETER, AND THAT IS THE SECURITY MODEL VISIBLE IN THE
 * URL. The server reads the caller's own assignments, so there is no id a
 * client could supply to widen it and nothing to filter here.
 *
 * ★ CARDS RATHER THAN A TABLE. A driver scanning this on a phone needs to find
 * one trip and open it; a table asks them to track a row across columns with a
 * thumb over half the screen. Each card answers the one question — where from,
 * where to, when — and the whole card opens the trip.
 *
 * ★ NO EXECUTION STATE ON THIS SCREEN, because the list endpoint carries none:
 * events live on the detail. Nothing here guesses a stage from the plan.
 */
export default function DriverTripsPage() {
  const { t, language } = useLanguage();
  const { trips, loading, error, reload } = useMyTrips();

  const idle = !loading && !error;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('driverMyTrips')}
        subtitle={idle && trips.length > 0 ? `${trips.length} ${t('driverTripUnit')}` : undefined}
      />

      {!idle || trips.length === 0 ? (
        <Card size="sm">
          <QueueStates
            loading={loading}
            showLoading
            forbidden={false}
            error={Boolean(error)}
            errorMessage={error ? t(driverErrorKey(error)) : undefined}
            onRetry={reload}
            empty={idle && trips.length === 0}
            emptyKey="driverNoTrips"
          />
        </Card>
      ) : null}

      {idle && trips.length > 0 ? (
        <ul aria-label={t('driverMyTrips')} className="space-y-3">
          {trips.map((trip) => (
            <li key={trip.tripId}>
              <TripCard trip={trip} language={language} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TripCard({ trip, language }: Readonly<{ trip: DriverTrip; language: 'vi' | 'en' }>) {
  const { t } = useLanguage();

  const window =
    trip.scheduledPickupAt || trip.scheduledDeliveryAt
      ? [trip.scheduledPickupAt, trip.scheduledDeliveryAt]
          .map((at) => (at ? formatTime(at, language) : '…'))
          .join(' – ')
      : null;

  return (
    <Link
      to={`/driver/trips/${trip.tripId}`}
      // ★ THE WHOLE CARD IS THE TARGET, not a link inside it. A thumb on a
      // moving lorry does not reliably hit a 14px caption.
      className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Card size="sm" className="transition-colors hover:bg-muted/40">
        <CardContent className="flex items-center gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-base font-semibold">{trip.customer?.name ?? t('driverNotSet')}</p>
              <StatusPill tone="gray">{formatCalendarDay(trip.scheduledOn, language)}</StatusPill>
            </div>

            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Truck className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{trip.vehicle?.plate ?? t('driverNotSet')}</span>
            </p>

            <div className="space-y-1 text-sm">
              <p className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="line-clamp-1">
                  <span className="text-muted-foreground">{t('driverPickup')}: </span>
                  {trip.pickupAddress ?? t('driverNotSet')}
                </span>
              </p>
              <p className="flex items-start gap-1.5">
                <Flag className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="line-clamp-1">
                  <span className="text-muted-foreground">{t('driverDelivery')}: </span>
                  {trip.deliveryAddress ?? t('driverNotSet')}
                </span>
              </p>
            </div>

            {window ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                <span className="tabular-nums">{window}</span>
              </p>
            ) : null}
          </div>

          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </CardContent>
      </Card>
    </Link>
  );
}
