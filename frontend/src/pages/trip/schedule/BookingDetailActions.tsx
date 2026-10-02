import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useUpdateTripStatus } from '@/hooks/trip';
import type { TripBoardRow } from '@/types/tripBoard';
import { cn } from '@/utils/cn';
import { ACTION_LABELS, bookingActions, type BookingAction } from './bookingPresentation';
import { CompleteTripDialog } from './CompleteTripDialog';

export interface BookingActionHandlers {
  onAssign: (tripId: string) => void;
  onEdit: (trip: TripBoardRow) => void;
  onCosts: (tripId: string) => void;
  onArchive: (trip: TripBoardRow) => void;
}

/**
 * What may be done to the selected booking, as named domain actions.
 *
 * ★ NO STATUS PICKER. The two board moves are buttons that say what they do,
 * and completion is its own confirmed write; which of them appear is
 * `bookingActions`, so the list and this panel can never disagree.
 *
 * ★ A MOVE WAITS FOR THE SERVER. The pressed button reads "Đang lưu…" until
 * the write is accepted AND the board re-read; nothing changes on screen
 * before that, and a refusal arrives as a toast in the server's words.
 */
export function BookingDetailActions({ trip, ...handlers }: Readonly<{ trip: TripBoardRow } & BookingActionHandlers>) {
  const { t } = useLanguage();
  const { can } = useSession();
  const move = useUpdateTripStatus();
  const [completing, setCompleting] = useState(false);
  const actions = bookingActions(trip, can);
  if (actions.length === 0) return null;

  const pressed = move.isPending ? (move.variables?.to === 'executing' ? 'start' : 'returnToPending') : null;
  const run: Record<BookingAction, () => void> = {
    assign: () => handlers.onAssign(trip.id),
    reassign: () => handlers.onAssign(trip.id),
    start: () => move.mutate({ tripId: trip.id, from: trip.status, to: 'executing' }),
    returnToPending: () => move.mutate({ tripId: trip.id, from: trip.status, to: 'pending' }),
    edit: () => handlers.onEdit(trip),
    costs: () => handlers.onCosts(trip.id),
    complete: () => setCompleting(true),
    archive: () => handlers.onArchive(trip),
  };

  return (
    <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
      {actions.map((action) => (
        <Button
          key={action}
          type="button"
          variant={PRIMARY.has(action) ? 'default' : 'outline'}
          size="lg"
          onClick={run[action]}
          disabled={move.isPending}
          className={cn(PRIMARY.has(action) && 'bg-blue-600 text-white hover:bg-blue-700')}
        >
          {pressed === action ? t('saving') : t(ACTION_LABELS[action])}
        </Button>
      ))}
      <CompleteTripDialog trip={completing ? trip : null} onClose={() => setCompleting(false)} />
    </div>
  );
}

/** The next step of the run — drawn filled; everything else is outlined. */
const PRIMARY: ReadonlySet<BookingAction> = new Set(['assign', 'start']);
