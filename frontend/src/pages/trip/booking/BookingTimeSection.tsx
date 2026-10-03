import { useLanguage } from '@/contexts/LanguageContext';
import { DeliveryAtField, PickupDateField, PickupHourField } from '../components/TripEntryFields';
import type { TripEntry } from '../entry/useTripEntryForm';
import { BookingSection } from './BookingSection';

/**
 * 2 · When — the pickup day, its hour, and the delivery.
 *
 * ★ THE BOOKING BOUNDARY IS THE SERVER'S, MIRRORED BY THE FIELDS THEMSELVES
 * (`pickupControls`): no past day; today only with an hour, and not one
 * already gone; any later day may leave the hour open.
 */
export function BookingTimeSection({ entry }: Readonly<{ entry: TripEntry }>) {
  const { t } = useLanguage();
  return (
    <BookingSection step={2} title={t('bookingSectionTime')}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]">
        <PickupDateField entry={entry} />
        <PickupHourField entry={entry} />
        <div className="sm:col-span-2 lg:col-span-1">
          <DeliveryAtField entry={entry} />
        </div>
      </div>
    </BookingSection>
  );
}
