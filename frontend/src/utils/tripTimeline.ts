import type { TranslationKey } from '@/types/translate';
import type { TripEntryMode } from '@/types/trip';
import { todayAsCalendarDay } from '@/utils/format/datetime';

/**
 * The trip form's temporal rules, as the browser checks them before sending.
 *
 * ★ A COURTESY, NOT THE RULE. The server holds both — `trip-timeline.ts` in
 * the backend — and refuses a crafted request with a 422 whatever this says.
 * These exist so the refusal arrives while the person is still typing.
 */

/**
 * Delivery must come strictly after pickup — when BOTH exact instants are
 * known. A pickup with no hour yet has nothing to compare, and nothing here
 * invents one: partial times are the ordinary state of a fresh booking.
 */
export const deliversBeforePickup = (pickupAt: string | null, deliveryAt: string | null): boolean =>
  pickupAt !== null && deliveryAt !== null && new Date(deliveryAt).getTime() <= new Date(pickupAt).getTime();

/**
 * The calendar policy of the entry intent, on the pickup DATE, day-granular on
 * the business calendar the server uses. `null` mode is a correction: an
 * overdue trip is corrected, not re-booked, so no policy applies.
 */
export const calendarError = (
  mode: TripEntryMode | null,
  day: string,
  now: Date = new Date(),
): TranslationKey | null => {
  if (!day || mode === null) return null;
  const today = todayAsCalendarDay(now);
  if (mode === 'operational' && day < today) return 'pickupOnPastDay';
  if (mode === 'historical' && day > today) return 'historicalInFuture';
  return null;
};

/**
 * What to say under the pickup date, the pickup hour and the delivery, or `null`.
 *
 * ★ A RECORDED RUN HAS ENDED, so on "Nhập chuyến cũ" an hour that IS given may
 * not lie after now — 15:00 today is refused at 14:00. An hour left empty is
 * never asked for. A booking takes future hours: that is what it is for.
 */
export const timelineErrors = (
  trip: { scheduledOn: string; pickupAt: string | null; deliveryAt: string | null },
  mode: TripEntryMode | null,
  now: Date = new Date(),
): { scheduledOn: TranslationKey | null; pickupAt: TranslationKey | null; deliveryAt: TranslationKey | null } => {
  const scheduledOn = calendarError(mode, trip.scheduledOn, now);
  // A day already refused says it once, under the date.
  const ahead = (iso: string | null): boolean =>
    mode === 'historical' && scheduledOn === null && iso !== null && new Date(iso).getTime() > now.getTime();

  let deliveryAt: TranslationKey | null = null;
  if (deliversBeforePickup(trip.pickupAt, trip.deliveryAt)) deliveryAt = 'deliveryNotAfterPickup';
  else if (ahead(trip.deliveryAt)) deliveryAt = 'historicalInstantInFuture';

  return { scheduledOn, pickupAt: ahead(trip.pickupAt) ? 'historicalInstantInFuture' : null, deliveryAt };
};
