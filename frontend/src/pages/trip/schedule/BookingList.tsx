import { useLanguage } from '@/contexts/LanguageContext';
import type { TripSchedules } from '@/hooks/trip';
import { useNow } from '@/hooks/useNow';
import type { TripAssignmentFilter } from '@/types/trip';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';
import { isApiError } from '@/utils/errors';
import { BookingListItem } from './BookingListItem';

/**
 * ★ THE SENTENCE DEPENDS ON THE TAB. "Không có chuyến nào trong khoảng ngày
 * này" under the uncrewed tab would say the month is empty when what happened
 * is that every trip in it already has a driver — and a dispatcher who believes
 * that goes looking for rows that were never missing.
 */
const TAB_EMPTY_MESSAGES: Record<TripAssignmentFilter, TranslationKey> = {
  all: 'emptyTrips',
  unassigned: 'emptyUnassignedTrips',
  assigned: 'emptyAssignedTrips',
};

/**
 * The page of bookings the server sent, in the server's order, and the four
 * states a list can be in.
 *
 * ★ IT RENDERS THE PAGE AND NEVER NARROWS IT. Every filter is the server's
 * (`useTripSchedules`); dropping or re-sorting rows here would leave `total`
 * and STT describing a list nobody is looking at.
 */
export function BookingList({
  trips,
  selectedId,
  onSelect,
  onAssign,
}: Readonly<{
  trips: Pick<
    TripSchedules,
    'items' | 'firstRowNumber' | 'loading' | 'error' | 'forbidden' | 'showingPreviousPage' | 'assignment'
  >;
  selectedId: string | null;
  onSelect: (tripId: string) => void;
  onAssign: (tripId: string) => void;
}>) {
  const { t } = useLanguage();
  // Read once for the whole page, so twenty rows share one clock.
  const now = useNow();

  return (
    <div className={cn('transition-opacity', trips.showingPreviousPage && 'opacity-60')}>
      {/* Holding the previous page while the next loads stops the list flashing
          empty; dimming it says so, instead of presenting stale rows as the answer. */}
      <ul aria-label={t('bookingListLabel')} className="divide-y divide-gray-100">
        {trips.items.map((trip, index) => (
          <BookingListItem
            key={trip.id}
            trip={trip}
            number={trips.firstRowNumber + index}
            selected={trip.id === selectedId}
            now={now}
            onSelect={onSelect}
            onAssign={onAssign}
          />
        ))}
      </ul>

      {!trips.loading && trips.items.length === 0 && !trips.error && (
        <p className="px-6 py-10 text-center text-sm text-gray-500">{t(TAB_EMPTY_MESSAGES[trips.assignment])}</p>
      )}
      {trips.forbidden && (
        <div className="px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
        </div>
      )}
      {trips.error && !trips.forbidden && (
        // The server's own message when there is one: a 422 says which of the
        // two dates is wrong, and a generic "could not load" throws that away.
        <p className="px-6 py-10 text-center text-sm text-red-600">
          {isApiError(trips.error) ? trips.error.message : t('loadFailed')}
        </p>
      )}
    </div>
  );
}
