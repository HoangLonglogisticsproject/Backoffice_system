import { useLanguage } from '@/contexts/LanguageContext';
import { TRIP_ASSIGNMENT_FILTERS, type TripAssignmentFilter } from '@/types/trip';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';

/** What each tab is called. */
const TAB_LABELS: Record<TripAssignmentFilter, TranslationKey> = {
  all: 'tripTabAll',
  unassigned: 'tripTabUnassigned',
  assigned: 'tripTabAssigned',
};

/**
 * The crew line, as three tabs over one list.
 *
 * ★ THE MIDDLE TAB IS A WORK QUEUE, NOT A STATUS. A trip joins it the moment it
 * is entered and leaves it the moment somebody is put on the row — which is why
 * the count rides on the tab itself: dispatch needs to see that there is work
 * waiting without having to go and look for it.
 *
 * ★ AND EVERY ONE OF THEM IS A SERVER QUERY. Each tab is its own `?assignment=`
 * with its own `total`, so the pagination underneath always describes the list
 * on screen. Filtering `trips.items` here instead would break the one promise
 * this screen's pagination makes.
 *
 * `role="tablist"` with real buttons rather than links: the tab is not in the
 * URL, so there is nothing to navigate to, and a screen reader is told these
 * three are alternatives rather than three unrelated buttons.
 */
export function AssignmentTabs({
  value,
  onChange,
  unassignedCount,
}: Readonly<{
  value: TripAssignmentFilter;
  onChange: (filter: TripAssignmentFilter) => void;
  unassignedCount: number | null;
}>) {
  const { t } = useLanguage();

  // No border and no outer padding here: those belong to the row that wraps
  // this tablist and the export button beside it. A tablist owns only its tabs.
  return (
    <div role="tablist" aria-label={t('tripTabsLabel')} className="flex flex-wrap items-center gap-1">
      {TRIP_ASSIGNMENT_FILTERS.map((filter) => {
        const selected = filter === value;
        // Zero is worth showing on the tab you are standing on — "0" is the
        // answer to "is anything waiting?" — but a badge on an unselected tab
        // that says nothing is waiting is just noise.
        const showCount =
          filter === 'unassigned' && unassignedCount !== null && (selected || unassignedCount > 0);

        return (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(filter)}
            className={cn(
              'flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              selected ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t(TAB_LABELS[filter])}
            {showCount && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  selected ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700',
                )}
              >
                {unassignedCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
