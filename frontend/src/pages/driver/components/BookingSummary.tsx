import { Package, StickyNote } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatCalendarWeekday, formatTime } from '@/utils/format/datetime';
import type { DriverOpenBooking } from '@/types/openBooking';
import { RouteStop } from './AssignmentCard';

/**
 * What a driver needs to decide on a booking that is not theirs yet: when,
 * from where to where, what — in that order, as on their own trips' cards.
 *
 * ★ ONLY WHAT THE SERVER SENT, AND IT SENT LITTLE ON PURPOSE. A place name and
 * its area, never an address line, a customer or a contact; no figure of any
 * kind. Shared by the open booking and the driver's own request, which show
 * the same projection.
 */
export function BookingSummary({ booking }: Readonly<{ booking: DriverOpenBooking }>) {
  const { t, language } = useLanguage();
  const time = booking.scheduledPickupAt ? formatTime(booking.scheduledPickupAt, language) : null;

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-baseline gap-x-2">
        {time ? (
          <>
            <span className="text-2xl leading-none font-semibold tabular-nums">{time}</span>{' '}
          </>
        ) : null}
        <span className={time ? 'text-sm text-muted-foreground' : 'font-medium'}>
          {formatCalendarWeekday(booking.scheduledOn, language)}
          {time ? null : ` · ${t('driverNoPickupTime')}`}
        </span>
      </p>

      <ol>
        <RouteStop label={t('driverPickup')} address={booking.pickup.name} area={booking.pickup.area} />
        <RouteStop label={t('driverDelivery')} address={booking.delivery.name} area={booking.delivery.area} />
      </ol>

      {booking.cargoInfo ? (
        <p className="flex gap-2 text-sm">
          <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 wrap-anywhere">
            <span className="text-muted-foreground">{t('openBookingCargo')}:</span> {booking.cargoInfo}
          </span>
        </p>
      ) : null}
      {booking.driverInstructions ? (
        <p className="flex gap-2 text-sm">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">
            <span className="text-muted-foreground">{t('openBookingNote')}:</span> {booking.driverInstructions}
          </span>
        </p>
      ) : null}
    </div>
  );
}
