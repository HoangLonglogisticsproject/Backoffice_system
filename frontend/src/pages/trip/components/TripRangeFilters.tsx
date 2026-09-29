import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripSchedules } from '@/hooks/trip';
import { TripSortControl } from './TripSortControl';

/**
 * The date range and the order — the filter bar Lịch xe and Lịch sử chuyến
 * share, over the one list hook they share.
 *
 * ★ REAL FILTERS. The range and the order go into the server's query and its
 * cache key (`useTripSchedules`); nothing here narrows or sorts a page in the
 * browser, which would hide rows while the total described others.
 *
 * Two groups on one row: the date range, and the order. The wider gap between
 * them is what says which controls belong together; when the row runs out, the
 * order wraps below as a whole.
 */
export function TripRangeFilters({
  trips,
}: Readonly<{
  trips: Pick<TripSchedules, 'range' | 'setFrom' | 'setTo' | 'resetRange' | 'order' | 'setOrder'>;
}>) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-gray-100 bg-gray-50/50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="trip-from" className="text-xs font-medium whitespace-nowrap text-gray-600">
            {t('dateFrom')}
          </label>
          <Input
            id="trip-from"
            type="date"
            value={trips.range.from}
            onChange={(event) => trips.setFrom(event.target.value)}
            className="h-9 w-[170px] bg-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="trip-to" className="text-xs font-medium whitespace-nowrap text-gray-600">
            {t('dateTo')}
          </label>
          <Input
            id="trip-to"
            type="date"
            value={trips.range.to}
            onChange={(event) => trips.setTo(event.target.value)}
            className="h-9 w-[170px] bg-white"
          />
        </div>

        <Button type="button" variant="outline" className="h-9 bg-white" onClick={trips.resetRange}>
          {t('thisMonth')}
        </Button>
      </div>

      <TripSortControl value={trips.order} onChange={trips.setOrder} />
    </div>
  );
}
