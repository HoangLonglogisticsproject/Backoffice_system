import type { UpdateTripInput } from '@/api/tripSchedule';
import type { TripScheduleWithRefs } from '@/types/trip';
import { businessClockOf, businessInstant, todayAsCalendarDay } from '@/utils/format/datetime';

/**
 * The trip form's three temporal fields, and how they become a payload.
 *
 *   "Ngày lấy hàng *"       `scheduled_on` — the planned pickup DATE, always known
 *   "Giờ lấy hàng"          the hour on that date, when known → `pickup_at`
 *   "Thời gian giao hàng"   `delivery_at`, date AND hour, when known
 *
 * ★ AN UNKNOWN HOUR STAYS UNKNOWN. A booking made before anybody knows the
 * hour sends the date and `pickupAt: null` — never midnight, never a guess.
 *
 * ★ EVERY HOUR HERE IS ON THE BUSINESS CLOCK (Hồ Chí Minh), the pickup's and
 * the delivery's alike, so "17:36 → 16:36" means the same two instants on any
 * machine, and the pickup hour lands on the date it is typed beside.
 */
export interface FormTimes {
  scheduledOn: string;
  /** `HH:mm` on the business clock, or `''` while unknown. */
  pickupTime: string;
  /** A `datetime-local` value on the business clock, or `''` while unknown. */
  deliveryAt: string;
}

/** `YYYY-MM-DDTHH:mm` on the business clock — what a `datetime-local` control holds. */
const businessLocalOf = (iso: string): string =>
  `${todayAsCalendarDay(new Date(iso))}T${businessClockOf(iso)}`;

const instantOfLocal = (local: string): string | null => {
  const [day, time] = local.split('T');
  return day && time ? businessInstant(day, time) : null;
};

/** The fields as a form opens on `trip` — or on a new booking for today. */
export const timesOf = (trip: TripScheduleWithRefs | null): FormTimes =>
  trip
    ? {
        // The STRING the server sent — never through `new Date`, which is
        // midnight UTC and a day early west of it.
        scheduledOn: trip.scheduledOn,
        pickupTime: trip.pickupAt ? businessClockOf(trip.pickupAt) : '',
        deliveryAt: trip.deliveryAt ? businessLocalOf(trip.deliveryAt) : '',
      }
    : { scheduledOn: todayAsCalendarDay(), pickupTime: '', deliveryAt: '' };

/** The exact instants the fields name, as ISO strings — `null` for an unknown one. */
export const instantsOf = (times: FormTimes): { pickupAt: string | null; deliveryAt: string | null } => ({
  pickupAt: times.scheduledOn && times.pickupTime ? businessInstant(times.scheduledOn, times.pickupTime) : null,
  deliveryAt: instantOfLocal(times.deliveryAt),
});

/**
 * The temporal half of the payload.
 *
 * ★ ON A CORRECTION, ONLY WHAT WAS TOUCHED. A record entered with no hours can
 * take a note or a price without being asked for any, and a day typed before
 * the one-day rule is not re-dated by an unrelated save. Touching the date or
 * the hour sends the PAIR, which the server holds to one day; touching the
 * delivery sends it, and the timeline is checked then.
 */
export const timesPayload = (times: FormTimes, trip: TripScheduleWithRefs | null): UpdateTripInput => {
  const { pickupAt, deliveryAt } = instantsOf(times);
  if (!trip) return { scheduledOn: times.scheduledOn, pickupAt, deliveryAt };

  const was = timesOf(trip);
  const pickupTouched = times.scheduledOn !== was.scheduledOn || times.pickupTime !== was.pickupTime;
  return {
    ...(pickupTouched ? { scheduledOn: times.scheduledOn, pickupAt } : {}),
    ...(times.deliveryAt === was.deliveryAt ? {} : { deliveryAt }),
  };
};
