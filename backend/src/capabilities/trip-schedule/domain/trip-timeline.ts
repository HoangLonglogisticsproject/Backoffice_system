import { businessToday as businessDayOf } from '../../../common/pagination/date-range-page-query.dto';

/**
 * When a trip happens: the rules between its board day, its pickup and its
 * delivery. Pure — the service asks, and create and update ask the same
 * questions of the same functions.
 *
 *   created_at    system-owned: when the row was written. Never a user input,
 *                 never back-dated — not even for a trip recorded after it ran.
 *   scheduled_on  the PLANNED PICKUP DATE ("Ngày lấy hàng"), date-level. Always
 *                 known; a trip is booked for a day before anybody knows the hour.
 *   pickup_at     the exact pickup instant, when it is known. Its business day
 *                 IS `scheduled_on` — the two may never disagree (`boardDayFor`).
 *   delivery_at   the exact delivery instant, when it is known.
 */

/**
 * ★ WHY A TRIP IS BEING ENTERED — the create INTENT on `POST /trip-schedules`,
 * never inferred from a date and never a status.
 *
 *   operational   "Thêm chuyến": work still to run — no past day.
 *   historical    "Nhập chuyến cũ": a run that already happened and ended — no
 *                 future day or hour; the server records it finished.
 *
 * The calendar policy differs; every integrity rule — the timeline, catalogue
 * references, prices, permissions — binds both.
 */
export const TRIP_ENTRY_MODES = ['operational', 'historical'] as const;
export type TripEntryMode = (typeof TRIP_ENTRY_MODES)[number];

/**
 * Delivery must come strictly AFTER pickup. Equal instants are refused too: a
 * run that delivers the moment it picks up is a typing mistake, and no rule in
 * this business says otherwise. Either end missing leaves nothing to compare —
 * partial data is legal (see `boardDayFor`).
 */
export const deliversBeforePickup = (pickupAt: Date | null, deliveryAt: Date | null): boolean =>
  pickupAt !== null && deliveryAt !== null && deliveryAt.getTime() <= pickupAt.getTime();

/** Did this write move an instant — `null` and a time being different values. */
export const instantMoved = (next: Date | null, stored: Date | null | undefined): boolean =>
  next?.getTime() !== stored?.getTime();

export type BoardDay =
  | { ok: true; day: string }
  | { ok: false; reason: 'DAY_REQUIRED' | 'NOT_THE_PICKUP_DAY' };

/**
 * The `scheduled_on` a write stores.
 *
 * ★ THE PICKUP IS THE ONE TRUTH. Whenever a write sets the pickup instant, the
 * board day becomes that instant's day on the Hồ Chí Minh calendar; a caller
 * that also sends a day contradicting it is refused rather than overruled, the
 * same way a place and a coordinate for one end are.
 *
 * ★ AND ONLY WHEN THE WRITE MOVES SOMETHING. A stored row whose day disagrees
 * with its pickup (typed before this rule) keeps both through an unrelated
 * edit: re-deriving here would move a trip to another day on a note fix.
 * Changing the pickup, or the day, is what converges them.
 *
 * With no pickup at all the day is whatever was sent or stored — a trip booked
 * for a day before anybody knows the hour is still a trip.
 */
export const boardDayFor = (
  write: { pickupAt: Date | null; scheduledOn: string | undefined },
  stored: { pickupAt: Date | null; scheduledOn: string } | null,
): BoardDay => {
  const dayMoved = write.scheduledOn !== undefined && write.scheduledOn !== stored?.scheduledOn;

  if (write.pickupAt !== null && (dayMoved || instantMoved(write.pickupAt, stored?.pickupAt))) {
    const day = businessDayOf(write.pickupAt);
    return dayMoved && write.scheduledOn !== day
      ? { ok: false, reason: 'NOT_THE_PICKUP_DAY' }
      : { ok: true, day };
  }

  const day = write.scheduledOn ?? stored?.scheduledOn;
  return day === undefined ? { ok: false, reason: 'DAY_REQUIRED' } : { ok: true, day };
};

/** A calendar refusal, and the field it concerns. */
export type CalendarRefusal =
  | { field: 'scheduledOn'; reason: 'PAST_DAY' | 'FUTURE_DAY' }
  | { field: 'pickupAt' | 'deliveryAt'; reason: 'FUTURE_INSTANT' };

/**
 * Why a new trip, entered with `mode` at `now`, is refused — and on which field
 * — or `null`. `undefined` mode — an in-process caller (fixtures, scripts) —
 * has no policy.
 *
 *   operational   day-granular: a dispatcher entering at 10:00 a pickup that
 *                 left at 08:00 today is booking today's work; yesterday is
 *                 history and has its own entry point. Future hours are the
 *                 point of a booking.
 *   historical    the run HAS HAPPENED AND ENDED: its day is not after today,
 *                 and an exact pickup or delivery, WHEN GIVEN, is not after
 *                 `now` — 15:00 today is refused at 14:00. An unknown hour is
 *                 never demanded.
 */
export const calendarRefusal = (
  mode: TripEntryMode | undefined,
  entry: { scheduledOn: string; pickupAt: Date | null; deliveryAt: Date | null },
  now: Date,
): CalendarRefusal | null => {
  const today = businessDayOf(now);
  if (mode === 'operational') {
    return entry.scheduledOn < today ? { field: 'scheduledOn', reason: 'PAST_DAY' } : null;
  }
  if (mode !== 'historical') return null;

  if (entry.scheduledOn > today) return { field: 'scheduledOn', reason: 'FUTURE_DAY' };
  const later = (instant: Date | null) => instant !== null && instant.getTime() > now.getTime();
  if (later(entry.pickupAt)) return { field: 'pickupAt', reason: 'FUTURE_INSTANT' };
  if (later(entry.deliveryAt)) return { field: 'deliveryAt', reason: 'FUTURE_INSTANT' };
  return null;
};
