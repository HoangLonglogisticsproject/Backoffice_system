import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import type { TranslationKey } from '@/types/translate';
import {
  TRIP_BOARD_SORTS,
  type SortDirection,
  type TripBoardOrder,
  type TripBoardSort,
} from '@/types/tripBoard';

const SORT_LABELS: Record<TripBoardSort, TranslationKey> = {
  executionDate: 'tripSortExecutionDate',
  bookingCreated: 'tripSortBookingCreated',
  lastUpdated: 'tripSortLastUpdated',
};

const DIRECTIONS: readonly { value: SortDirection; label: TranslationKey }[] = [
  { value: 'desc', label: 'sortNewestFirst' },
  { value: 'asc', label: 'sortOldestFirst' },
];

const isSort = (value: string): value is TripBoardSort =>
  TRIP_BOARD_SORTS.some((sort) => sort === value);

const isDirection = (value: string): value is SortDirection =>
  DIRECTIONS.some((direction) => direction.value === value);

// The same look as the date inputs beside it (`Input` at h-9 on white).
const SELECT_CLASS =
  'h-9 rounded-lg border border-input bg-white px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * The board's order: which date, and which way.
 *
 * ★ IT ONLY ASKS THE SERVER. The chosen order goes into the list's query and
 * its cache key; nothing here sorts rows. A page is not the result set, so a
 * browser-side sort would reorder twenty rows of a list of hundreds.
 *
 * ponytail: two native `<select>`s. Three and two fixed options, keyboard and
 * screen-reader behaviour from the platform — the same call `ApprovalsPage`
 * made for its filter.
 */
export function TripSortControl({
  value,
  onChange,
}: Readonly<{ value: TripBoardOrder; onChange: (order: TripBoardOrder) => void }>) {
  const { t } = useLanguage();

  // ONE GROUP: the label and both selects on a single gap, so they read as one
  // control. Minimum widths rather than fixed ones, so a longer translation
  // grows the select instead of clipping it; on a narrow screen the pieces
  // wrap in place instead of overflowing.
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="trip-sort" className="text-xs font-medium whitespace-nowrap text-gray-600">
        {t('tripSortBy')}
      </label>
      <select
        id="trip-sort"
        value={value.sort}
        onChange={(event) => {
          const sort = event.target.value;
          if (isSort(sort)) onChange({ ...value, sort });
        }}
        className={cn(SELECT_CLASS, 'min-w-52')}
      >
        {TRIP_BOARD_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {t(SORT_LABELS[sort])}
          </option>
        ))}
      </select>
      <select
        aria-label={t('tripSortDirection')}
        value={value.direction}
        onChange={(event) => {
          const direction = event.target.value;
          if (isDirection(direction)) onChange({ ...value, direction });
        }}
        className={cn(SELECT_CLASS, 'min-w-48')}
      >
        {DIRECTIONS.map((direction) => (
          <option key={direction.value} value={direction.value}>
            {t(direction.label)}
          </option>
        ))}
      </select>
    </div>
  );
}
