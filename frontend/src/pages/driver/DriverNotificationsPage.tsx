import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, CheckCircle2, Truck, UserMinus, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMarkNotificationRead, useNotifications } from '@/hooks/notifications';
import { driverErrorKey } from '@/utils/driverErrors';
import { destinationOf } from '@/utils/driverNotifications';
import { cn } from '@/utils/cn';
import { formatCalendarDay, formatDateTime } from '@/utils/format/datetime';
import type { TranslationKey } from '@/types/translate';
import type { Notification, NotificationType } from '@/types/notification';

/**
 * What the driver has been told, newest first.
 *
 * ★ THE LIST IS THE API'S, NOT THE STREAM'S. A phone that slept, changed
 * network or was closed reads this and is up to date; the live stream only
 * makes it arrive sooner while the portal is open.
 *
 * ★ TAPPING ONE GOES WHERE THE EVENT POINTS, AND THE SERVER STILL DECIDES.
 * An assignment leads to the trip; a trip the driver has since been taken off
 * answers 403 there exactly as if the notification had never existed. A
 * notification is a signal, never a key.
 */

const TITLE: Record<NotificationType, TranslationKey> = {
  TRIP_ASSIGNED: 'notifTripAssigned',
  TRIP_UNASSIGNED: 'notifTripUnassigned',
  COMPLETION_REJECTED: 'notifCompletionRejected',
  COMPLETION_APPROVED: 'notifCompletionApproved',
};

const ICON: Record<NotificationType, React.ReactNode> = {
  TRIP_ASSIGNED: <Truck />,
  TRIP_UNASSIGNED: <UserMinus />,
  COMPLETION_REJECTED: <XCircle />,
  COMPLETION_APPROVED: <CheckCircle2 />,
};

export default function DriverNotificationsPage() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { data, isLoading, error } = useNotifications();
  const markRead = useMarkNotificationRead();

  const open = (notification: Notification) => {
    // Read is a courtesy stamp, not a gate: the navigation does not wait for
    // it and a failure to stamp must not keep the driver off their trip.
    if (notification.readAt === null) markRead.mutate(notification.id);
    navigate(destinationOf(notification));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-lg" aria-label={t('driverBackToTrips')} render={<Link to="/driver" />}>
          <ArrowLeft />
        </Button>
        <h1 className="flex items-center gap-2 font-semibold">
          <Bell className="size-4" aria-hidden />
          {t('driverNotifications')}
        </h1>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t('driverLoading')}</p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {t(driverErrorKey(error))}
        </p>
      ) : null}

      {data?.items.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t('driverNoNotifications')}</p>
      ) : null}

      {data && data.items.length > 0 ? (
        <ul className="space-y-2">
          {data.items.map((notification) => {
            const unread = notification.readAt === null;
            const title = t(TITLE[notification.type]);
            const label = unread ? `${title} — ${t('driverUnread')}` : title;
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => open(notification)}
                  aria-label={label}
                  className={cn(
                    'flex w-full gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                    unread ? 'border-primary/40 bg-primary/5' : 'border-border bg-background',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 shrink-0 [&_svg]:size-5',
                      notification.type === 'COMPLETION_REJECTED' ? 'text-destructive' : 'text-primary',
                    )}
                  >
                    {ICON[notification.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', unread ? 'font-semibold' : 'font-medium')}>
                      {t(TITLE[notification.type])}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {t('driverTripOn')} {formatCalendarDay(notification.tripScheduledOn, language)}
                    </span>
                    {notification.detail ? (
                      <span className="mt-1 block whitespace-pre-wrap text-sm">
                        {t('notifReason')}: {notification.detail}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {formatDateTime(notification.createdAt, language)}
                    </span>
                  </span>
                  {unread ? (
                    <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
