import { ArrowLeftRight, Download, Pencil, UserPlus, Wallet, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TripBoardRow } from '@/types/tripBoard';
import { ACTION_LABELS, bookingActions, type BookingAction } from './bookingPresentation';

export interface BookingActionHandlers {
  onAssign: (tripId: string) => void;
  onEdit: (trip: TripBoardRow) => void;
  onCosts: (tripId: string) => void;
}

/** The panel's actions — every office action but archiving, which is the list row's. */
type PanelAction = Exclude<BookingAction, 'archive'>;

const ICONS: Record<PanelAction, LucideIcon> = {
  assign: UserPlus,
  reassign: ArrowLeftRight,
  edit: Pencil,
  costs: Wallet,
};

type Emphasis = 'primary' | 'secondary';

const EMPHASIS = {
  primary: { variant: 'default', className: 'bg-blue-600 text-white hover:bg-blue-700' },
  secondary: { variant: 'outline', className: 'text-gray-700' },
} as const;

const isPanelAction = (action: BookingAction): action is PanelAction => action !== 'archive';

/**
 * What the office may do to the selected booking, as named actions.
 *
 * ★ NO LIFECYCLE CONTROL. The driver starts the run and asks to close it; the
 * SuperAdmin's approval closes it. So nothing here starts, rewinds or completes
 * a trip — which of the office's actions appear is `bookingActions`, so the list
 * and this panel can never disagree. Each one opens its own dialog, which waits
 * for the server.
 *
 * ★ PLUS ONE READ, ALWAYS: "Xuất PNG" — whoever sees the trip may export it, so
 * it is not one of `bookingActions` and does not depend on the status.
 *
 * ★ A TOOLBAR WITH A HIERARCHY, NOT A ROW OF EQUAL BUTTONS. The crew action is
 * the work most often left to do, so it is the one filled button; editing,
 * costs and the export are outlined. Archiving is NOT here: it is the list
 * row's one action, so this toolbar stays four buttons and the crew action
 * appears once on the screen. Every button keeps its words beside its icon,
 * and the row simply wraps when the panel narrows.
 */
export function BookingDetailActions({
  trip,
  onExport,
  ...handlers
}: Readonly<{ trip: TripBoardRow; onExport: (tripId: string) => void } & BookingActionHandlers>) {
  const { t } = useLanguage();
  const { can } = useSession();
  const actions = bookingActions(trip, can).filter(isPanelAction);

  const run: Record<PanelAction, () => void> = {
    assign: () => handlers.onAssign(trip.id),
    reassign: () => handlers.onAssign(trip.id),
    edit: () => handlers.onEdit(trip),
    costs: () => handlers.onCosts(trip.id),
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
      {actions.map((action) => (
        <Action
          key={action}
          icon={ICONS[action]}
          emphasis={action === 'assign' || action === 'reassign' ? 'primary' : 'secondary'}
          onClick={run[action]}
        >
          {t(ACTION_LABELS[action])}
        </Action>
      ))}
      <Action icon={Download} emphasis="secondary" onClick={() => onExport(trip.id)}>
        {t('bookingExportAction')}
      </Action>
    </div>
  );
}

function Action({
  icon: Icon,
  emphasis,
  onClick,
  children,
}: Readonly<{ icon: LucideIcon; emphasis: Emphasis; onClick: () => void; children: string }>) {
  const { variant, className } = EMPHASIS[emphasis];
  return (
    <Button type="button" variant={variant} size="lg" onClick={onClick} className={className}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {children}
    </Button>
  );
}
