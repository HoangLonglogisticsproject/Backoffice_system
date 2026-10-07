import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNow } from '@/hooks/useNow';
import type { TripBoardRow } from '@/types/tripBoard';
import { formatCalendarDay, formatTime } from '@/utils/format/datetime';
import { TripStatusBadge } from '../components/TripStatusBadge';
import { urgencyOf } from './bookingPresentation';
import { BookingDetailActions, type BookingActionHandlers } from './BookingDetailActions';
import { BookingCrewSection, BookingCustomerSection, BookingMetaSection, BookingPricingSection } from './BookingDetailSections';
import { BookingRouteSection } from './BookingRouteSection';
import { CrewPill, RequestsPill, UrgencyPill } from './BookingSignals';
import { BookingExportDialog } from './export/BookingExportDialog';

type Props = Readonly<
  {
    /** The selected booking, re-read from the page on every render; `null` when none is. */
    trip: TripBoardRow | null;
    /** Side column beside the list, or a dialog over it. */
    wide: boolean;
    onClose: () => void;
  } & BookingActionHandlers
>;

/**
 * The selected booking — everything the list leaves out, and what may be done.
 *
 * ★ TWO CONTAINERS, ONE BODY. Wide, it is a column beside the list that stays
 * in view while the list scrolls, and says what it is for when nothing is
 * selected. Narrow, it is the app's own `Modal` — full screen on a phone —
 * which already traps focus, closes on Escape and locks the page behind it, so
 * the narrow layout inherits all of that rather than re-implementing a drawer.
 *
 * ★ THE BOOKING PNG PREVIEW OPENS FROM HERE, AND WHERE IT MOUNTS MATTERS.
 * Narrow, INSIDE the detail dialog, so Escape closes the preview alone. Wide,
 * BESIDE the column — never in it: the sticky column is a stacking context of
 * its own, and a dialog inside it would sit under the app's top bar.
 */
export function BookingDetail({ trip, wide, onClose, ...handlers }: Props) {
  const { t } = useLanguage();
  const [exporting, setExporting] = useState<string | null>(null);
  const preview = exporting && <BookingExportDialog tripId={exporting} onClose={() => setExporting(null)} />;
  const body = trip && <Body trip={trip} onExport={setExporting} {...handlers} />;

  if (!wide) {
    return (
      <Modal
        isOpen={trip !== null}
        onClose={onClose}
        title={t('bookingDetailTitle')}
        className="h-dvh max-h-dvh max-w-none rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl"
      >
        {body}
        {preview}
      </Modal>
    );
  }

  return (
    <>
      <aside
        aria-label={t('bookingDetailTitle')}
        className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm xl:sticky xl:top-0 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto"
      >
        {body || <p className="text-sm text-gray-500">{t('bookingSelectHint')}</p>}
      </aside>
      {preview}
    </>
  );
}

function Body({
  trip,
  onExport,
  ...handlers
}: Readonly<{ trip: TripBoardRow; onExport: (tripId: string) => void } & BookingActionHandlers>) {
  const { t, language } = useLanguage();
  const now = useNow();

  return (
    <div className="space-y-5">
      {/* Who and when first, then where the run stands — the trip's identity. */}
      <header className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm text-gray-500 tabular-nums">
          <CalendarClock className="size-4 text-gray-400" aria-hidden="true" />
          {formatCalendarDay(trip.scheduledOn, language)}
          {trip.pickupAt && ` · ${formatTime(trip.pickupAt, language)}`}
        </p>
        <h2 className="text-lg leading-snug font-semibold text-gray-900">{trip.customer?.name ?? t('notSelected')}</h2>
        <div className="flex flex-wrap gap-1.5">
          <TripStatusBadge status={trip.status} />
          <CrewPill trip={trip} />
          <RequestsPill tripId={trip.id} />
          <UrgencyPill urgency={urgencyOf(trip, now)} />
        </div>
      </header>
      <BookingDetailActions trip={trip} onExport={onExport} {...handlers} />
      <BookingRouteSection trip={trip} />
      <BookingCustomerSection trip={trip} />
      <BookingCrewSection trip={trip} />
      <BookingPricingSection trip={trip} onCosts={() => handlers.onCosts(trip.id)} />
      <BookingMetaSection trip={trip} />
    </div>
  );
}
