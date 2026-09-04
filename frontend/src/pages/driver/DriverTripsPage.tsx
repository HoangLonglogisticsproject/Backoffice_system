import { Link } from 'react-router-dom';
import { ChevronRight, MapPin, Package, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyTrips } from '@/hooks/driver';
import { driverErrorKey } from '@/utils/driverErrors';
import { formatCalendarDay, formatDateTime } from '@/utils/format/datetime';
import { formatPlate } from '@/utils/format';
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
 * thumb over half the screen.
 */
export default function DriverTripsPage() {
  const { t, language } = useLanguage();
  const { trips, loading, error, reload } = useMyTrips();

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t('driverLoading')}</p>;
  }

  if (error) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t(driverErrorKey(error))}</p>
        <Button size="lg" onClick={reload}>
          {t('driverRetry')}
        </Button>
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className="py-16 text-center">
        <Truck className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('driverNoTrips')}</p>
      </div>
    );
  }

  return (
    <section aria-label={t('driverMyTrips')} className="space-y-3">
      <h1 className="text-lg font-semibold">{t('driverMyTrips')}</h1>

      <ul className="space-y-3">
        {trips.map((trip) => (
          <li key={trip.tripId}>
            <TripCard trip={trip} language={language} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TripCard({ trip, language }: Readonly<{ trip: DriverTrip; language: 'vi' | 'en' }>) {
  const { t } = useLanguage();

  return (
    <Link
      to={`/driver/trips/${trip.tripId}`}
      // ★ THE WHOLE CARD IS THE TARGET, not a link inside it. A thumb on a
      // moving lorry does not reliably hit a 14px caption.
      className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {formatCalendarDay(trip.scheduledOn, language)}
        </p>

        <p className="truncate font-medium">
          {trip.customer?.name ?? t('driverNotSet')}
        </p>

        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Truck className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{formatPlate(trip.vehicle?.plate) || t('driverNotSet')}</span>
        </p>

        {trip.pickupAddress ? (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{trip.pickupAddress}</span>
          </p>
        ) : null}

        {trip.scheduledPickupAt ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Package className="size-3.5 shrink-0" aria-hidden />
            <span>
              {t('driverScheduled')}: {formatDateTime(trip.scheduledPickupAt, language)}
            </span>
          </p>
        ) : null}
      </div>

      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
