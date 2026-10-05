import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TripBoardRow } from '@/types/tripBoard';
import { cn } from '@/utils/cn';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay, formatTime } from '@/utils/format/datetime';
import { TripStatusBadge } from '../components/TripStatusBadge';
import { ACTION_LABELS, bookingActions, placeLine, urgencyOf } from './bookingPresentation';
import { CrewPill, RequestsPill, UrgencyPill } from './BookingSignals';

/**
 * One booking in the list — what dispatch scans for, and nothing else: when,
 * for whom, from where to where, on which lorries, and where it stands.
 *
 * ★ THE WHOLE ROW SELECTS, AND THE CREW BUTTON SITS BESIDE IT, NOT INSIDE.
 * A button inside a button is not something a screen reader or a keyboard can
 * operate, so the row is two siblings: the selecting button, and the one
 * action worth a click without opening the trip — the crew queue's.
 *
 * ★ EVERYTHING ELSE IS THE DETAIL PANEL'S. Prices, costs, contacts and the
 * record's metadata are not scanned down a list; showing every field here is
 * what made the old board a spreadsheet.
 */
export function BookingListItem({
  trip,
  number,
  selected,
  now,
  onSelect,
  onAssign,
}: Readonly<{
  trip: TripBoardRow;
  /** STT, continued across pages — row 1 of page 2 is 21, not 1. */
  number: number;
  selected: boolean;
  now: number;
  onSelect: (tripId: string) => void;
  onAssign: (tripId: string) => void;
}>) {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const crewAction = bookingActions(trip, can).find((action) => action === 'assign' || action === 'reassign');
  const pickup = placeLine(trip.pickupLocation, trip.pickupAddress) ?? t('notSelected');
  const delivery = placeLine(trip.deliveryLocation, trip.deliveryAddress) ?? t('notSelected');

  return (
    // Side by side from `sm`; on a phone the crew button drops under the row,
    // so the facts get the full width instead of a truncated half.
    <li
      className={cn(
        'flex flex-col gap-2 px-4 py-3 transition-colors sm:flex-row sm:items-start sm:gap-3',
        selected ? 'bg-blue-50/70' : 'hover:bg-gray-50',
      )}
    >
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(trip.id)}
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-6 text-gray-400 tabular-nums">{number}</span>
          <span className="font-medium whitespace-nowrap text-gray-900">
            {formatCalendarDay(trip.scheduledOn, language)}
          </span>
          {trip.pickupAt && (
            <span className="font-medium text-blue-700 tabular-nums">{formatTime(trip.pickupAt, language)}</span>
          )}
          <TripStatusBadge status={trip.status} />
          <CrewPill trip={trip} />
          <RequestsPill tripId={trip.id} />
          <UrgencyPill urgency={urgencyOf(trip, now)} />
        </span>
        <span className="mt-1 block truncate font-semibold text-gray-900 sm:pl-8">
          {trip.customer?.name ?? t('notSelected')}
          {trip.cargoInfo && (
            <span className="font-normal text-gray-500"> · {trip.cargoInfo.split('\n')[0]}</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-600 sm:pl-8">
          <span className="truncate">{pickup}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-label="→" />
          <span className="truncate">{delivery}</span>
        </span>
        {trip.assignments.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-x-4 text-sm sm:pl-8">
            {trip.assignments.map((turn) => (
              <span key={turn.id} className="whitespace-nowrap">
                {/* A pair the migration could not backfill says so, never a blank plate. */}
                <span className="font-medium text-gray-900">
                  {turn.vehicle ? formatPlate(turn.vehicle.plate) : t('dispatchMissingVehicle')}
                </span>{' '}
                <span className="text-gray-600">{turn.driver.displayName}</span>
              </span>
            ))}
          </span>
        )}
      </button>
      {crewAction && (
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 self-start px-3 text-xs text-gray-700"
          onClick={() => onAssign(trip.id)}
        >
          {t(ACTION_LABELS[crewAction])}
        </Button>
      )}
    </li>
  );
}
