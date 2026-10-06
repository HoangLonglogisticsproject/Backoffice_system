import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TripBoardRow } from '@/types/tripBoard';
import { cn } from '@/utils/cn';
import { ACTION_LABELS, bookingActions, type BookingAction } from './bookingPresentation';

export interface BookingActionHandlers {
  onAssign: (tripId: string) => void;
  onEdit: (trip: TripBoardRow) => void;
  onCosts: (tripId: string) => void;
  onArchive: (trip: TripBoardRow) => void;
}

/**
 * What the office may do to the selected booking, as named actions.
 *
 * ★ NO LIFECYCLE CONTROL. The driver starts the run and asks to close it; the
 * SuperAdmin's approval closes it. So nothing here starts, rewinds or completes
 * a trip — which of the office's actions appear is `bookingActions`, so the list
 * and this panel can never disagree. Each one opens its own dialog, which waits
 * for the server.
 *
 * ★ PLUS ONE READ, ALWAYS: "Tải booking PNG" — whoever sees the trip may export
 * it, so it is not one of `bookingActions` and does not depend on the status.
 */
export function BookingDetailActions({
  trip,
  onExport,
  ...handlers
}: Readonly<{ trip: TripBoardRow; onExport: (tripId: string) => void } & BookingActionHandlers>) {
  const { t } = useLanguage();
  const { can } = useSession();
  const actions = bookingActions(trip, can);

  const run: Record<BookingAction, () => void> = {
    assign: () => handlers.onAssign(trip.id),
    reassign: () => handlers.onAssign(trip.id),
    edit: () => handlers.onEdit(trip),
    costs: () => handlers.onCosts(trip.id),
    archive: () => handlers.onArchive(trip),
  };

  return (
    <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
      {actions.map((action) => (
        <Button
          key={action}
          type="button"
          variant={action === 'assign' ? 'default' : 'outline'}
          size="lg"
          onClick={run[action]}
          // The crew is the one thing still to do on an uncrewed booking.
          className={cn(action === 'assign' && 'bg-blue-600 text-white hover:bg-blue-700')}
        >
          {t(ACTION_LABELS[action])}
        </Button>
      ))}
      <Button type="button" variant="outline" size="lg" onClick={() => onExport(trip.id)}>
        {t('bookingExportAction')}
      </Button>
    </div>
  );
}
