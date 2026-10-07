import { MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripLocationRef } from '@/types/trip';
import type { TripBoardRow } from '@/types/tripBoard';
import { cn } from '@/utils/cn';
import { formatTimeOnDay } from '@/utils/format/datetime';
import { Unset } from '../components/TripCells';
import { Section } from './DetailSection';

/**
 * Where from and where to — the block Operations scans first, so the strongest
 * one: the two ends as a short timeline, the place's name above what was booked
 * for it.
 *
 * ★ THE TWO ENDS AS BOOKED, NOTHING DRAWN BETWEEN THEM. A hollow marker for the
 * pickup, a filled one for the delivery, one thin line joining them — no map,
 * no distance, no invented route. Each end's time is the clock and the day
 * (`formatTimeOnDay`): delivery routinely falls on a later day.
 */
export function BookingRouteSection({ trip }: Readonly<{ trip: TripBoardRow }>) {
  const { t } = useLanguage();
  return (
    <Section title={t('bookingSectionRoute')} icon={MapPin}>
      <ol className="space-y-4">
        <Stop
          label={t('colPickup')}
          place={trip.pickupLocation}
          address={trip.pickupAddress}
          contact={trip.pickupContact}
          at={trip.pickupAt}
          first
        />
        <Stop
          label={t('colDelivery')}
          place={trip.deliveryLocation}
          address={trip.deliveryAddress}
          contact={trip.deliveryContact}
          at={trip.deliveryAt}
        />
      </ol>
    </Section>
  );
}

function Stop({
  label,
  place,
  address,
  contact,
  at,
  first = false,
}: Readonly<{
  label: string;
  place: TripLocationRef | null;
  address: string | null;
  contact: string | null;
  at: string | null;
  first?: boolean;
}>) {
  const { language } = useLanguage();
  const empty = !place && !address && !contact && !at;
  return (
    <li
      className={cn(
        'relative pl-6',
        // The connector: from under the pickup's marker down to the delivery's.
        first && 'before:absolute before:top-4 before:-bottom-3 before:left-1.5 before:w-px before:-translate-x-1/2 before:bg-blue-200',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute top-1 left-0 size-3 rounded-full border-2 border-blue-600', first ? 'bg-white' : 'bg-blue-600')}
      />
      <p className="text-xs font-medium text-gray-500">{label}</p>
      {empty ? (
        <Unset />
      ) : (
        <div className="mt-0.5 space-y-0.5 text-sm">
          {place && <p className="text-base font-semibold text-gray-900">{place.name}</p>}
          {address && <p className="whitespace-pre-line text-gray-700">{address}</p>}
          {contact && <p className="whitespace-pre-line text-gray-500">{contact}</p>}
          {at && <p className="pt-0.5 font-medium text-blue-700 tabular-nums">{formatTimeOnDay(at, language)}</p>}
        </div>
      )}
    </li>
  );
}
