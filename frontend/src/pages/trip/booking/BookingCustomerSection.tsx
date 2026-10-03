import { useLanguage } from '@/contexts/LanguageContext';
import type { TripCustomer } from '@/types/trip';
import { CargoField, CustomerField, NoteField } from '../components/TripEntryFields';
import type { TripEntry } from '../entry/useTripEntryForm';
import { BookingSection } from './BookingSection';

/** 1 · Who the run is for and what it carries — the customer (filed from here if new), the cargo, the note. */
export function BookingCustomerSection({
  entry,
  customers,
  cataloguesLoaded,
  onCatalogueChanged,
}: Readonly<{
  entry: TripEntry;
  customers: TripCustomer[];
  cataloguesLoaded: boolean;
  onCatalogueChanged: () => void;
}>) {
  const { t } = useLanguage();
  return (
    <BookingSection step={1} title={t('bookingSectionCustomer')}>
      <div className="space-y-2">
        <CustomerField
          entry={entry}
          customers={customers}
          cataloguesLoaded={cataloguesLoaded}
          onCatalogueChanged={onCatalogueChanged}
        />
        <p className="text-xs text-gray-500">{t('catalogueHint')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <CargoField entry={entry} />
        <NoteField entry={entry} />
      </div>
    </BookingSection>
  );
}
