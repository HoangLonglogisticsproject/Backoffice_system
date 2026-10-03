import { useLanguage } from '@/contexts/LanguageContext';
import { TripEnd, TripLocationReadiness } from '../components/TripLocationFields';
import type { TripEntry } from '../entry/useTripEntryForm';
import { BookingSection } from './BookingSection';

/**
 * 3 · Where — pickup and delivery side by side, each the customer's place (or
 * a place filed from here) or an address typed by hand, and whether the trip
 * is ready for the driver's location checks.
 */
export function BookingRouteSection({ entry }: Readonly<{ entry: TripEntry }>) {
  const { t } = useLanguage();
  return (
    <BookingSection step={3} title={t('bookingSectionRoute')}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-gray-100 bg-gray-50/60 p-3 sm:p-4">
          <TripEnd entry={entry} end="pickup" />
        </div>
        <div className="min-w-0 rounded-lg border border-gray-100 bg-gray-50/60 p-3 sm:p-4">
          <TripEnd entry={entry} end="delivery" />
        </div>
        {/* Spans both ends — said once a customer's places could make the trip ready. */}
        {entry.form.customerId === null ? null : (
          <div className="md:col-span-2">
            <TripLocationReadiness entry={entry} />
          </div>
        )}
      </div>
    </BookingSection>
  );
}
