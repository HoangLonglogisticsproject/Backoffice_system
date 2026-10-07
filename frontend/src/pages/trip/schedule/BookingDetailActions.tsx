import { Archive, ArrowLeftRight, Download, Pencil, UserPlus, Wallet, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TripBoardRow } from '@/types/tripBoard';
import { ACTION_LABELS, bookingActions, type BookingAction } from './bookingPresentation';

export interface BookingActionHandlers {
  onAssign: (tripId: string) => void;
  onEdit: (trip: TripBoardRow) => void;
  onCosts: (tripId: string) => void;
  onArchive: (trip: TripBoardRow) => void;
}

const ICONS: Record<BookingAction, LucideIcon> = {
  assign: UserPlus,
  reassign: ArrowLeftRight,
  edit: Pencil,
  costs: Wallet,
  archive: Archive,
};

type Emphasis = 'primary' | 'secondary' | 'quiet';

const EMPHASIS = {
  primary: { variant: 'default', className: 'bg-blue-600 text-white hover:bg-blue-700' },
  secondary: { variant: 'outline', className: 'text-gray-700' },
  quiet: { variant: 'ghost', className: 'ml-auto text-gray-500 hover:text-gray-900' },
} as const;

const emphasisOf = (action: BookingAction): Emphasis => {
  if (action === 'archive') return 'quiet';
  return action === 'assign' || action === 'reassign' ? 'primary' : 'secondary';
};

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
 * costs and the export are outlined; archiving — destructive, and confirmed in
 * its own dialog — is the quietest, set apart at the end. Every button keeps
 * its words beside its icon, and the row simply wraps when the panel narrows.
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
  const office = (action: BookingAction) => (
    <Action key={action} icon={ICONS[action]} emphasis={emphasisOf(action)} onClick={run[action]}>
      {t(ACTION_LABELS[action])}
    </Action>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
      {actions.filter((action) => action !== 'archive').map(office)}
      <Action icon={Download} emphasis="secondary" onClick={() => onExport(trip.id)}>
        {t('bookingExportAction')}
      </Action>
      {actions.includes('archive') && office('archive')}
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
