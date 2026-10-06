import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Clock, Truck, User } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useMarkNotificationRead,
  useNotificationStream,
  useNotifications,
} from '@/hooks/notifications';
import { useCompletionQueue } from '@/hooks/trip/useCompletionReview';
import { cn } from '@/utils/cn';
import { formatCalendarDay, formatTimeOnDay } from '@/utils/format/datetime';
import { formatPlate } from '@/utils/format';
import { notifySuccess } from '@/utils/toast';
import type { Notification, NotificationSignal } from '@/types/notification';
import type { OperationalBoardRow } from '@/types/operationalBoard';

/**
 * What the office has been told, in the only place it needs telling: a driver
 * has finished a turn and is waiting for a decision (0036).
 *
 * ★ THE BELL IS NOT THE QUEUE, AND THE BADGE IS NOT A BACKLOG. The review
 * screen is the authority on what is actually waiting, read live under
 * permission. The badge answers a different question: how many submissions have
 * arrived that nobody here has looked at yet. They can disagree on purpose — a
 * reviewer who opened the panel and then decided nothing has been TOLD (badge
 * clear) and still has work (queue full).
 *
 * ★ OPENING A ROW MARKS THAT ROW SEEN, NOT ALL OF THEM. Each is stamped by its
 * own id through the existing route; there is no "mark all" endpoint and this
 * deliberately does not invent one, because a bulk stamp would also silence
 * types this panel never showed.
 *
 * ★ COUNTS `COMPLETION_SUBMITTED` ALONE, never the server's `unreadCount`. That
 * figure is every type the account holds, and an account that somehow held a
 * driver's notification would show a number this screen cannot explain or clear.
 *
 * ⚠ THE COUNT IS BOUNDED BY THE LIST THE SERVER RETURNS (50 rows, newest
 * first). Fifty unseen completions is a review queue nobody is working, and the
 * number on a bell is not how that gets noticed.
 */

const isSubmission = (notification: Notification): boolean =>
  notification.type === 'COMPLETION_SUBMITTED';

/** Where a notification leads. The trip, so the review screen can open it. */
const reviewPathFor = (tripId: string): string =>
  `/dispatch/completion-review?trip=${encodeURIComponent(tripId)}`;

export function CompletionBell() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // ★ THE SOCKET IS OPENED HERE, NOT ON THE SHELL — so it exists only for an
  // account that can act on what comes down it. `DriverLayout` opens its own on
  // the shell because every driver has something to hear; in the Backoffice only
  // the reviewer does, and a per-account connection ceiling is not worth
  // spending on a channel nobody is listening to. It closes when this unmounts,
  // which a sign-out does.
  //
  // ★ AND THE TOAST FIRES ON A LIVE SIGNAL ONLY. `onSignal` is not called on
  // connect, on a tab regaining focus or on mount — so opening the Backoffice
  // with three completions already waiting shows a badge of three and no
  // popups, while one arriving WHILE somebody works shows exactly one.
  useNotificationStream((signal: NotificationSignal) => {
    if (signal.type !== 'COMPLETION_SUBMITTED') return;
    notifySuccess('notifCompletionSubmitted', {
      action: { labelKey: 'reviewOpen', onClick: () => navigate(reviewPathFor(signal.tripId)) },
    });
  });

  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();

  // Only once somebody looks: see `useCompletionQueue`. These rows are what let
  // a line name a lorry and a driver — the notification row itself carries
  // neither, and 0020 is deliberate about that.
  const { rows } = useCompletionQueue({ enabled: open });

  const submissions = (data?.items ?? []).filter(isSubmission);
  const waiting = submissions.filter((notification) => notification.readAt === null);

  const openReview = (notification: Notification) => {
    // A courtesy stamp, not a gate: the navigation does not wait for it, and a
    // failure to stamp must not keep anybody off the review screen.
    if (notification.readAt === null) markRead.mutate(notification.id);
    setOpen(false);
    navigate(reviewPathFor(notification.tripId));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          waiting.length > 0
            ? `${t('notifPanelTitle')} (${waiting.length})`
            : t('notifPanelTitle')
        }
        className="relative flex size-9 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Bell className="size-5" aria-hidden />
        {waiting.length > 0 ? (
          <span
            data-testid="completion-badge"
            aria-hidden
            className={cn(
              'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center',
              'rounded-full bg-red-600 px-1 text-[10px] leading-none font-semibold text-white',
            )}
          >
            {waiting.length > 99 ? '99+' : waiting.length}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{t('notifPanelTitle')}</p>
          {waiting.length > 0 ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 tabular-nums">
              {waiting.length}
            </span>
          ) : null}
        </div>

        {submissions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('driverNoNotifications')}
          </p>
        ) : (
          <ul>
            {submissions.map((notification) => (
              <li key={notification.id}>
                <NotificationRow
                  notification={notification}
                  row={rows.find((candidate) => candidate.tripId === notification.tripId) ?? null}
                  language={language}
                  onOpen={() => openReview(notification)}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border px-4 py-2.5">
          <Link
            to="/dispatch/completion-review"
            onClick={() => setOpen(false)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('notifPanelSeeQueue')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One line of the panel.
 *
 * ★ THE LORRY AND THE DRIVER ARE A COURTESY, NOT A REQUIREMENT. They come from
 * the review queue, which is fetched beside this and may not have answered yet —
 * or may no longer hold the trip at all, because somebody just decided it. A
 * missing plate is drawn as a missing plate; it is never a reason to hide a
 * notification the server did send.
 */
function NotificationRow({
  notification,
  row,
  language,
  onOpen,
}: Readonly<{
  notification: Notification;
  row: OperationalBoardRow | null;
  language: 'vi' | 'en';
  onOpen: () => void;
}>) {
  const { t } = useLanguage();
  const unread = notification.readAt === null;
  const plate = formatPlate(row?.vehicle?.plate);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
        unread && 'bg-primary/5',
      )}
    >
      <span
        aria-hidden
        className={cn('mt-0.5 shrink-0 [&_svg]:size-4', unread ? 'text-primary' : 'text-muted-foreground')}
      >
        <Truck />
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm', unread ? 'font-semibold' : 'font-medium')}>
          {t('notifCompletionSubmitted')}
        </span>

        <span className="mt-0.5 block text-sm text-muted-foreground">
          {t('driverTripOn')} {formatCalendarDay(notification.tripScheduledOn, language)}
          {plate ? ` · ${plate}` : ''}
        </span>

        {row?.driver?.displayName ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <User className="size-3" aria-hidden />
            {row.driver.displayName}
          </span>
        ) : null}

        <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" aria-hidden />
          {formatTimeOnDay(notification.createdAt, language)}
        </span>
      </span>

      {unread ? <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" /> : null}
    </button>
  );
}
