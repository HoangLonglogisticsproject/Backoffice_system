import { Link } from 'react-router-dom';
import { ChevronRight, Clock, Flag, MapPin, Truck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/common/PageHeader';
import { QueueStates } from '@/components/common/DecisionQueue';
import { StatusPill } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyAssignments } from '@/hooks/driver';
import { driverErrorKey } from '@/utils/driverErrors';
import { formatCalendarDay, formatTime } from '@/utils/format/datetime';
import { formatPlate } from '@/utils/format';
import type { DriverTrip } from '@/types/driver';

/**
 * What am I driving.
 *
 * ★ THE LIST TAKES NO PARAMETER, AND THAT IS THE SECURITY MODEL VISIBLE IN THE
 * URL. The server reads the caller's own assignments, so there is no id a
 * client could supply to widen it and nothing to filter here.
 *
 * ★ GROUPED BY TRIP, OPENED BY ASSIGNMENT (ADR-0004). A driver may hold two
 * lorries on one trip. The trip — customer, pickup, delivery, day — is one
 * card; each lorry under it is its own turn with its own timeline, and tapping
 * the lorry opens that turn. Rendering two identical trip cards would make the
 * driver guess which was which.
 *
 * ★ NO EXECUTION STATE ON THIS SCREEN, because the list endpoint carries none:
 * events live on the detail. Nothing here guesses a stage from the plan.
 */
export default function DriverTripsPage() {
  const { t, language } = useLanguage();
  const { assignments, loading, error, reload } = useMyAssignments();

  const idle = !loading && !error;
  const trips = groupByTrip(assignments);

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
          {trips.map((group) => (
            <li key={group.tripId}>
              <TripCard group={group} language={language} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One trip and every turn the driver holds on it, in the order the server gave them. */
interface TripGroup {
  tripId: string;
  trip: DriverTrip;
  turns: DriverTrip[];
}

const groupByTrip = (assignments: readonly DriverTrip[]): TripGroup[] => {
  const groups = new Map<string, TripGroup>();
  for (const turn of assignments) {
    const group = groups.get(turn.tripId);
    if (group) group.turns.push(turn);
    else groups.set(turn.tripId, { tripId: turn.tripId, trip: turn, turns: [turn] });
  }
  return [...groups.values()];
};

function TripCard({ group, language }: Readonly<{ group: TripGroup; language: 'vi' | 'en' }>) {
  const { t } = useLanguage();
  const { trip, turns } = group;

  const window =
    trip.scheduledPickupAt || trip.scheduledDeliveryAt
      ? [trip.scheduledPickupAt, trip.scheduledDeliveryAt]
          .map((at) => (at ? formatTime(at, language) : '…'))
          .join(' – ')
      : null;

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-base font-semibold">{trip.customer?.name ?? t('driverNotSet')}</p>
            <StatusPill tone="gray">{formatCalendarDay(trip.scheduledOn, language)}</StatusPill>
          </div>

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

        {/* ★ ONE ROW PER LORRY, AND THE ROW IS THE TARGET. A thumb on a moving
            lorry does not reliably hit a 14px caption, so the whole row opens
            the turn. */}
        <ul aria-label={t('driverMyAssignments')} className="divide-y divide-border rounded-lg border border-border">
          {turns.map((turn) => (
            <li key={turn.assignment.id}>
              <Link
                to={`/driver/assignments/${turn.assignment.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-sm font-medium">
                  {formatPlate(turn.vehicle?.plate) || t('driverNotSet')}
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
