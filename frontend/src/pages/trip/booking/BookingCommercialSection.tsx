import { useLanguage } from '@/contexts/LanguageContext';
import { TripPriceFields } from '../components/TripPriceFields';
import type { TripEntry } from '../entry/useTripEntryForm';
import { BookingSection } from './BookingSection';

/**
 * 4 · At what price — the two figures as the price permissions draw them:
 * absent without `trip.price.read`, read-only without `trip.price.write`, the
 * selling price compulsory for whoever may set it (`PriceFields`).
 */
export function BookingCommercialSection({ entry }: Readonly<{ entry: TripEntry }>) {
  const { t } = useLanguage();
  return (
    <BookingSection step={4} title={t('bookingSectionPrice')}>
      <TripPriceFields entry={entry} />
    </BookingSection>
  );
}
