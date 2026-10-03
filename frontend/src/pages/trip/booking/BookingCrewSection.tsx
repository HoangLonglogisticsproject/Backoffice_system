import { useId, useState } from 'react';
import { ChevronDown, Truck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripVehicle } from '@/types/trip';
import { cn } from '@/utils/cn';
import { CrewFields } from '../components/TripCrewFields';
import type { TripEntry } from '../entry/useTripEntryForm';

/**
 * "Phân công xe ngay (không bắt buộc)" — the crew rows, folded away.
 *
 * ★ OPTIONAL, AND OUT OF THE WAY. A booking is taken fast and crewed later
 * from Lịch xe, so this opens only when asked, and the rows are drawn only
 * then. The rows are still one assignment per pair, each sent to the dispatch
 * endpoint once the trip exists (`dispatchCrew`) — nothing about them changes
 * here. Folded with rows in it, it says how many will be sent; a row the
 * server refused keeps it open, so the refusal stays in sight.
 */
export function BookingCrewSection({ entry, vehicles }: Readonly<{ entry: TripEntry; vehicles: TripVehicle[] }>) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const expanded = open || entry.crew.some((row) => row.error !== null);
  const rows = entry.crew.length;

  return (
    <section className="rounded-xl border border-dashed border-gray-300 bg-white/70">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setOpen(!expanded)}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5"
        >
          <Truck className="size-4 shrink-0 text-gray-500" aria-hidden="true" />
          <span className="text-sm font-medium text-gray-800">{t('bookingCrewToggle')}</span>
          {!expanded && rows > 0 ? (
            <span className="text-xs text-blue-700">{`${t('bookingCrewAdded')}: ${rows}`}</span>
          ) : null}
          <span className="ml-auto hidden text-xs font-normal text-gray-500 sm:inline">{t('bookingCrewLater')}</span>
          <ChevronDown
            className={cn('size-4 shrink-0 text-gray-500 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div id={contentId} hidden={!expanded} className="border-t border-dashed border-gray-200 px-4 py-4 sm:px-5">
        {expanded ? <CrewFields entry={entry} vehicles={vehicles} framed={false} /> : null}
      </div>
    </section>
  );
}
