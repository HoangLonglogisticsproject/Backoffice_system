import { Search, X } from 'lucide-react';
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
 *
 * ★ ON A PHONE THE SEARCH TAKES THE WHOLE ROW, ITS BUTTONS THE NEXT. Below
 * `sm` the box stretches to the card's width and "Tìm" / "Bỏ lọc" wrap beneath
 * it at their own size — the card clips anything wider (`overflow-hidden`), so
 * a fixed 200 px box beside two buttons pushed "Bỏ lọc" out of sight. From `sm`
 * up nothing changes: the same 200 px box, the buttons beside it.
 */
export function TripRangeFilters({
  trips,
}: Readonly<{
  trips: Pick<
    TripSchedules,
    'range'
    | 'setFrom'
    | 'setTo'
    | 'resetRange'
    | 'order'
    | 'setOrder'
    | 'customer'
    | 'setCustomer'
    | 'appliedCustomer'
    | 'submitCustomer'
    | 'clearCustomer'
  >;
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

      {/*
        ★ THE CUSTOMER SEARCH IS A SERVER FILTER LIKE THE RANGE, not a narrowing
        of the page on screen. It goes into the query and the cache key, so the
        rows, the total and `totalPages` keep describing one set.

        ★ A REAL `<form>`, SO ENTER SUBMITS WITHOUT A KEY HANDLER. The browser
        already turns Enter in a single-input form into a submit; writing
        `onKeyDown === 'Enter'` instead is how a control ends up working for a
        mouse and not for the keyboard.

        ⚠ `noValidate` AND `type="button"` ARE NOT USED HERE ON PURPOSE: this
        form submits nothing to a server of its own, so nothing has to be
        suppressed — `onSubmit` prevents the default and sets the filter.
      */}
      <form
        className="flex w-full flex-wrap items-end gap-2 sm:w-auto sm:flex-nowrap"
        onSubmit={(event) => {
          event.preventDefault();
          trips.submitCustomer();
        }}
      >
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label htmlFor="trip-customer-search" className="text-xs font-medium whitespace-nowrap text-gray-600">
            {t('tripCustomerSearchLabel')}
          </label>
          <div className="relative min-w-0 flex-1 sm:flex-initial">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-400"
            />
            <Input
              id="trip-customer-search"
              // `search` so a phone keyboard shows a search key. `autoComplete`
              // off because a customer's name is this board's data, not a form
              // value worth saving into the browser's profile.
              type="search"
              autoComplete="off"
              value={trips.customer}
              onChange={(event) => trips.setCustomer(event.target.value)}
              placeholder={t('tripCustomerSearchHint')}
              className="h-9 w-full bg-white pl-8 sm:w-[200px]"
            />
          </div>
        </div>

        <Button type="submit" className="h-9">
          {t('tripCustomerSearch')}
        </Button>

        {/*
          ★ OFFERED ONLY WHILE A FILTER IS ACTUALLY ON. A permanent "clear"
          beside an empty box is a control that does nothing, and the board's
          one honest signal that rows are being hidden is this button existing.
        */}
        {trips.appliedCustomer === '' ? null : (
          <Button type="button" variant="outline" className="h-9 bg-white" onClick={trips.clearCustomer}>
            <X aria-hidden />
            {t('tripCustomerSearchClear')}
          </Button>
        )}
      </form>

      <TripSortControl value={trips.order} onChange={trips.setOrder} />
    </div>
  );
}
